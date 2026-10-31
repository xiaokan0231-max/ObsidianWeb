import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import test from "node:test";
import { writePublishedVaultAssets } from "../scripts/published-vault-assets.mjs";
import { noteInVaultScope } from "../lib/vault-scope.ts";
import { createPublishedVaultReader } from "../lib/server/published-vault.ts";
import { LANGUAGE_READING_LIST_MARKER, parseLanguageReadingList } from "../lib/language-reading-list.ts";

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
  const calendar = JSON.parse(await readFile(join(directory, manifest.calendar.file), "utf8"));
  assert.equal(calendar.connected, true);
  assert.equal(calendar.calendar.schemaVersion, 1);
  assert.equal(calendar.calendar.applicationNotes[0].content, "# 株式会社テスト");
  assert.ok(!JSON.stringify(calendar).includes("完全な本文"));
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

test("不发布笔记只留本地，正文、压缩响应和新旧查询索引均不携带内容", async t => {
  const previousDirectory = await mkdtemp(join(tmpdir(), "published-private-old-"));
  const directory = await mkdtemp(join(tmpdir(), "published-private-new-"));
  t.after(() => Promise.all([previousDirectory, directory].map(path => rm(path, { recursive: true, force: true }))));
  const original = makeNote("個別面談.md", "transcript", "PRIVATE-INTERVIEW-CONTENT");
  const old = await writePublishedVaultAssets([...notes, original], previousDirectory, publishedAt);
  const privateNote = { ...original, frontmatter: { ...original.frontmatter, publish: false } };
  const result = await writePublishedVaultAssets([...notes, privateNote], directory, publishedAt, previousDirectory);
  assert.equal(result.manifest.chunks[privateNote.path], undefined);
  assert.ok(result.manifest.readModels.every(model => model.revision !== old.manifest.readModel.revision));
  const bodyIndex = JSON.parse(await readFile(join(directory, result.manifest.readModel.bodyIndexFile), "utf8"));
  assert.equal(bodyIndex[privateNote.path], undefined);
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".json")) continue;
    const content = await readFile(join(directory, file), "utf8");
    assert.doesNotMatch(content, /PRIVATE-INTERVIEW-CONTENT|個別面談/);
  }
  assert.equal(privateNote.content, "PRIVATE-INTERVIEW-CONTENT");
});

test("公开学习短摘不公开私有原稿，正文与聚合响应一致标记不可打开的出处", async t => {
  const directory = await mkdtemp(join(tmpdir(), "published-reading-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = { ...makeNote("20_求職/株式会社テスト/原稿.md", "transcript", "PRIVATE-FULL-TRANSCRIPT"), frontmatter: { type: "transcript", publish: false } };
  const data = { version: 1, description: "授权学习短摘", period: { start: "2026-01-01", end: "2026-01-31" }, items: [{
    id: "g01", number: 1, category: "语法", priority: "先改", pattern: "经历", original: "話したことがあります。",
    suggested: "話した経験があります。", reminder: "保留经历。", sources: [{ path: source.path, locator: "s01", label: "株式会社テスト 面談" }],
  }] };
  const reading = makeNote("30_日本語学習/专题速览/表达.md", "language-reading-list", `${LANGUAGE_READING_LIST_MARKER}\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`);
  const before = structuredClone(reading);
  const { manifest } = await writePublishedVaultAssets([...notes, reading, source], directory, publishedAt);
  const reader = createPublishedVaultReader(async () => manifest, async file => JSON.parse(await readFile(join(directory, file), "utf8")));
  const published = await reader.readNote(reading.path);
  assert.equal(parseLanguageReadingList(published).items[0].sources[0].available, false);
  assert.deepEqual(parseLanguageReadingList(published).items[0].original, data.items[0].original);
  assert.deepEqual(reading, before);
  assert.equal(parseLanguageReadingList(reading).items[0].sources[0].available, undefined);
  assert.equal(manifest.chunks[source.path], undefined);
  const all = JSON.parse(await readFile(join(directory, manifest.responses.all.file), "utf8"));
  assert.deepEqual(all.notes.find(note => note.path === reading.path), published);
  const index = JSON.parse(await readFile(join(directory, manifest.readModel.bodyIndexFile), "utf8"));
  assert.equal(index[source.path], undefined);
  const indexed = JSON.parse(gunzipSync(await readFile(join(directory, index[reading.path]))).toString());
  assert.deepEqual(indexed, published);
  for (const file of await readdir(directory)) if (file.endsWith(".json")) assert.doesNotMatch(await readFile(join(directory, file), "utf8"), /PRIVATE-FULL-TRANSCRIPT/);
});
