import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { ReadModelError as StoreError, readModelHash } from "../lib/server/read-model.ts";
import { sealAsset } from "../lib/server/sealed-assets.ts";

async function publishedRuntime(t, { previous = true, withdrawn = false } = {}) {
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
  files.set("manifest.json", { publishedAt: "2026-10-29T00:00:00Z", readModel: current, readModels: withdrawn ? [current] : [current, old] });
  const store = {
    async latest() { return latestRevision ? states.get(latestRevision) : null; },
    async status(revision) { return states.get(revision) ?? null; },
    async firstMissingBatch(revision) { return states.get(revision)?.completedBatches ?? 0; },
    async begin(manifest) { if (!states.has(manifest.revision)) states.set(manifest.revision, { revision: manifest.revision, state: "building", sourceUpdatedAt: 3, indexedAt: 4, completedBatches: 0, batchCount: manifest.batchCount }); },
    async importBatch(revision, batch, index) { const state = states.get(revision); assert.deepEqual(batch, { batch: index }); assert.equal(index, state.completedBatches); state.completedBatches++; },
    async finish(revision) { states.get(revision).state = "ready"; latestRevision = revision; },
  };
  const loaded = await loadAppModule("app/read-model-server.ts", { stubs: {
    "@/lib/server/read-model": { readModelHash, createReadModel: () => store },
    "cloudflare:workers": { env: { DB: {}, SITE_ASSET_SECRET: "ab".repeat(32), ASSETS: { async fetch(request) {
      const file = new URL(request.url).pathname.replace("/_published-vault/", ""); requests.push(file);
      if (file.endsWith(".gz")) assert.equal(request.headers.get("Accept-Encoding"), "identity");
      if (fail) return new Response("unavailable", { status: 503 });
      if (!files.has(file)) return new Response("missing", { status: 404 });
      const bytes = Buffer.isBuffer(files.get(file)) ? files.get(file) : new TextEncoder().encode(JSON.stringify(files.get(file)));
      return new Response(await sealAsset(bytes, "ab".repeat(32)));
    } } } },
  } });
  return { ...loaded, requests, states, files, external, fail(value) { fail = value; } };
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

test("发布清单不可读时关闭访问，不能以 D1 中的旧完整版本绕过撤回名单", async (t) => {
  const runtime = await publishedRuntime(t);
  runtime.fail(true);
  await assert.rejects(runtime.readModelRuntime(), /发布资料尚未准备完成/);
  await assert.rejects(runtime.readModelRuntime("old"), /发布资料尚未准备完成/);
  await assert.rejects(runtime.readModelReady(), /发布资料尚未准备完成/);
  runtime.fail(false);
  assert.equal((await runtime.readModelRuntime("old")).revision, "old");
  assert.ok(!runtime.states.has("new"), "旧版本固定请求不触发新版本导入");
});

test("撤回旧版本后正文、显式查询、默认回退与HTML汇总遵守同一白名单", async (t) => {
  const runtime = await publishedRuntime(t, { withdrawn: true });
  await assert.rejects(runtime.readModelRuntime("old"), { status: 409 });
  await assert.rejects(runtime.readModelNote("30_資料/测试.md", "old"), { status: 409 });
  assert.equal(await runtime.readModelReady(), null);
  await assert.rejects(runtime.readModelRuntime(), { status: 503, building: true });
  assert.equal(runtime.states.get("old").state, "ready", "物理旧行仍在，也不可被选中");
});

test("当前批次失败时仅回退到清单仍允许的ready版本", async (t) => {
  const runtime = await publishedRuntime(t);
  assert.equal((await runtime.readModelReady()).revision, "old");
  runtime.fail(true);
  const result = await runtime.readModelRuntime();
  assert.equal(result.revision, "old");
  assert.equal(result.syncState, "failed");
});

test("本地固定ready版本与HTML汇总不访问离线bridge", async (t) => {
  const saved = process.env.OBSIDIAN_DATA_SOURCE;
  process.env.OBSIDIAN_DATA_SOURCE = "live";
  t.after(() => { if (saved === undefined) delete process.env.OBSIDIAN_DATA_SOURCE; else process.env.OBSIDIAN_DATA_SOURCE = saved; });
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("bridge不能被访问"); });
  const state = { revision: "ready", state: "ready", sourceUpdatedAt: 1, indexedAt: 2 };
  const runtime = await loadAppModule("app/read-model-server.ts", { stubs: {
    "@/lib/server/read-model": { readModelHash, createReadModel: () => ({ async status(id) { return id === "ready" ? state : null; }, async latest() { return state; } }) },
    "cloudflare:workers": { env: { DB: {} } },
  } });
  assert.equal((await runtime.readModelRuntime("ready")).revision, "ready");
  assert.equal((await runtime.readModelReady()).revision, "ready");
  await assert.rejects(runtime.readModelRuntime("missing"), { status: 409 });
  assert.equal(request.mock.callCount(), 0);
});

test("预热仅使用一次选中的清单，来源变化不能造成状态和版本错配", async (t) => {
  const saved = process.env.OBSIDIAN_DATA_SOURCE, token = process.env.CODEX_BRIDGE_TOKEN;
  process.env.OBSIDIAN_DATA_SOURCE = "live"; process.env.CODEX_BRIDGE_TOKEN = "test-token";
  t.after(() => { if (saved === undefined) delete process.env.OBSIDIAN_DATA_SOURCE; else process.env.OBSIDIAN_DATA_SOURCE = saved; if (token === undefined) delete process.env.CODEX_BRIDGE_TOKEN; else process.env.CODEX_BRIDGE_TOKEN = token; });
  let manifests = 0;
  const states = new Map();
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(new URL(url).pathname, "/read-model/manifest");
    return Response.json({ revision: ++manifests === 1 ? "A" : "B", batchCount: 0 });
  });
  const runtime = await loadAppModule("app/read-model-server.ts", { stubs: {
    "@/lib/server/read-model": { readModelHash, createReadModel: () => ({
      async latest() { return null; }, async status(id) { return states.get(id); },
      async begin(manifest) { states.set(manifest.revision, { ...manifest, state: "building" }); },
      async firstMissingBatch() { return 0; }, async finish(id) { states.get(id).state = "ready"; },
    }) }, "cloudflare:workers": { env: { DB: {} } },
  } });
  const result = await runtime.readModelRuntime();
  assert.equal(result.revision, "A"); assert.equal(result.syncState, "ready");
  assert.equal(manifests, 1); assert.equal(states.get("A").state, "ready");
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
