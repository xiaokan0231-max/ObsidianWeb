import assert from "node:assert/strict";
import test from "node:test";
import { createReadModelResource } from "../app/read-model-resource.ts";

const card = (path) => ({ kind: "note-card", path });
const page = (revision, paths, nextCursor = null) => ({ revision, items: paths.map(card), nextCursor, total: 30 });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const whenState = (resource, predicate) => new Promise((resolve) => { const stop = resource.subscribe(() => { if (predicate(resource.getState())) { stop(); resolve(); } }); });

test("目录分页只请求目录接口，保留筛选和同一资料版本再追加", async () => {
  const urls = [];
  const resource = createReadModelResource(async (url) => {
    urls.push(new URL(url, "https://example.test"));
    return Response.json(urls.length === 1 ? page("r1", ["资料/一.md"], "opaque-r1") : page("r1", ["资料/二.md"]));
  });
  await resource.query("/api/read-model/library?q=%E9%9D%A2%E6%8E%A5&tags=%E6%BA%96%E5%82%99&limit=24");
  await resource.more();
  assert.deepEqual(resource.getState().items.map((item) => item.path), ["资料/一.md", "资料/二.md"]);
  assert.equal(urls[1].searchParams.get("cursor"), "opaque-r1");
  assert.equal(urls[1].searchParams.get("q"), "面接");
  assert.equal(urls[1].searchParams.get("tags"), "準備");
  assert.ok(urls.every((url) => url.pathname === "/api/read-model/library"));
});

test("筛选切换和关闭后的迟到响应不能覆盖当前目录", async () => {
  const first = deferred(), second = deferred();
  const resource = createReadModelResource((url) => url.includes("old") ? first.promise : second.promise);
  const old = resource.query("/api/read-model/search?q=old");
  const next = resource.query("/api/read-model/search?q=new");
  second.resolve(Response.json(page("r2", ["资料/新.md"])));
  await next;
  first.resolve(Response.json(page("r1", ["资料/旧.md"])));
  await old;
  assert.deepEqual(resource.getState().items.map((item) => item.path), ["资料/新.md"]);
  const late = deferred();
  const closed = createReadModelResource(() => late.promise);
  const request = closed.query("/api/read-model/search?q=late");
  closed.dispose();
  late.resolve(Response.json(page("r3", ["资料/迟到.md"])));
  await request;
  assert.equal(closed.getState().page, null);
});

test("旧游标过期或混入新版本时重取第一页，不拼接不同版本", async () => {
  for (const mixed of [false, true]) {
    const urls = [];
    const resource = createReadModelResource(async (url) => {
      urls.push(url);
      if (urls.length === 1) return Response.json(page("r1", ["资料/旧.md"], "r1-cursor"));
      if (urls.length === 2) return mixed ? Response.json(page("r2", ["资料/不可追加.md"])) : Response.json({ error: "旧版本已过期" }, { status: 409 });
      return Response.json(page("r2", ["资料/新第一页.md"]));
    });
    await resource.query("/api/read-model/library?q=面接");
    await resource.more();
    assert.equal(urls.length, 3);
    assert.equal(new URL(urls[2], "https://example.test").searchParams.has("cursor"), false);
    assert.deepEqual(resource.getState().items.map((item) => item.path), ["资料/新第一页.md"]);
  }
});

test("读取失败保留同查询已完成的结果并支持重试，完整 Note 不能伪装成卡片", async () => {
  let calls = 0;
  const resource = createReadModelResource(async () => {
    calls++;
    if (calls === 2) return Response.json({ error: "索引暂不可用" }, { status: 503 });
    return Response.json(page("r1", ["资料/保留.md"]));
  });
  await resource.query("/api/read-model/library");
  await resource.query("/api/read-model/library", true);
  assert.equal(resource.getState().error, "索引暂不可用");
  assert.deepEqual(resource.getState().items.map((item) => item.path), ["资料/保留.md"]);
  await resource.retry();
  assert.equal(resource.getState().error, "");
  const invalid = createReadModelResource(async () => Response.json({ revision: "r1", items: [{ path: "资料/全文.md", content: "整篇正文", frontmatter: {} }] }));
  await invalid.query("/api/read-model/search");
  assert.equal(invalid.getState().page, null);
  assert.match(invalid.getState().error, /格式无效/);
});

test("索引分批同步时遵循 Retry-After 重试并保留上一完整目录", async () => {
  let calls = 0;
  const resource = createReadModelResource(async () => {
    calls++;
    if (calls === 2 || calls === 3) return Response.json({ state: "building", error: "资料索引正在同步" }, { status: 503, headers: { "Retry-After": "0" } });
    return Response.json(page(calls === 1 ? "r1" : "r2", [calls === 1 ? "资料/旧.md" : "资料/新.md"]));
  });
  await resource.query("/api/read-model/library");
  const updating = resource.query("/api/read-model/library", true);
  assert.equal(resource.getState().loading, true);
  assert.equal(resource.getState().error, "");
  assert.deepEqual(resource.getState().items.map((item) => item.path), ["资料/旧.md"]);
  await updating;
  assert.equal(calls, 4);
  assert.equal(resource.getState().page.revision, "r2");
  assert.equal(resource.getState().loading, false);
});

test("同步重试等待可由新查询取消，超过时限后报告错误且保留旧目录", async () => {
  let calls = 0;
  const resource = createReadModelResource(async (url) => {
    calls++;
    return url.includes("old") ? Response.json({ state: "building" }, { status: 503, headers: { "Retry-After": "1" } }) : Response.json(page("r2", ["资料/新查询.md"]));
  });
  const old = resource.query("/api/read-model/search?q=old");
  await Promise.resolve(); await Promise.resolve();
  await resource.query("/api/read-model/search?q=new");
  await old;
  assert.equal(calls, 2);
  assert.equal(resource.getState().error, "");
  assert.equal(resource.getState().page.revision, "r2");
  let warming = false;
  const limited = createReadModelResource(async () => warming ? Response.json({ state: "building", error: "资料索引正在同步" }, { status: 503, headers: { "Retry-After": "1" } }) : Response.json(page("r1", ["资料/保留.md"])), { retryBudgetMs: 5 });
  await limited.query("/api/read-model/library");
  warming = true;
  await limited.query("/api/read-model/library", true);
  assert.equal(limited.getState().error, "资料索引正在同步");
  assert.deepEqual(limited.getState().items.map((item) => item.path), ["资料/保留.md"]);
});

test("200响应仍在构建时先展示完整旧版，再有界轮询到新版本；同步失败停止轮询", async () => {
  let calls = 0;
  const resource = createReadModelResource(async () => Response.json({ ...page(++calls === 1 ? "r1" : "r2", [calls === 1 ? "资料/旧.md" : "资料/新.md"]), syncState: calls === 1 ? "building" : "ready" }), { pollDelayMs: 5 });
  const shown = whenState(resource, (state) => state.syncState === "building");
  const loading = resource.query("/api/read-model/library");
  await shown;
  assert.equal(resource.getState().page.revision, "r1");
  assert.equal(resource.getState().syncState, "building");
  assert.equal(resource.getState().loading, false, "旧版可以立即使用");
  await loading;
  assert.equal(resource.getState().page.revision, "r2");
  assert.equal(resource.getState().syncState, "ready");
  let failures = 0;
  const failed = createReadModelResource(async () => { failures++; return Response.json({ ...page("r1", ["资料/保留.md"]), syncState: "failed" }); });
  await failed.query("/api/read-model/library");
  assert.equal(failures, 1);
  assert.equal(failed.getState().syncState, "failed");
  assert.equal(failed.getState().items.length, 1);
});

test("旧版构建轮询在切换查询后立即取消，预算到期保留完整旧版状态", async () => {
  const urls = [];
  const resource = createReadModelResource(async (url) => { urls.push(url); return Response.json({ ...page(url.includes("old") ? "r1" : "r2", ["资料/结果.md"]), syncState: url.includes("old") ? "building" : "ready" }); });
  const shown = whenState(resource, (state) => state.syncState === "building");
  const old = resource.query("/api/read-model/search?q=old");
  await shown;
  await resource.query("/api/read-model/search?q=new"); await old;
  assert.equal(urls.length, 2);
  assert.equal(resource.getState().page.revision, "r2");
  const limited = createReadModelResource(async () => Response.json({ ...page("r1", ["资料/保留.md"]), syncState: "building" }), { retryBudgetMs: 5, pollDelayMs: 20 });
  await limited.query("/api/read-model/library");
  assert.equal(limited.getState().syncState, "building");
  assert.equal(limited.getState().items.length, 1);
});
