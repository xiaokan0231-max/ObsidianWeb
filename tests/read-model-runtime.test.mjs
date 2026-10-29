import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { ReadModelError as StoreError } from "../lib/server/read-model.ts";

async function publishedRuntime(t, { previous = true } = {}) {
  const saved = process.env.OBSIDIAN_DATA_SOURCE;
  process.env.OBSIDIAN_DATA_SOURCE = "published";
  t.after(() => { if (saved === undefined) delete process.env.OBSIDIAN_DATA_SOURCE; else process.env.OBSIDIAN_DATA_SOURCE = saved; });
  const external = t.mock.method(globalThis, "fetch", async () => { throw new Error("公开查询不能访问本机或未发布资料"); });
  const files = new Map(), requests = [], states = new Map();
  let latestRevision = previous ? "old" : null, fail = false, sequence = 0;
  if (previous) states.set("old", { revision: "old", state: "ready", sourceUpdatedAt: 1, indexedAt: 2, completedBatches: 1, batchCount: 1 });
  const write = (value) => { const filename = `${(++sequence).toString(16).padStart(24, "0")}.json`; files.set(filename, value); return filename; };
  const note = (content) => ({ path: "30_資料/测试.md", content, frontmatter: { type: "material" }, tags: [], stat: { ctime: 1, mtime: 1, size: content.length } });
  const old = { revision: "old", manifestFile: write({ schemaVersion: 1, revision: "old", batchCount: 1 }), batches: [write({})], bodyIndexFile: write({ "30_資料/测试.md": write(note("# 旧版完整正文")) }) };
  const current = { revision: "new", manifestFile: write({ schemaVersion: 1, revision: "new", batchCount: 5 }), batches: Array.from({ length: 5 }, () => write({})), bodyIndexFile: write({ "30_資料/测试.md": write(note("# 新版完整正文")) }) };
  files.set("manifest.json", { publishedAt: "2026-10-29T00:00:00Z", readModel: current, readModels: [current, old] });
  const store = {
    async latest() { return latestRevision ? states.get(latestRevision) : null; },
    async status(revision) { return states.get(revision) ?? null; },
    async begin(manifest) { if (!states.has(manifest.revision)) states.set(manifest.revision, { revision: manifest.revision, state: "building", sourceUpdatedAt: 3, indexedAt: 4, completedBatches: 0, batchCount: manifest.batchCount }); },
    async importBatch(revision, _batch, index) { const state = states.get(revision); assert.equal(index, state.completedBatches); state.completedBatches++; },
    async finish(revision) { states.get(revision).state = "ready"; latestRevision = revision; },
  };
  const loaded = await loadAppModule("app/read-model-server.ts", { stubs: {
    "@/lib/server/read-model": { createReadModel: () => store },
    "cloudflare:workers": { env: { DB: {}, ASSETS: { async fetch(request) {
      const file = new URL(request.url).pathname.replace("/_published-vault/", ""); requests.push(file);
      return fail ? new Response("unavailable", { status: 503 }) : files.has(file) ? Response.json(files.get(file)) : new Response("missing", { status: 404 });
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
  assert.equal(runtime.requests.filter((file) => file !== "manifest.json").length, 4, "只读取两次小清单和两批索引");
  const second = await runtime.readModelRuntime();
  assert.equal(second.revision, "old");
  assert.equal(runtime.states.get("new").completedBatches, 4);
  const last = await runtime.readModelRuntime();
  assert.equal(last.revision, "new");
  assert.equal(last.syncState, "ready");
  assert.equal(runtime.states.get("new").completedBatches, 5);
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
