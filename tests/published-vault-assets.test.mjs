import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import test from "node:test";
import { writePublishedVaultAssets } from "../scripts/published-vault-assets.mjs";
import { noteInVaultScope } from "../lib/vault-scope.ts";
import { createPublishedVaultReader } from "../lib/server/published-vault.ts";

const publishedAt = "2026-01-01T00:00:00Z";
const makeNote = (path, type, content) => ({
  path, content, frontmatter: { type }, tags: ["test"],
  stat: { ctime: 1, mtime: 2, size: Buffer.byteLength(content) },
});
const notes = [
  makeNote("案件.md", "job-case", "# 株式会社テスト\n完全な本文と[[面接]]。"),
  makeNote("面接.md", "transcript", "# 原稿\n全文を省略しない。"),
  makeNote("資料.md", "note", "# 独立資料\n全庫だけに属する本文。"),
];

test("发布静态响应保留各范围全部正文、路径和时间，三种编码解压后等价", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "published-assets-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { manifest } = await writePublishedVaultAssets(notes, directory, publishedAt);
  const reader = createPublishedVaultReader(async () => manifest,
    async (file) => JSON.parse(await readFile(join(directory, file), "utf8")));
  for (const [scope, entry] of Object.entries(manifest.responses)) {
    const raw = await readFile(join(directory, entry.file));
    assert.deepEqual(gunzipSync(await readFile(join(directory, entry.gzip))), raw);
    assert.deepEqual(brotliDecompressSync(await readFile(join(directory, entry.br))), raw);
    const body = JSON.parse(raw);
    const expected = notes.filter((note) => noteInVaultScope(note, scope));
    assert.deepEqual(body, { connected: true, fetchedAt: Date.parse(publishedAt), notes: expected,
      paths: expected.map((note) => note.path), scope });
    assert.deepEqual((await reader.readAll(scope)).sort((a, b) => a.path.localeCompare(b.path)),
      [...expected].sort((a, b) => a.path.localeCompare(b.path)));
  }
  assert.deepEqual(await reader.readNote("面接.md"), notes[1]);
});

test("相同快照生成相同验证器，正文改写即使mtime未变也改变验证器", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "published-validator-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await writePublishedVaultAssets(notes, directory, publishedAt);
  const again = await writePublishedVaultAssets(notes, directory, publishedAt);
  assert.deepEqual(first.manifest, again.manifest);
  const changed = notes.map((note, index) => index === 0 ? { ...note, content: note.content + "更新" } : note);
  const next = await writePublishedVaultAssets(changed, directory, publishedAt);
  assert.notEqual(first.manifest.responses.actions.etag, next.manifest.responses.actions.etag);
  assert.notEqual(first.manifest.responses.actions.file, next.manifest.responses.actions.file);
});

test("超过单资源上限的全库继续分片读取，不输出超限响应或丢失笔记", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "published-large-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const content = "字".repeat(4_300_000);
  const largeNotes = [makeNote("大資料一.md", "note", content), makeNote("大資料二.md", "note", content)];
  const { manifest } = await writePublishedVaultAssets(largeNotes, directory, publishedAt);
  assert.equal(manifest.responses.all, undefined);
  assert.equal(Object.keys(manifest.chunks).length, 2);
  const reader = createPublishedVaultReader(async () => manifest,
    async (file) => JSON.parse(await readFile(join(directory, file), "utf8")));
  assert.deepEqual(await reader.readAll(), largeNotes);
  for (const file of await readdir(directory)) assert.ok((await stat(join(directory, file))).size < 24 * 1024 * 1024);
});
