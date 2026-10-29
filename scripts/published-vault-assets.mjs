import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import { noteInVaultScope } from "../lib/vault-scope.ts";
import { buildCalendarSnapshot } from "../lib/server/calendar-snapshot.ts";
import { copyRetainedReadModelAssets, garbageCollectReadModelAssets, writeReadModelAssets } from "./read-model-published.mjs";

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);
const ASSET_LIMIT = 24 * 1024 * 1024;
const SCOPES = ["all", "overview", "actions", "activity", "jobs", "interview", "training"];
const digest = (data) => createHash("sha256").update(data).digest("hex").slice(0, 24);

/** 保留完整笔记；把聚合和压缩移到发布时，访客首次读取只需传输静态响应。 */
export async function writePublishedVaultAssets(notes, directory, publishedAt = new Date().toISOString(), previousDirectory = directory) {
  const scopes = Object.fromEntries(SCOPES.map((scope) => [scope, []]));
  const chunks = {};
  const groups = new Map();
  let bytes = 0;
  for (const note of notes) {
    const size = Buffer.byteLength(JSON.stringify(note));
    if (size > ASSET_LIMIT) throw new Error("A single note exceeds the deployment asset limit");
    bytes += size;
    const membership = SCOPES.filter((scope) => noteInVaultScope(note, scope));
    const key = membership.join(",");
    const batches = groups.get(key) ?? [];
    let batch = batches.at(-1);
    if (!batch || batch.bytes + size > 2 * 1024 * 1024) {
      batch = { bytes: 0, notes: [], membership };
      batches.push(batch);
    }
    batch.bytes += size;
    batch.notes.push(note);
    groups.set(key, batches);
  }
  for (const batches of groups.values()) for (const batch of batches) {
    const data = JSON.stringify(batch.notes);
    const file = `${digest(data)}.json`;
    await writeFile(join(directory, file), data, { mode: 0o600 });
    for (const note of batch.notes) chunks[note.path] = file;
    for (const scope of batch.membership) scopes[scope].push(file);
  }

  const responses = {};
  async function writeResponse(data) {
    const hash = digest(data);
    const file = `${hash}.json`;
    const gz = await compressGzip(data, { level: 9 });
    const br = await compressBrotli(data, { params: {
      [constants.BROTLI_PARAM_QUALITY]: 9,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
    } });
    await writeFile(join(directory, file), data, { mode: 0o600 });
    await writeFile(join(directory, `${file}.gz`), gz, { mode: 0o600 });
    await writeFile(join(directory, `${file}.br`), br, { mode: 0o600 });
    return { file, etag: `W/"published-${hash}"`, gzip: `${file}.gz`, br: `${file}.br` };
  }
  // 分范围顺序处理，发布机也不必同时保留七份正文与压缩缓冲区。
  for (const scope of SCOPES) {
    const scopedNotes = notes.filter((note) => noteInVaultScope(note, scope));
    const data = JSON.stringify({
      connected: true, fetchedAt: Date.parse(publishedAt), notes: scopedNotes,
      paths: scopedNotes.map((note) => note.path), scope,
    });
    // 全库可能超过静态资源上限；仍保留原有分片读取，不能为了提速截断内容。
    if (Buffer.byteLength(data) > ASSET_LIMIT) continue;
    responses[scope] = await writeResponse(data);
  }
  const calendar = await writeResponse(JSON.stringify({ connected: true,
    calendar: buildCalendarSnapshot(notes.filter((note) => noteInVaultScope(note, "actions"))),
  }));
  const readModel = await writeReadModelAssets(notes, directory, publishedAt);
  let previous = [];
  try { const old = JSON.parse(await readFile(join(previousDirectory, "manifest.json"), "utf8")); previous = [old.readModel, ...(old.readModels ?? [])].filter((value, index, all) => value?.revision && all.findIndex((item) => item?.revision === value.revision) === index); } catch { /* 初次发布没有旧目录。 */ }
  const eligible = previous.filter((value) => value.revision !== readModel.revision).slice(0, 2);
  const retained = previousDirectory === directory ? eligible : await copyRetainedReadModelAssets(previousDirectory, directory, eligible);
  const readModels = [readModel, ...retained];
  const manifest = { schemaVersion: 2, publishedAt, scopes, chunks, responses, calendar, readModel, readModels };
  const temporary = join(directory, "manifest.read-model.tmp");
  await writeFile(temporary, JSON.stringify(manifest), { mode: 0o600 });
  await rename(temporary, join(directory, "manifest.json"));
  await garbageCollectReadModelAssets(directory, manifest, previous);
  return { manifest, bytes };
}
