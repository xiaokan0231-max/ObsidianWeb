import { createHash } from "node:crypto";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { buildApplicationReadModel } from "./read-model-source.mjs";

const BATCH_BYTES = 480_000;
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** 正文块按哈希桶独立打包，mtime 改变源顺序时只更新目录，不重写整库发布资源。 */
function stablePublishedArtifact(artifact) {
  const batches = [];
  const pack = (kind, rows) => {
    let batch = [], bytes = 24;
    for (const row of rows) {
      const size = Buffer.byteLength(JSON.stringify(row)) + 40;
      if (size + 24 > BATCH_BYTES) throw new Error("单条发布索引超过批次上限");
      if (bytes + size > BATCH_BYTES) { batches.push({ [kind]: batch }); batch = []; bytes = 24; }
      batch.push(row); bytes += size;
    }
    if (batch.length) batches.push({ [kind]: batch });
  };
  const buckets = Array.from({ length: 16 }, () => []);
  for (const batch of artifact.batches) for (const chunk of batch.chunks ?? []) {
    const bucket = buckets[Number.parseInt(chunk.hash[0], 16)];
    if (!bucket) throw new Error("发布正文哈希无效");
    bucket.push(chunk);
  }
  for (const bucket of buckets) pack("chunks", bucket.sort((a, b) => compare(a.hash, b.hash) || compare(a.channel, b.channel) || a.ordinal - b.ordinal));
  const families = {
    catalog: (a, b) => compare(a.path, b.path),
    aliases: (a, b) => compare(a.target, b.target) || compare(a.path, b.path) || a.exact - b.exact,
    links: (a, b) => compare(a.source_path, b.source_path) || compare(a.target, b.target),
    records: (a, b) => compare(a.kind, b.kind) || compare(a.key, b.key),
  };
  for (const [kind, sort] of Object.entries(families)) pack(kind, artifact.batches.flatMap((batch) => batch[kind] ?? []).sort(sort));
  const manifest = { ...artifact.manifest, revision: `rm-pub-v3-${artifact.manifest.revision}`, batchCount: batches.length,
    batchDigests: batches.map((batch) => createHash("sha256").update(JSON.stringify(batch)).digest("hex")) };
  return { manifest, batches };
}

/** 只处理明确发布的同一批资料；全文资源和索引始终指向同一版本。 */
export async function writeReadModelAssets(notes, directory, publishedAt) {
  const write = async (value, compressed = false) => {
    const text = JSON.stringify(value);
    const file = `${createHash("sha256").update(text).digest("hex").slice(0, 24)}.json${compressed ? ".gz" : ""}`;
    await writeFile(join(directory, file), compressed ? gzipSync(text, { level: 9 }) : text, { mode: 0o600 });
    return file;
  };
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const artifact = stablePublishedArtifact(await buildApplicationReadModel(notes, today, publishedAt));
  const batches = [];
  for (const batch of artifact.batches) batches.push(await write(batch, true));
  const bodies = {};
  for (const note of [...notes].sort((a, b) => compare(a.path, b.path))) bodies[note.path] = await write(note, true);
  return { revision: artifact.manifest.revision, manifestFile: await write(artifact.manifest), batches, bodyIndexFile: await write(bodies) };
}

const assetName = /^[a-f0-9]{24}\.json(?:\.(?:br|gz))?$/;
async function indexFiles(directory, index) {
  const result = [index?.manifestFile, ...(index?.batches ?? []), index?.bodyIndexFile].filter((name) => typeof name === "string" && assetName.test(name));
  if (index?.bodyIndexFile && assetName.test(index.bodyIndexFile)) {
    const bodies = JSON.parse(await readFile(join(directory, index.bodyIndexFile), "utf8"));
    result.push(...Object.values(bodies).filter((name) => typeof name === "string" && assetName.test(name)));
  }
  return result;
}

/** 导出使用全新暂存目录；只复制最近的完整派生版本，不能把未发布的本地资料混入。 */
export async function copyRetainedReadModelAssets(sourceDirectory, directory, indexes) {
  const retained = [];
  for (const index of indexes) {
    try {
      const files = await indexFiles(sourceDirectory, index);
      for (const file of files) await copyFile(join(sourceDirectory, file), join(directory, file));
      retained.push(index);
    } catch { /* 旧资源缺失时不能宣布它是可回退的完整版本。 */ }
  }
  return retained;
}

/** 只删除已退休索引曾引用的派生资源；当前正文分片与最近三个版本的共享文件都保留。 */
export async function garbageCollectReadModelAssets(directory, manifest, previous = []) {
  const files = async (index) => { try { return await indexFiles(directory, index); } catch { return []; } };
  const retained = new Set(Object.values(manifest.chunks ?? {}));
  for (const group of Object.values(manifest.scopes ?? {})) for (const file of group) retained.add(file);
  for (const response of [...Object.values(manifest.responses ?? {}), manifest.calendar].filter(Boolean)) for (const key of ["file", "gzip", "br"]) if (response[key]) retained.add(response[key]);
  for (const index of [manifest.readModel, ...(manifest.readModels ?? [])].filter(Boolean)) for (const file of await files(index)) retained.add(file);
  const obsolete = new Set();
  for (const index of previous) for (const file of await files(index)) if (!retained.has(file)) obsolete.add(file);
  await Promise.all([...obsolete].map((file) => rm(join(directory, file), { force: true })));
}
