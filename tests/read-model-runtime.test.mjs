import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { ReadModelError as StoreError, readModelHash } from "../lib/server/read-model.ts";
import { sealAsset } from "../lib/server/sealed-assets.ts";

async function publishedRuntime(t, { previous = true } = {}) {
  const saved = process.env.OBSIDIAN_DATA_SOURCE;
  process.env.OBSIDIAN_DATA_SOURCE = "published";
  t.after(() => { if (saved === undefined) delete process.env.OBSIDIAN_DATA_SOURCE; else process.env.OBSIDIAN_DATA_SOURCE = saved; });
  const external = t.mock.method(globalThis, "fetch", async () => { throw new Error("公开查询不能访问本机或未发布资料"); });
  const files = new Map(), requests = [], states = new Map();
  let latestRevision = previous ? "old" : null, fail = false, sequence = 0;
  if (previous) states.set("old", { revision: "old", state: "ready", sourceUpdatedAt: 1, indexedAt: 2, completedBatches: 1, batchCount: 1 });
  const write = (value, compressed = false) => { const filename = `${(++sequence).toString(16).padStart(24, "0")}.json${compressed ? ".gz" : ""}`; files.set(filename, compressed ? gzipSync(JSON.stringify(value)) : value); return filename; };
  const note = (content) => ({ path: "30_資料/测试.md", content, frontmatter: { type: "material" }, tags: [], stat: { ctime: 1, mtime: 1, size: content.length } });
  const old = { revision: "old", manifestFile: write({ schemaVersion: 1, revision: "old", batchCount: 1 }), batches: [write({})], bodyIndexFile: write({ "30_資料/测试.md": write(note("# 旧版完整正文")) }) };
  const current = { revision: "new", manifestFile: write({ schemaVersion: 1, revision: "new", batchCount: 5 }), batches: Array.from({ length: 5 }, (_, batch) => write({ batch }, true)), bodyIndexFile: write({ "30_資料/测试.md": write(note("# 新版完整正文"), true) }) };
  files.set("manifest.json", { publishedAt: "2026-10-29T00:00:00Z", readModel: current, readModels: [current, old] });
  const store = {
    async latest() { return latestRevision ? states.get(latestRevision) : null; },
    async status(revision) { return states.get(revision) ?? null; },
    async begin(manifest) { if (!states.has(manifest.revision)) states.set(manifest.revision, { revision: manifest.revision, state: "building", sourceUpdatedAt: 3, indexedAt: 4, completedBatches: 0, batchCount: manifest.batchCount }); },
    async importBatch(revision, batch, index) { const state = states.get(revision); assert.deepEqual(batch, { batch: index }); assert.equal(index, state.completedBatches); state.completedBatches++; },
    async finish(revision) { states.get(revision).state = "ready"; latestRevision = revision; },
  };
  const loaded = await loadAppModule("app/read-model-server.ts", { stubs: {
    "@/lib/server/read-model": { createReadModel: () => store },
    "cloudflare:workers": { env: { DB: {}, SITE_ASSET_SECRET: "ab".repeat(32), ASSETS: { async fetch(request) {
      const file = new URL(request.url).pathname.replace("/_published-vault/", ""); requests.push(file);
      if (file.endsWith(".gz")) assert.equal(request.headers.get("Accept-Encoding"), "identity");
      if (fail) return new Response("unavailable", { status: 503 });
      if (!files.has(file)) return new Response("missing", { status: 404 });
      const bytes = Buffer.isBuffer(files.get(file)) ? files.get(file) : new TextEncoder().encode(JSON.stringify(files.get(file)));
      return new Response(await sealAsset(bytes, "ab".repeat(32)));
    } } } },
  } });
  return { ...loaded, requests, states, external, fail(value) { fail = value; } };
}

test("索引每次只导入两批，当前未完整时保留上一完整资料并显示同步状态", async (t) => {
  const runtime = await publishedRuntime(t);
  const first = await runtime.readModelRuntime();
  assert.equal(first.revision, "old");
  assert.equal(first.syncState, "building");
  assert.equal(runtime.states.get("new").completedBatches, 2);
  assert.equal(runtime.requests.filter((file) => file !== "manifest.json").length, 3, "不可变清单只读取一次，其余是两批索引");
  const second = await runtime.readModelRuntime();
  assert.equal(second.revision, "old");
  assert.equal(runtime.states.get("new").completedBatches, 4);
  const last = await runtime.readModelRuntime();
  assert.equal(last.revision, "new");
  assert.equal(last.syncState, "ready");
  assert.equal(runtime.states.get("new").completedBatches, 5);
  assert.equal(runtime.requests.filter((file) => file === "manifest.json").length, 1, "同一部署的多次查询复用清单");
  assert.equal(runtime.external.mock.callCount(), 0);
});

test("首次索引未完成返回503与重试提示，存储层版本错误保持409，保留版本可读取完整正文", async (t) => {
  const runtime = await publishedRuntime(t, { previous: false });
  let building;
  try { await runtime.readModelRuntime(); } catch (error) { building = error; }
  assert.ok(building);
  const response = runtime.readModelFailure(building);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "1");
  assert.equal((await response.json()).state, "building");
  const expired = runtime.readModelFailure(new StoreError("资料版本已过期", 409, "revision-expired"));
  assert.equal(expired.status, 409);
  assert.equal(expired.headers.get("Retry-After"), null);
  await assert.rejects(runtime.readModelRuntime("expired"), { status: 409 });
  assert.equal((await runtime.readModelNote("30_資料/测试.md", "old")).content, "# 旧版完整正文");
  assert.equal((await runtime.readModelNote("30_資料/测试.md", "new")).content, "# 新版完整正文");
  await assert.rejects(runtime.readModelNote("30_資料/测试.md", "expired"), { status: 409 });
  await assert.rejects(runtime.readModelNote("missing.md", "new"), { status: 404 });
  await assert.rejects(runtime.readModelSource(), /公网查询只读取已发布投影/);
  assert.equal(runtime.external.mock.callCount(), 0);
});

test("来源或索引失败继续保留完整版本，带固定版本的请求不悄悄混入新资料", async (t) => {
  const runtime = await publishedRuntime(t);
  runtime.fail(true);
  assert.deepEqual((({ revision, syncState }) => ({ revision, syncState }))(await runtime.readModelRuntime()), { revision: "old", syncState: "failed" });
  assert.equal((await runtime.readModelRuntime("old")).revision, "old");
  await assert.rejects(runtime.readModelRuntime("missing"), /发布资料尚未准备完成/);
  runtime.fail(false);
  assert.equal((await runtime.readModelRuntime("old")).revision, "old");
  assert.ok(!runtime.states.has("new"), "旧版本固定请求不触发新版本导入");
});

async function restartedLocalRuntime(t, options = {}) {
  const savedSource = process.env.OBSIDIAN_DATA_SOURCE, savedToken = process.env.CODEX_BRIDGE_TOKEN;
  process.env.OBSIDIAN_DATA_SOURCE = "live";
  process.env.CODEX_BRIDGE_TOKEN = "fictional-bridge-restart-token";
  t.after(() => {
    if (savedSource === undefined) delete process.env.OBSIDIAN_DATA_SOURCE; else process.env.OBSIDIAN_DATA_SOURCE = savedSource;
    if (savedToken === undefined) delete process.env.CODEX_BRIDGE_TOKEN; else process.env.CODEX_BRIDGE_TOKEN = savedToken;
  });
  const old = { path: "30_資料/测试.md", content: `# 原始完整正文\n${"不可截断的原文。".repeat(20_000)}最终证据。`, frontmatter: { type: "material", status: "确认済", summary: "测试摘要" }, tags: ["测试"], stat: { ctime: 1, mtime: 2, size: 10 } };
  const current = options.current ? options.current(structuredClone(old)) : structuredClone(old);
  const bodyHash = await readModelHash(JSON.stringify({ path: old.path, content: old.content, frontmatter: old.frontmatter }));
  const calls = [], storeCalls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer fictional-bridge-restart-token");
    const request = new URL(url); calls.push({ path: request.pathname, revision: request.searchParams.get("revision"), baseRevision: request.searchParams.get("baseRevision") });
    if (request.pathname === "/read-model/note" && request.searchParams.get("revision") === "old-pinned") {
      if (options.transportError) throw options.transportError;
      return Response.json({ error: "Bridge 旧版正文已过期" }, { status: options.initialStatus ?? 409 });
    }
    if (request.pathname === "/read-model/manifest") {
      assert.equal(request.searchParams.get("baseRevision"), "latest-ready", "恢复来源沿用 D1 最新完成基版");
      return Response.json({ revision: "after-restart", schemaVersion: 1, batchCount: 0 });
    }
    assert.equal(request.pathname, "/read-model/note");
    assert.equal(request.searchParams.get("revision"), "after-restart");
    assert.equal(request.searchParams.get("path"), old.path);
    return Response.json({ note: current });
  });
  const loaded = await loadAppModule("app/read-model-server.ts", { stubs: {
    "@/lib/server/read-model": { readModelHash, createReadModel: () => ({
      async getCard(revision, path) {
        storeCalls.push({ operation: "getCard", revision, path });
        assert.equal(revision, "old-pinned"); assert.equal(path, old.path);
        if (options.cardError) throw options.cardError;
        return options.missingCard ? null : { kind: "note-card", path, bodyHash };
      },
      async latest() { storeCalls.push({ operation: "latest" }); return { revision: "latest-ready", state: "ready" }; },
    }) },
    "cloudflare:workers": { env: { DB: {} } },
  } });
  return { ...loaded, old, current, calls, storeCalls };
}

test("Bridge重启丢失旧正文时，只在D1旧版哈希完全相同时恢复完整单篇", async (t) => {
  const runtime = await restartedLocalRuntime(t);
  assert.deepEqual(await runtime.readModelNote(runtime.old.path, "old-pinned"), runtime.old);
  assert.ok(runtime.old.content.endsWith("最终证据。"));
  assert.deepEqual(runtime.storeCalls.map((call) => call.operation), ["getCard", "latest"]);
  assert.deepEqual(runtime.calls.map((call) => [call.path, call.revision]), [["/read-model/note", "old-pinned"], ["/read-model/manifest", null], ["/read-model/note", "after-restart"]]);
});

test("恢复旧版时正文或frontmatter变化均拒绝返回当前资料", async (t) => {
  for (const [label, current] of [
    ["正文变化", (note) => ({ ...note, content: note.content + "当前新增证据" })],
    ["frontmatter变化", (note) => ({ ...note, frontmatter: { ...note.frontmatter, status: "更新済" } })],
    ["来源路径变化", (note) => ({ ...note, path: "30_資料/另一份资料.md" })],
    ["当前正文缺失", () => null],
  ]) await t.test(label, async (child) => {
    const runtime = await restartedLocalRuntime(child, { current });
    await assert.rejects(runtime.readModelNote(runtime.old.path, "old-pinned"), { status: 409, message: "Bridge 旧版正文已过期" });
    assert.equal(runtime.calls.length, 3);
  });
});

test("D1没有旧版卡片时保持原409，不读取当前版本猜测替代来源", async (t) => {
  const runtime = await restartedLocalRuntime(t, { missingCard: true });
  await assert.rejects(runtime.readModelNote(runtime.old.path, "old-pinned"), { status: 409, message: "Bridge 旧版正文已过期" });
  assert.deepEqual(runtime.storeCalls.map((call) => call.operation), ["getCard"]);
  assert.equal(runtime.calls.length, 1);
});

test("非版本错误和存储故障原样传出，不启动或掩盖成正文恢复", async (t) => {
  for (const status of [401, 404, 503]) await t.test(String(status), async (child) => {
    const runtime = await restartedLocalRuntime(child, { initialStatus: status });
    await assert.rejects(runtime.readModelNote(runtime.old.path, "old-pinned"), { status, message: "Bridge 旧版正文已过期" });
    assert.equal(runtime.calls.length, 1);
    assert.deepEqual(runtime.storeCalls, []);
  });
  await t.test("连接故障", async (child) => {
    const failure = new TypeError("Bridge connection lost"), runtime = await restartedLocalRuntime(child, { transportError: failure });
    await assert.rejects(runtime.readModelNote(runtime.old.path, "old-pinned"), (error) => error === failure);
    assert.deepEqual(runtime.storeCalls, []);
  });
  await t.test("旧目录读取故障", async (child) => {
    const failure = new StoreError("数据库读取失败", 503), runtime = await restartedLocalRuntime(child, { cardError: failure });
    await assert.rejects(runtime.readModelNote(runtime.old.path, "old-pinned"), (error) => error === failure);
    assert.equal(runtime.calls.length, 1);
  });
});
