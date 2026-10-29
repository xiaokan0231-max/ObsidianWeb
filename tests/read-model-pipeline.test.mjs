import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { buildApplicationReadModel, createLocalReadModelSource } from "../scripts/read-model-source.mjs";
import { writeReadModelAssets } from "../scripts/read-model-published.mjs";
import { writePublishedVaultAssets } from "../scripts/published-vault-assets.mjs";
import { createReadModel } from "../lib/server/read-model.ts";
import { database } from "./read-model-db.mjs";

const makeNote = (path, content = "# 测试资料\n\n完整正文结尾。", mtime = 1) => ({ path, content, frontmatter: { type: "material" }, tags: ["test"], stat: { ctime: 1, mtime, size: Buffer.byteLength(content) } });
async function readAsset(directory, file) {
  const content = await readFile(join(directory, file));
  return JSON.parse((file.endsWith(".gz") ? gunzipSync(content) : content).toString("utf8"));
}
function sourceFixture(notes, build = buildApplicationReadModel) {
  const files = new Map(notes.map((note) => [note.path, note])), calls = [];
  let statsFail = false;
  const source = createLocalReadModelSource({ base: "http://vault.test/", key: "fictional-test-secret", build,
    fetcher: async (url, init) => {
      assert.equal(init.headers.Authorization, "Bearer fictional-test-secret");
      const path = decodeURIComponent(new URL(url).pathname);
      calls.push({ path, method: init.method ?? "GET" });
      if (path === "/search/") {
        assert.equal(init.method, "POST");
        assert.deepEqual(JSON.parse(init.body), { var: "stat.mtime" });
        return statsFail ? new Response("unavailable", { status: 503 }) : Response.json([...files.values()].map((note) => ({ filename: note.path, result: note.stat.mtime })));
      }
      if (path === "/vault/") return Response.json({ files: [...files.keys()] });
      const note = files.get(path.replace(/^\/vault\//, ""));
      return note ? Response.json(note) : new Response("missing", { status: 404 });
    },
  });
  return { source, files, calls, setStatsFail(value) { statsFail = value; } };
}

test("宿主索引用已鉴权轻量扫描，只重取变更或保存路径，旧版本正文和批次不混用", async () => {
  let builds = 0;
  const fixture = sourceFixture([makeNote("30_資料/A.md"), makeNote("30_資料/B.MD", undefined, 2)], async (...args) => { builds++; return buildApplicationReadModel(...args); });
  const first = await fixture.source.manifest();
  assert.equal(builds, 1);
  assert.equal(fixture.calls.filter((call) => call.path.startsWith("/vault/")).length, 2);
  const before = fixture.calls.length;
  assert.equal((await fixture.source.manifest()).revision, first.revision);
  assert.equal(builds, 1);
  assert.deepEqual(fixture.calls.slice(before), [{ path: "/search/", method: "POST" }]);
  const old = fixture.source.note(first.revision, "30_資料/A.md");
  fixture.files.set(old.path, { ...old, content: "# 更新\n新正文。", stat: { ...old.stat, mtime: 3 } });
  const count = fixture.calls.length;
  const next = await fixture.source.manifest();
  assert.notEqual(next.revision, first.revision);
  assert.deepEqual(fixture.calls.slice(count).filter((call) => call.path.startsWith("/vault/")).map((call) => call.path), ["/vault/30_資料/A.md"]);
  assert.equal(fixture.source.note(first.revision, old.path).content, old.content);
  assert.equal(fixture.source.note(next.revision, old.path).content, "# 更新\n新正文。");
  const oldChunks = Object.keys(first.hashes), newChunks = Object.keys(next.hashes);
  assert.ok(oldChunks.some((hash) => newChunks.includes(hash)), "未变资料与派生内容继续复用哈希");
  fixture.source.invalidate([old.path]);
  const invalidated = fixture.calls.length;
  await fixture.source.manifest();
  assert.deepEqual(fixture.calls.slice(invalidated).filter((call) => call.path.startsWith("/vault/")).map((call) => call.path), ["/vault/30_資料/A.md"]);
});

test("删除改名及三版本保留，构建失败保留上一完整版本，扫描不可用时仍能读取原接口", async () => {
  let fail = false;
  const fixture = sourceFixture([makeNote("30_資料/旧名.md")], async (...args) => { if (fail) throw new Error("模拟构建失败"); return buildApplicationReadModel(...args); });
  const revisions = [await fixture.source.manifest()];
  fixture.files.set("30_資料/新名.md", { ...fixture.files.get("30_資料/旧名.md"), path: "30_資料/新名.md", stat: { ctime: 1, mtime: 2, size: 1 } });
  fixture.files.delete("30_資料/旧名.md");
  revisions.push(await fixture.source.manifest());
  assert.equal(fixture.source.note(revisions[1].revision, "30_資料/旧名.md"), null);
  assert.equal(fixture.source.note(revisions[0].revision, "30_資料/旧名.md").path, "30_資料/旧名.md");
  for (let mtime = 3; mtime <= 4; mtime++) {
    fixture.files.set("30_資料/新名.md", makeNote("30_資料/新名.md", `# 资料${mtime}`, mtime));
    revisions.push(await fixture.source.manifest());
  }
  assert.equal(fixture.source.batch(revisions[0].revision, 0), null);
  for (const revision of revisions.slice(-3)) assert.ok(fixture.source.batch(revision.revision, 0));
  fail = true;
  fixture.files.set("30_資料/新名.md", makeNote("30_資料/新名.md", "# 未完成新版本", 5));
  await assert.rejects(fixture.source.manifest(), /构建失败/);
  assert.equal(fixture.source.note(revisions.at(-1).revision, "30_資料/新名.md").content, "# 资料4");
  fail = false;
  fixture.setStatsFail(true);
  assert.notEqual((await fixture.source.manifest()).revision, revisions.at(-1).revision);
  assert.ok(fixture.calls.some((call) => call.path === "/vault/"));
});

test("生成途中保存不固定旧快照，并发读取共用构建", async () => {
  let unblock, started;
  const gate = new Promise((resolve) => { unblock = resolve; }), building = new Promise((resolve) => { started = resolve; });
  let builds = 0;
  const fixture = sourceFixture([makeNote("30_資料/测试.md")], async (...args) => { builds++; if (builds === 1) { started(); await gate; } return buildApplicationReadModel(...args); });
  const one = fixture.source.manifest(), two = fixture.source.manifest();
  await building;
  fixture.files.set("30_資料/测试.md", makeNote("30_資料/测试.md", "# 保存的新正文", 2));
  fixture.source.invalidate(["30_資料/测试.md"]);
  unblock();
  const [first, second] = await Promise.all([one, two]);
  assert.equal(first.revision, second.revision);
  assert.equal(fixture.source.note(first.revision, "30_資料/测试.md").content, "# 保存的新正文");
  assert.equal(builds, 2);
});

test("已就绪基版只传受影响正文块，D1 完整校验与旧正文版本固定；宿主遗失基版时回到全量", async (t) => {
  const storage = database(t), model = createReadModel(storage.db);
  const notes = Array.from({ length: 12 }, (_, index) => makeNote(`30_資料/资料${index}.md`, `# 资料${index}\n${"内容".repeat(25_000)}`, index + 1));
  const fixture = sourceFixture(notes);
  const first = await fixture.source.manifest();
  const artifact = (manifest) => ({ manifest, batches: Array.from({ length: manifest.batchCount }, (_, index) => fixture.source.batch(manifest.revision, index)) });
  await model.importArtifact(first.revision, artifact(first));
  const oldPath = notes[0].path;
  fixture.files.set(oldPath, makeNote(oldPath, "# 修改后唯一的新正文", 20));
  const next = await fixture.source.manifest(false, first.revision);
  assert.equal(next.baseRevision, first.revision);
  assert.ok(next.batchCount < first.batchCount / 4);
  const delta = artifact(next);
  const chunks = delta.batches.flatMap((batch) => batch.chunks ?? []);
  assert.ok(chunks.length > 0);
  assert.ok(chunks.every((chunk) => !(chunk.hash in first.hashes)), "未变哈希不再次下载或解码");
  await model.importArtifact(next.revision, delta);
  assert.equal((await model.library(next.revision, { query: "唯一的新正文" })).total, 1);
  assert.equal((await model.library(first.revision, { query: "唯一的新正文" })).total, 0);
  assert.equal(fixture.source.note(first.revision, oldPath).content, notes[0].content);
  assert.equal(fixture.source.note(next.revision, oldPath).content, "# 修改后唯一的新正文");
  assert.equal((await fixture.source.manifest(false, next.revision)).revision, next.revision, "同一资料已就绪后不会再生成一个变化基版版本");
  const fresh = sourceFixture([...fixture.files.values()]);
  const fallback = await fresh.source.manifest(false, next.revision);
  assert.equal(fallback.baseRevision, undefined);
  assert.ok(fallback.batchCount > next.batchCount);
  const fallbackBatches = Array.from({ length: fallback.batchCount }, (_, index) => fresh.source.batch(fallback.revision, index));
  await createReadModel(database(t).db).importArtifact(fallback.revision, { manifest: fallback, batches: fallbackBatches });
});

test("发布索引只接收给定快照，单篇长正文末尾完整，快照相同版本与资源名稳定", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "read-model-approved-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const notes = [makeNote("30_資料/批准资料.md", `# 批准资料\n${"长".repeat(800_000)}完整正文最后一句。`)];
  const publishedAt = "2026-10-01T00:00:00Z";
  const index = await writeReadModelAssets(notes, directory, publishedAt);
  assert.deepEqual(await writeReadModelAssets(notes, directory, publishedAt), index);
  const manifest = JSON.parse(await readFile(join(directory, index.manifestFile), "utf8"));
  assert.equal(manifest.revision, index.revision);
  assert.equal(manifest.noteCount, 1);
  assert.equal(manifest.indexedAt, Date.parse(publishedAt));
  const bodies = JSON.parse(await readFile(join(directory, index.bodyIndexFile), "utf8"));
  assert.deepEqual(Object.keys(bodies), [notes[0].path]);
  assert.match(bodies[notes[0].path], /^[a-f0-9]{24}\.json\.gz$/);
  assert.deepEqual(await readAsset(directory, bodies[notes[0].path]), notes[0]);
  assert.ok(index.batches.length > 5);
  for (const [ordinal, file] of index.batches.entries()) {
    assert.equal(file, `${manifest.batchDigests[ordinal].slice(0, 24)}.json.gz`);
    assert.ok(await readAsset(directory, file));
  }
  const compressedBody = await readFile(join(directory, bodies[notes[0].path]));
  assert.ok(compressedBody.length < Buffer.byteLength(JSON.stringify(notes[0])) / 10);
});

test("暂存目录复制最近三个已发布索引，退休资源回收不删除当前正文或共享文件", async (t) => {
  const directories = await Promise.all([0, 1, 2, 3].map(() => mkdtemp(join(tmpdir(), "read-model-history-"))));
  t.after(() => Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true }))));
  let previous = directories[0], first, latest;
  for (let index = 0; index < 4; index++) {
    const directory = directories[index];
    const notes = [makeNote("30_資料/共享.md"), makeNote("30_資料/变更.md", `# 已发布${index}`, index + 2)];
    const result = await writePublishedVaultAssets(notes, directory, "2026-10-01T00:00:00Z", previous);
    if (index === 0) first = result.manifest;
    latest = result.manifest;
    assert.equal(latest.readModels.length, Math.min(index + 1, 3));
    for (const retained of latest.readModels) {
      assert.equal(JSON.parse(await readFile(join(directory, retained.manifestFile), "utf8")).revision, retained.revision);
      const bodies = JSON.parse(await readFile(join(directory, retained.bodyIndexFile), "utf8"));
      for (const file of [...retained.batches, ...Object.values(bodies)]) await readFile(join(directory, file));
    }
    previous = directory;
  }
  assert.ok(!latest.readModels.some((index) => index.revision === first.readModel.revision));
  await assert.rejects(readFile(join(previous, first.readModel.manifestFile)), { code: "ENOENT" });
  const bodies = JSON.parse(await readFile(join(previous, latest.readModel.bodyIndexFile), "utf8"));
  assert.deepEqual(await readAsset(previous, bodies["30_資料/共享.md"]), makeNote("30_資料/共享.md"));
  const changed = [makeNote("30_資料/共享.md"), makeNote("30_資料/变更.md", "# 第五版", 8)];
  const fifth = await writePublishedVaultAssets(changed, previous, "2026-10-01T00:00:00Z");
  assert.equal(fifth.manifest.readModels.length, 3);
  assert.equal(new Set(fifth.manifest.readModels.map((index) => index.revision)).size, 3);
  await assert.rejects(readFile(join(previous, latest.readModels.at(-1).manifestFile)), { code: "ENOENT" });
});

test("同版本由原始JSON升级为gzip时回收旧表示，仍完整读取当前索引和正文", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "read-model-compression-upgrade-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const notes = [makeNote("30_資料/测试.md")], publishedAt = "2026-10-01T00:00:00Z";
  const { manifest } = await writePublishedVaultAssets(notes, directory, publishedAt);
  const legacy = { ...manifest.readModel, batches: [] };
  const uncompress = async (file) => { const target = file.replace(/\.gz$/, ""); await writeFile(join(directory, target), gunzipSync(await readFile(join(directory, file)))); return target; };
  for (const file of manifest.readModel.batches) legacy.batches.push(await uncompress(file));
  const bodies = await readAsset(directory, manifest.readModel.bodyIndexFile);
  for (const path of Object.keys(bodies)) bodies[path] = await uncompress(bodies[path]);
  const text = JSON.stringify(bodies);
  legacy.bodyIndexFile = `${createHash("sha256").update(text).digest("hex").slice(0, 24)}.json`;
  await writeFile(join(directory, legacy.bodyIndexFile), text);
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ ...manifest, readModel: legacy, readModels: [legacy] }));
  const next = await writePublishedVaultAssets(notes, directory, publishedAt);
  assert.equal(next.manifest.readModel.revision, legacy.revision);
  for (const file of [...legacy.batches, ...Object.values(bodies), legacy.bodyIndexFile]) await assert.rejects(readFile(join(directory, file)), { code: "ENOENT" });
  const currentBodies = await readAsset(directory, next.manifest.readModel.bodyIndexFile);
  assert.deepEqual(await readAsset(directory, currentBodies[notes[0].path]), notes[0]);
});

test("发布正文按16个稳定哈希桶打包，mtime重排只改变目录，单篇变更只重打受影响桶", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "read-model-stable-packing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const notes = Array.from({ length: 36 }, (_, index) => makeNote(`30_資料/资料${String(index).padStart(2, "0")}.md`, `# 资料${index}\n检索原文 ${"正文完整内容。".repeat(4_000)}`, index + 1));
  const publishedAt = "2026-10-01T00:00:00Z";
  const one = await writeReadModelAssets(notes, directory, publishedAt);
  assert.match(one.revision, /^rm-pub-v3-/);
  assert.deepEqual(await writeReadModelAssets(notes, directory, publishedAt), one);
  async function inspect(index) {
    const chunks = new Map(), metadata = [];
    for (const file of index.batches) {
      const batch = await readAsset(directory, file);
      assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= 480_000);
      if (batch.chunks) {
        const buckets = new Set(batch.chunks.map((chunk) => chunk.hash[0]));
        assert.equal(buckets.size, 1);
        assert.deepEqual(Object.keys(batch), ["chunks"]);
        chunks.set(file, [...buckets][0]);
      } else metadata.push(file);
    }
    return { chunks, metadata, bodies: await readAsset(directory, index.bodyIndexFile) };
  }
  const first = await inspect(one);
  const changedPath = notes[0].path;
  const reordered = [...notes].reverse().map((note) => note.path === changedPath ? { ...note, stat: { ...note.stat, mtime: 500 } } : note);
  const two = await writeReadModelAssets(reordered, directory, publishedAt), second = await inspect(two);
  assert.notEqual(two.revision, one.revision);
  assert.deepEqual([...second.chunks.keys()].sort(), [...first.chunks.keys()].sort(), "mtime与顺序变化不重新生成任一正文桶");
  assert.ok(second.metadata.some((file) => !first.metadata.includes(file)), "目录保留实际变化的mtime和原始ordinal");
  for (const note of notes) assert.equal(second.bodies[note.path] === first.bodies[note.path], note.path !== changedPath, note.path);
  const contentChanged = reordered.map((note) => note.path === changedPath ? { ...note, content: note.content + "新增独占证据" } : note);
  const three = await writeReadModelAssets(contentChanged, directory, publishedAt), third = await inspect(three);
  const oldHashes = [...(await Promise.all(two.batches.map((file) => readAsset(directory, file))))].flatMap((batch) => batch.catalog ?? []);
  const newHashes = [...(await Promise.all(three.batches.map((file) => readAsset(directory, file))))].flatMap((batch) => batch.catalog ?? []);
  const affected = new Set([oldHashes.find((row) => row.path === changedPath).hash[0], newHashes.find((row) => row.path === changedPath).hash[0]]);
  for (const [file, bucket] of second.chunks) if (!affected.has(bucket)) assert.ok(third.chunks.has(file), `未受影响的${bucket}桶资源复用`);
  for (const note of contentChanged) if (note.path !== changedPath) assert.equal(third.bodies[note.path], second.bodies[note.path]);

  const store = createReadModel(database(t).db);
  const artifact = { manifest: await readAsset(directory, three.manifestFile), batches: await Promise.all(three.batches.map((file) => readAsset(directory, file))) };
  await store.importArtifact(three.revision, artifact);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const canonical = await buildApplicationReadModel(contentChanged, today, publishedAt);
  await store.importArtifact(canonical.manifest.revision, canonical);
  for (const query of [{ query: "检索原文" }, { query: "新增独占证据" }, { sort: "title" }, { sort: "recent" }]) {
    const expected = await store.library(canonical.manifest.revision, query), actual = await store.library(three.revision, query);
    assert.deepEqual(actual.items, expected.items);
    assert.deepEqual(actual.facets, expected.facets);
    assert.equal(actual.total, expected.total);
  }
  assert.deepEqual((await store.search(three.revision, "检索原文")).items, (await store.search(canonical.manifest.revision, "检索原文")).items, "SQL按保留ordinal重现原始搜索顺序");
});
