import assert from "node:assert/strict";
import test from "node:test";
import { calendarInitialRange, createCalendarProjectionResource } from "../app/calendar-projection-resource.ts";

const today = "2026-10-29";
const buckets = { "needs-user": 0, progressing: 0, unknown: 0, waiting: 2, paused: 0, closed: 0 };
const range = { from: "2026-09-28", to: "2026-11-01", month: "2026-10" };
const page = (revision = "r1", month = "2026-10") => ({ revision, today, snapshot: { schemaVersion: 1, events: [], applicationNotes: [], selectionCount: 2 },
  applicationDays: [{ date: "2026-10-29", companyCount: 2, positionCount: 3, bucketCounts: buckets }], historicalTotal: 14,
  summary: { today, month, applications: { companyCount: 189, positionCount: 200, bucketCounts: { ...buckets, waiting: 189 } }, waitingCount: 17, historicalCount: 14, historicalTotal: 20 },
});
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("初始月份包括自然周边界，周视图沿用URL中的JST日期", () => {
  assert.deepEqual(calendarInitialRange("?month=2026-10", today), range);
  assert.deepEqual(calendarInitialRange("?calview=week&calweek=2026-10-28", today), { from: "2026-10-26", to: "2026-11-01", month: "2026-10" });
  assert.deepEqual(calendarInitialRange("?month=invalid", today), range);
  assert.deepEqual(calendarInitialRange("?calview=week", "2026-11-02"), { from: "2026-11-02", to: "2026-11-08", month: "2026-11" });
});

test("首屏只读取范围和汇总，申请按点击日期读取并绑定版本缓存", async () => {
  const urls = [];
  const day = { ...page().applicationDays[0], applications: [], companies: [] };
  const resource = createCalendarProjectionResource(async (url) => {
    urls.push(new URL(url, "https://example.test"));
    return Response.json(url.includes("/applications?") ? { revision: "r1", day } : page());
  });
  await resource.onRangeChange(range);
  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname, "/api/read-model/calendar/range");
  assert.equal(urls[0].searchParams.get("from"), range.from);
  assert.equal(resource.getState().page.summary.applications.companyCount, 189);
  assert.equal("applications" in resource.getState().page.applicationDays[0], false);
  await resource.loadApplications(today);
  assert.equal(urls[1].searchParams.get("date"), today);
  assert.equal(urls[1].searchParams.get("revision"), "r1");
  assert.deepEqual(resource.getState().applications.day, day);
  assert.ok(resource.getState().applications.fetchedAt > 0);
  resource.closeApplications();
  await resource.loadApplications(today);
  assert.equal(urls.length, 2, "同版本重开已完成的日期不会重新下载");
});

test("历史说明12条翻页绑定版本，加载历史不会改写月度汇总", async () => {
  const urls = [];
  const resource = createCalendarProjectionResource(async (url) => {
    const parsed = new URL(url, "https://example.test"); urls.push(parsed);
    if (!url.includes("/history?")) return Response.json(page());
    const offset = Number(parsed.searchParams.get("offset"));
    return Response.json({ revision: "r1", total: 14, nextOffset: offset === 0 ? 12 : null,
      events: Array.from({ length: offset === 0 ? 12 : 2 }, (_, index) => ({ event: { id: `history-${offset + index}` } })) });
  });
  await resource.onRangeChange(range);
  assert.equal(resource.getState().history.loaded, false);
  await resource.loadHistory();
  assert.equal(resource.getState().history.events.length, 12);
  await resource.loadHistory();
  assert.equal(resource.getState().history.events.length, 14);
  assert.equal(urls[2].searchParams.get("offset"), "12");
  assert.equal(urls[2].searchParams.get("revision"), "r1");
  assert.equal(resource.getState().page.summary.applications.companyCount, 189);
  assert.ok(urls.every((url) => url.pathname.startsWith("/api/read-model/calendar/")));
});

test("切换范围、申请日期和资料版本时忽略迟到响应，不拼接不同版本", async () => {
  const late = deferred(), lateDay = deferred();
  const resource = createCalendarProjectionResource(async (url) => {
    if (url.includes("month=2026-09")) return late.promise;
    if (url.includes("/applications?") && url.includes("date=2026-10-28")) return lateDay.promise;
    if (url.includes("/applications?")) return Response.json({ revision: "r2", day: null });
    return Response.json(page("r2"));
  });
  const old = resource.onRangeChange({ ...range, month: "2026-09" });
  await resource.onRangeChange(range);
  late.resolve(Response.json(page("r1", "2026-09"))); await old;
  assert.equal(resource.getState().page.revision, "r2");
  const oldDay = resource.loadApplications("2026-10-28");
  await resource.loadApplications(today);
  lateDay.resolve(Response.json({ revision: "r2", day: { date: "2026-10-28" } })); await oldDay;
  assert.equal(resource.getState().applications.date, today);
  assert.equal(resource.getState().applications.day, null);
});

test("刷新失败保留上一完整版本；JST跨日或失效键重读当前范围", async () => {
  const urls = [];
  let fail = false;
  const resource = createCalendarProjectionResource(async (url) => { urls.push(url); return fail ? Response.json({ error: "索引暂不可用" }, { status: 503 }) : Response.json(page()); });
  await resource.synchronize(range, `${today}:0`);
  const selected = { from: "2026-11-01", to: "2026-11-30", month: "2026-11" };
  await resource.onRangeChange(selected);
  await resource.synchronize(range, "2026-10-30:0");
  assert.equal(new URL(urls.at(-1), "https://example.test").searchParams.get("month"), "2026-11");
  fail = true; await resource.refresh();
  assert.equal(resource.getState().error, "索引暂不可用");
  assert.equal(resource.getState().page.revision, "r1");
  assert.equal(resource.getState().page.summary.applications.companyCount, 189);
});

test("历史版本过期时保留已加载说明，关闭后的申请响应不能重新打开", async () => {
  const pending = deferred();
  let historyCalls = 0;
  const resource = createCalendarProjectionResource(async (url) => {
    if (url.includes("/applications?")) return pending.promise;
    if (url.includes("/history?")) return ++historyCalls === 1 ? Response.json({ revision: "r1", total: 14, nextOffset: 12, events: [{ event: { id: "first" } }] }) : Response.json({ error: "资料版本已过期" }, { status: 409 });
    return Response.json(page());
  });
  await resource.onRangeChange(range); await resource.loadHistory(); await resource.loadHistory();
  assert.equal(resource.getState().history.events.length, 1);
  assert.equal(resource.getState().history.error, "资料版本已过期");
  const day = resource.loadApplications(today); resource.closeApplications();
  pending.resolve(Response.json({ revision: "r1", day: {} })); await day;
  assert.equal(resource.getState().applications.date, "");
});

test("最近记录单独按12条分页，不混进历史状态说明列表", async () => {
  const urls = [];
  const resource = createCalendarProjectionResource(async (url) => {
    const parsed = new URL(url, "https://example.test"); urls.push(parsed);
    if (!url.includes("/history?")) return Response.json(page());
    const offset = Number(parsed.searchParams.get("offset"));
    return Response.json({ revision: "r1", total: 18, nextOffset: offset === 0 ? 12 : null, events: Array.from({ length: offset === 0 ? 12 : 6 }, (_, index) => ({ event: { id: `recent-${offset + index}` } })) });
  });
  await resource.onRangeChange(range); await resource.loadRecent(); await resource.loadRecent();
  assert.equal(resource.getState().recent.events.length, 18);
  assert.equal(resource.getState().history.loaded, false);
  assert.equal(resource.getState().history.events.length, 0);
  assert.equal(urls[2].searchParams.get("scope"), "recent");
  assert.equal(urls[2].searchParams.get("offset"), "12");
});

test("范围返回完整旧版时先显示汇总，再轮询等待新索引完成", async () => {
  let calls = 0;
  const resource = createCalendarProjectionResource(async () => Response.json({ ...page(++calls === 1 ? "r1" : "r2"), syncState: calls === 1 ? "building" : "ready" }), { pollDelayMs: 5 });
  const shown = new Promise((resolve) => { const stop = resource.subscribe(() => { if (resource.getState().syncState === "building") { stop(); resolve(); } }); });
  const pending = resource.onRangeChange(range);
  await shown;
  assert.equal(resource.getState().syncState, "building");
  assert.equal(resource.getState().page.summary.applications.companyCount, 189);
  await pending;
  assert.equal(resource.getState().page.revision, "r2");
  assert.equal(resource.getState().syncState, "ready");
});
