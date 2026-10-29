import assert from "node:assert/strict";
import test from "node:test";
import { database } from "./read-model-db.mjs";
import { buildReadModelArtifact, createReadModel, READ_MODEL_BATCH_BYTES } from "../lib/server/read-model.ts";
import { compareRelevance, libraryHits, librarySnippet, libraryTitleParts, noteHasTags, topLibraryTags } from "../lib/library-search.ts";
import { GROUPS, getGroup, libraryScopeMatches, noteMatches } from "../lib/memory-atlas-data.ts";
import { resolveNoteLinkResult } from "../lib/wiki-target.ts";


function note(path, body = "正文", frontmatter = {}, tags = [], mtime = 1) {
  return { path, content: `# ${path.split("/").at(-1).replace(/\.md$/, "")}\n\n${body}`, frontmatter: { type: "material", ...frontmatter }, tags, stat: { ctime: 1, mtime, size: body.length } };
}
async function imported(storage, notes, options = {}) {
  const artifact = await buildReadModelArtifact(notes, { revision: "test", ...options });
  const model = createReadModel(storage.db);
  await model.importArtifact(artifact.manifest.revision, artifact);
  return { model, artifact };
}
const paths = (items) => items.map((item) => item.path);

test("FTS5 trigram 实际执行，目录分页绑定版本且不把正文冒充卡片", async (t) => {
  const storage = database(t);
  const notes = Array.from({ length: 53 }, (_, index) => note(`30_資料/资料${index}.md`, "全文正文".repeat(100), {}, [], index));
  const { model } = await imported(storage, notes);
  const first = await model.library("test");
  assert.equal(first.items.length, 24);
  assert.equal(first.total, 53);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 100_000);
  assert.ok(first.items.every((item) => item.kind === "note-card" && !("content" in item) && !("frontmatter" in item)));
  const second = await createReadModel(storage.db).library("test", { cursor: first.nextCursor });
  assert.equal(second.items.length, 24);
  assert.equal(new Set([...paths(first.items), ...paths(second.items)]).size, 48);
  await assert.rejects(model.library("test", { query: "全文", cursor: first.nextCursor }), /分页位置/);
  assert.equal((await model.library("test", { query: "全文正文" })).total, 53);
  assert.ok(storage.calls.flat().some(({ sql }) => sql.includes("read_model_fts MATCH")));
  await imported(storage, notes, { revision: "next" });
  await assert.rejects(model.library("next", { cursor: first.nextCursor }), /版本已更新/);
});

test("搜索沿用全文及属性规则、相关度、片段和筛选统计，短中日文与分块边界不漏命中", async (t) => {
  const storage = database(t);
  const longToken = "边界".repeat(90);
  const notes = [
    note("20_求職/面接準備.md", "日语 開発 重要度:高 apple|pear [[资料]]", { type: "interview-prep", status: "面接中", topic: "開発" }, ["#仕事", "准备"], 6),
    note("30_資料/资料.md", "開発 ".repeat(8), { status: "応募済", topic: "数据" }, ["仕事"], 5),
    note("40_学习/材料.md", "无关正文", { status: "完了", topic: "開発" }, ["学习"], 4),
    note("30_資料/长稿.md", `${"x".repeat(23_970)}跨块搜索 ${longToken} 😀中文 日本 开発`, {}, ["工作"], 3),
    note("30_資料/引用'\".md", "a\"b');DROP 重要度:低", {}, [], 2),
  ];
  const { model } = await imported(storage, notes);
  const queries = ["", "開発", "日", "日本", "中文", "跨块搜索", longToken, "😀中文", "type:material|interview-prep 開発", "status:応募|面接", "folder:資料|学习", "重要度:高", "apple|pear", "type:", "type:|", "a\"b');drop", "不存在"];
  for (const query of queries) {
    const selected = notes.filter((item) => noteMatches(item, query));
    const ranked = [...selected].sort((a, b) => query && !query.split(/\s+/).every((token) => token.includes(":")) ? compareRelevance(libraryHits(a, query), libraryHits(b, query)) || b.stat.mtime - a.stat.mtime : b.stat.mtime - a.stat.mtime);
    const page = await model.library("test", { query });
    assert.deepEqual(paths(page.items), paths(ranked), query);
    for (const item of page.items) {
      const original = notes.find((entry) => entry.path === item.path);
      assert.deepEqual(item.titleParts, libraryTitleParts(original, query), query);
      assert.deepEqual(item.snippetParts, librarySnippet(original, query), query);
      if (item.hits) assert.deepEqual(item.hits, libraryHits(original, query), query);
    }
    assert.deepEqual(paths((await model.search("test", query)).items), paths(query ? selected.slice(0, 8) : [...notes].sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 8)), query);
  }
  for (const input of [{}, { group: "career" }, { scope: "interview" }, { tags: ["仕事"] }, { scope: "evidence", tags: ["不存在"] }]) {
    const group = input.group ?? "all", scope = input.scope ?? "all", tags = input.tags ?? [];
    const tagged = notes.filter((item) => noteHasTags(item, tags));
    const inGroup = (item) => group === "all" || getGroup(item.path) === group;
    const selected = tagged.filter((item) => inGroup(item) && libraryScopeMatches(item, scope));
    const page = await model.library("test", input);
    assert.equal(page.total, selected.length);
    for (const [key, count] of Object.entries(page.facets.groups)) assert.equal(count, tagged.filter((item) => (key === "all" || getGroup(item.path) === key) && libraryScopeMatches(item, scope)).length);
    for (const [key, count] of Object.entries(page.facets.scopes)) assert.equal(count, tagged.filter((item) => inGroup(item) && libraryScopeMatches(item, key)).length);
    const tagList = topLibraryTags(notes.filter((item) => inGroup(item) && libraryScopeMatches(item, scope)), tags);
    assert.deepEqual(page.facets.tags, tagList.map(({ tag }) => ({ tag, count: selected.filter((item) => noteHasTags(item, [tag])).length })));
    assert.equal(Object.keys(page.facets.groups).length, Object.keys(GROUPS).length + 1);
  }
  assert.deepEqual(paths((await model.search("test", "", 8, [notes[3].path, "missing", notes[1].path])).items), [notes[3].path, notes[1].path]);
});

test("完整路径优先及重名短链消歧，关系查询不加载全库正文", async (t) => {
  const storage = database(t);
  const notes = [note("30_資料/A/重名.md"), note("30_資料/B/重名.md"), note("30_資料/唯一.md"), note("30_資料/引用.md", "[[重名]] [[30_資料/A/重名#证据]] [[唯一]]")];
  const { model } = await imported(storage, notes);
  for (const target of ["重名", "A/重名", "30_資料/A/重名.md#证据", "[[唯一|标题]]", "不存在"]) {
    const expected = resolveNoteLinkResult(notes, target), result = await model.resolve("test", target);
    assert.equal(result.kind, expected.kind);
    if (result.kind === "resolved") { assert.equal(result.path, expected.note.path); assert.equal(result.section, expected.section); }
  }
  const before = storage.calls.length;
  assert.deepEqual(paths((await model.backlinks("test", notes[0].path)).items), [notes[3].path]);
  assert.deepEqual(paths((await model.backlinks("test", notes[1].path)).items), []);
  assert.deepEqual(paths((await model.backlinks("test", notes[3].path)).outlinks), [notes[0].path, notes[2].path]);
  assert.ok(storage.calls.slice(before).flat().every(({ sql }) => !/FROM read_model_chunks/.test(sql)));
});

test("大于 D1 单行限制的正文及投影分块导入，42 个精确键用一次 JOIN 读取", async (t) => {
  const storage = database(t);
  const text = "边界😀\"\\".repeat(230_000);
  const records = Array.from({ length: 42 }, (_, index) => ({ kind: "day", key: String(index), value: { index } }));
  records.push({ kind: "big", key: "root", value: { text } });
  const { model, artifact } = await imported(storage, [note("30_資料/超长.md", text)], { records });
  assert.ok(artifact.batches.length > 10);
  for (const batch of artifact.batches) {
    assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= READ_MODEL_BATCH_BYTES);
    for (const chunk of batch.chunks ?? []) assert.ok(Buffer.byteLength(chunk.text) <= 128_000);
  }
  assert.deepEqual(await model.readRecord("test", "big", "root"), { text });
  const before = storage.calls.length;
  assert.deepEqual((await model.readRecords("test", "day", records.slice(0, 42).map((item) => item.key))).map((item) => item.value.index).sort((a, b) => a - b), Array.from({ length: 42 }, (_, index) => index));
  assert.equal(storage.calls.slice(before).flat().filter(({ sql }) => sql.includes("JOIN read_model_chunks")).length, 1);
  assert.equal((await model.library("test", { query: "边界😀" })).total, 1);
});

test("只在批次和数量校验完成后公布，失败回滚与重试幂等，损坏批次不能显示假零值", async (t) => {
  const storage = database(t), model = createReadModel(storage.db);
  const artifact = await buildReadModelArtifact([note("30_資料/测试.md")], { revision: "retry" });
  await model.begin(artifact.manifest);
  await assert.rejects(model.library("retry"), /尚未完成/);
  await assert.rejects(model.finish("retry"), /完整导入/);
  await assert.rejects(model.importBatch("retry", { catalog: [] }, 0), /校验/);
  storage.failOn("INSERT OR IGNORE INTO read_model_catalog");
  await assert.rejects(model.importBatch("retry", artifact.batches[0], 0), /数据库故障/);
  assert.equal(storage.sqlite.prepare("SELECT COUNT(*) n FROM read_model_chunks").get().n, 0);
  storage.failOn(null);
  await model.importBatch("retry", artifact.batches[0], 0);
  await model.importBatch("retry", artifact.batches[0], 0);
  await model.finish("retry");
  assert.equal((await model.library("retry")).total, 1);
  assert.equal((await model.status("retry")).completedBatches, artifact.batches.length);
  await assert.rejects(model.begin({ ...artifact.manifest, noteCount: 2, counts: { ...artifact.manifest.counts, catalog: 2 } }), /清单冲突/);
});

test("最近三个完整版本保留，未改变内容的 hash 复用，删除改名只清派生数据", async (t) => {
  const storage = database(t), source = [note("30_資料/保留.md"), note("30_資料/删除.md")];
  const { model, artifact } = await imported(storage, source, { revision: "v1" });
  const original = storage.sqlite.prepare("SELECT COUNT(*) n FROM read_model_chunks").get().n;
  for (const revision of ["v2", "v3"]) await model.importArtifact(revision, await buildReadModelArtifact(source.map((item) => ({ ...item, stat: { ...item.stat, mtime: item.stat.mtime + 2 } })), { revision }));
  assert.equal(storage.sqlite.prepare("SELECT COUNT(*) n FROM read_model_chunks").get().n, original, "仅目录元数据更新，正文索引块复用");
  const renamed = [source[0], { ...source[1], path: "30_資料/改名.md" }];
  await model.importArtifact("v4", await buildReadModelArtifact(renamed, { revision: "v4" }));
  assert.equal(await model.status("v1"), null);
  assert.equal((await model.status("v2")).state, "ready");
  assert.equal(storage.sqlite.prepare("SELECT COUNT(*) n FROM read_model_revisions WHERE state='ready'").get().n, 3);
  assert.equal((await model.resolve("v4", "删除")).kind, "missing");
  assert.equal((await model.resolve("v4", "改名")).kind, "resolved");
  assert.equal(source[1].path, "30_資料/删除.md");
  assert.equal(artifact.manifest.noteCount, 2);
  await assert.rejects(model.library("v1"), /尚未完成/);
});

test("完成后回收超过24小时的中断导入，保留近期续传与三个完整版本的共享块", async (t) => {
  const storage = database(t), model = createReadModel(storage.db);
  const shared = note("30_資料/共享.md");
  for (const revision of ["ready-1", "ready-2", "ready-3"]) await model.importArtifact(revision, await buildReadModelArtifact([shared], { revision }));
  const stale = await buildReadModelArtifact([shared, note("30_資料/中断旧稿.md", "过期导入的独占正文")], { revision: "stale-building" });
  const recent = await buildReadModelArtifact([shared, note("30_資料/近期稿.md", "仍可继续导入的正文")], { revision: "recent-building" });
  for (const artifact of [stale, recent]) {
    await model.begin(artifact.manifest);
    for (const [index, batch] of artifact.batches.entries()) await model.importBatch(artifact.manifest.revision, batch, index);
  }
  const frozenNow = Date.now();
  storage.sqlite.prepare("UPDATE read_model_revisions SET created_at=? WHERE revision=?").run(frozenNow - 25 * 60 * 60 * 1000, "stale-building");
  storage.sqlite.prepare("UPDATE read_model_revisions SET created_at=? WHERE revision=?").run(frozenNow - 60 * 60 * 1000, "recent-building");
  await model.importArtifact("ready-4", await buildReadModelArtifact([shared], { revision: "ready-4" }));
  assert.equal(await model.status("stale-building"), null);
  assert.equal((await model.status("recent-building")).state, "building");
  assert.equal(storage.sqlite.prepare("SELECT COUNT(*) n FROM read_model_revisions WHERE state='ready'").get().n, 3);
  for (const table of ["read_model_catalog", "read_model_aliases", "read_model_links", "read_model_records", "read_model_batches", "read_model_content_refs"]) assert.equal(storage.sqlite.prepare(`SELECT COUNT(*) n FROM ${table} WHERE revision=?`).get("stale-building").n, 0);
  const sharedHash = (await model.getCard("ready-4", shared.path)).bodyHash;
  const oldOnlyHash = stale.batches.flatMap((batch) => batch.catalog ?? []).find((row) => row.path.endsWith("中断旧稿.md")).hash;
  assert.ok(storage.sqlite.prepare("SELECT COUNT(*) n FROM read_model_chunks WHERE hash=?").get(sharedHash).n > 0);
  assert.equal(storage.sqlite.prepare("SELECT COUNT(*) n FROM read_model_chunks WHERE hash=?").get(oldOnlyHash).n, 0);
  await model.finish("recent-building");
  assert.equal((await model.library("recent-building")).total, 2);
});
