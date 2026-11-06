import assert from "node:assert/strict";
import test from "node:test";
import { calendarInitialRange, createCalendarProjectionResource } from "../app/calendar-projection-resource.ts";

const today = "2026-10-29";
const buckets = { "needs-user": 0, progressing: 0, unknown: 0, waiting: 2, paused: 0, closed: 0 };
const range = { from: "2026-09-28", to: "2026-11-01", month: "2026-10" };
const page = (revision = "r1", month = "2026-10", day = today) => ({ revision, today: day, snapshot: { schemaVersion: 1, events: [], applicationNotes: [], selectionCount: 2 },
  applicationDays: [{ date: "2026-10-29", companyCount: 2, positionCount: 3, bucketCounts: buckets }], historicalTotal: 14,
  summary: { today: day, month, applications: { companyCount: 189, positionCount: 200, bucketCounts: { ...buckets, waiting: 189 } }, waitingCount: 17, historicalCount: 14, historicalTotal: 20 },
});
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("初始月份包括自然周边界，周视图沿用URL中的JST日期", () => {
  assert.deepEqual(calendarInitialRange("?month=2026-10", today), range);
  assert.deepEqual(calendarInitialRange("?calview=week&calweek=2026-10-28", today), { from: "2026-10-26", to: "2026-11-01", month: "2026-10" });
  assert.deepEqual(calendarInitialRange("?month=invalid", today), range);
  assert.deepEqual(calendarInitialRange("?calview=week", "2026-11-02"), { from: "2026-11-02", to: "2026-11-08", month: "2026-11" });
  assert.deepEqual(calendarInitialRange("?calview=week&calweek=2026-11-31", today), { from: "2026-10-26", to: "2026-11-01", month: "2026-10" });
});

test("首屏只读取范围和汇总，申请按点击日期读取并绑定版本缓存", async () => {
  const urls = [];
  const day = { ...page().applicationDays[0], applications: [], companies: [] };
  const resource = createCalendarProjectionResource(async (url) => {
    urls.push(new URL(url, "https://example.test"));
    return Response.json(url.includes("/applications?") ? { revision: "r1", today, day } : page());
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
  assert.equal(urls[1].searchParams.get("today"), today);
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
    return Response.json({ revision: "r1", today, total: 14, nextOffset: offset === 0 ? 12 : null,
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
  assert.equal(urls[2].searchParams.get("today"), today);
  assert.equal(resource.getState().page.summary.applications.companyCount, 189);
  assert.ok(urls.every((url) => url.pathname.startsWith("/api/read-model/calendar/")));
});

test("切换范围、申请日期和资料版本时忽略迟到响应，不拼接不同版本", async () => {
  const late = deferred(), lateDay = deferred();
  const resource = createCalendarProjectionResource(async (url) => {
    if (url.includes("month=2026-09")) return late.promise;
    if (url.includes("/applications?") && url.includes("date=2026-10-28")) return lateDay.promise;
    if (url.includes("/applications?")) return Response.json({ revision: "r2", today, day: null });
    return Response.json(page("r2"));
  });
  const old = resource.onRangeChange({ ...range, month: "2026-09" });
  await resource.onRangeChange(range);
  late.resolve(Response.json(page("r1", "2026-09"))); await old;
  assert.equal(resource.getState().page.revision, "r2");
  const oldDay = resource.loadApplications("2026-10-28");
  await resource.loadApplications(today);
  lateDay.resolve(Response.json({ revision: "r2", today, day: { date: "2026-10-28" } })); await oldDay;
  assert.equal(resource.getState().applications.date, today);
  assert.equal(resource.getState().applications.day, null);
});

test("刷新失败保留上一完整版本；JST跨日或失效键重读当前范围", async () => {
  const urls = [];
  let fail = false;
  const resource = createCalendarProjectionResource(async (url) => {
    const parsed = new URL(url, "https://example.test");
    urls.push(parsed);
    return fail ? Response.json({ error: "索引暂不可用" }, { status: 503 }) : Response.json(page("r1", parsed.searchParams.get("month")));
  });
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
    if (url.includes("/history?")) return ++historyCalls === 1 ? Response.json({ revision: "r1", today, total: 14, nextOffset: 12, events: [{ event: { id: "first" } }] }) : Response.json({ error: "资料版本已过期" }, { status: 409 });
    return Response.json(page());
  });
  await resource.onRangeChange(range); await resource.loadHistory(); await resource.loadHistory();
  assert.equal(resource.getState().history.events.length, 1);
  assert.equal(resource.getState().history.error, "资料版本已过期");
  const day = resource.loadApplications(today); resource.closeApplications();
  pending.resolve(Response.json({ revision: "r1", today, day: {} })); await day;
  assert.equal(resource.getState().applications.date, "");
});

test("历史分页版本过期时保留旧页，待无固定版本的范围就绪后重读新版本第一页", async () => {
  const urls = [];
  const refreshedRange = deferred(), refreshing = deferred();
  const resource = createCalendarProjectionResource(async (url) => {
    const target = new URL(url, "https://example.test");
    urls.push(target);
    const revision = target.searchParams.get("revision");
    const offset = target.searchParams.get("offset");
    if (target.pathname.endsWith("/range")) {
      if (urls.length === 1) return Response.json(page());
      refreshing.resolve();
      return refreshedRange.promise;
    }
    if (revision === "r1" && offset === "12") return Response.json({ error: "资料版本已过期" }, { status: 409 });
    return Response.json({ revision, today, total: 14, nextOffset: 12, events: [{ event: { id: `${revision}-first` } }] });
  }, {}, { revision: "r1", today });
  await resource.onRangeChange(range);
  await resource.loadHistory();
  const pending = resource.loadHistory();
  await refreshing.promise;
  assert.deepEqual(resource.getState().history.events.map(({ event }) => event.id), ["r1-first"]);
  const joined = resource.loadHistory();
  assert.equal(joined, pending);
  refreshedRange.resolve(Response.json(page("r2")));
  await pending;
  assert.equal(resource.getState().page.revision, "r2");
  assert.deepEqual(resource.getState().history.events.map(({ event }) => event.id), ["r2-first"]);
  assert.equal(resource.getState().history.error, "");
  assert.deepEqual(urls.map((url) => [url.pathname.split("/").at(-1), url.searchParams.get("revision"), url.searchParams.get("offset")]), [
    ["range", "r1", null], ["history", "r1", "0"], ["history", "r1", "12"], ["range", null, null], ["history", "r2", "0"],
  ]);
});

test("最近记录单独按12条分页，不混进历史状态说明列表", async () => {
  const urls = [];
  const resource = createCalendarProjectionResource(async (url) => {
    const parsed = new URL(url, "https://example.test"); urls.push(parsed);
    if (!url.includes("/history?")) return Response.json(page());
    const offset = Number(parsed.searchParams.get("offset"));
    return Response.json({ revision: "r1", today, total: 18, nextOffset: offset === 0 ? 12 : null, events: Array.from({ length: offset === 0 ? 12 : 6 }, (_, index) => ({ event: { id: `recent-${offset + index}` } })) });
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

test("首个范围与 HTML 汇总同版同 JST 日期，种子过期只重新请求一次", async () => {
  for (const expired of [false, true]) {
    const urls = [];
    const resource = createCalendarProjectionResource(async (url) => {
      urls.push(new URL(url, "https://example.test"));
      if (expired && urls.length === 1) return Response.json({ error: "种子已过期" }, { status: 409 });
      return Response.json(expired ? page("r2", "2026-10", "2026-10-30") : page());
    }, {}, { revision: "r1", today });
    const first = resource.onRangeChange(range);
    await resource.synchronize(range, `${today}:0`);
    await first;
    await resource.onRangeChange(range);
    assert.equal(urls[0].searchParams.get("revision"), "r1");
    assert.equal(urls[0].searchParams.get("today"), today);
    assert.equal(urls.length, expired ? 2 : 1);
    if (expired) {
      assert.equal(urls[1].searchParams.has("revision"), false);
      assert.equal(urls[1].searchParams.has("today"), false);
      assert.equal(resource.getState().page.today, "2026-10-30");
    }
  }
});

test("取消翻月后返回重取未接受的月份，已接受的月份只读一次", async () => {
  const urls = [];
  const late = deferred();
  const next = { from: "2026-11-01", to: "2026-11-30", month: "2026-11" };
  const resource = createCalendarProjectionResource(async (url) => {
    urls.push(url);
    return urls.length === 2 ? late.promise : Response.json(page("r1", urls.length === 1 ? range.month : next.month));
  });
  await resource.synchronize(range, "same-day");
  const pending = resource.onRangeChange(next);
  resource.suspend();
  await resource.synchronize(next, "same-day");
  await resource.onRangeChange(next);
  late.resolve(Response.json(page("r0", next.month)));
  await pending;
  assert.equal(urls.length, 3);
  assert.equal(resource.getState().page.summary.month, next.month);
  assert.equal(resource.getState().page.revision, "r1");
});

test("同一版本跨 JST 日界也清理旧详情，拒绝上一日的申请响应", async () => {
  const next = "2026-10-30";
  let day = today;
  const resource = createCalendarProjectionResource(async (url) => {
    if (url.includes("/applications?")) return Response.json({ revision: "r1", today, day: {} });
    if (url.includes("/history?")) return Response.json({ revision: "r1", today, total: 1, nextOffset: null, events: [{ event: { id: "old" } }] });
    return Response.json(page("r1", range.month, day));
  });
  await resource.synchronize(range, today);
  await resource.loadHistory();
  assert.equal(resource.getState().history.events.length, 1);
  day = next;
  await resource.synchronize(range, next);
  assert.equal(resource.getState().history.events.length, 0);
  await resource.loadApplications(today);
  assert.equal(resource.getState().applications.day, null);
  assert.match(resource.getState().applications.error, /版本已更新/);
});

test("单日申请版本过期后，显式重试刷新范围并用新版本和 JST 日期打开同一天", async () => {
  let head = "r1";
  const newToday = "2026-10-30";
  const urls = [];
  const updatedDay = { ...page().applicationDays[0], companyCount: 3 };
  const resource = createCalendarProjectionResource(async (url) => {
    const target = new URL(url, "https://example.test");
    urls.push(target);
    if (target.pathname.endsWith("/range")) return Response.json(page(head, range.month, head === "r1" ? today : newToday));
    if (target.searchParams.get("revision") === "r1") return Response.json({ error: "资料版本已过期" }, { status: 409 });
    return Response.json({ revision: "r2", today: newToday, day: updatedDay });
  });
  await resource.onRangeChange(range);
  await resource.loadApplications(today);
  assert.equal(resource.getState().applications.error, "资料版本已过期");
  assert.equal(resource.getState().page.revision, "r1");
  head = "r2";
  await resource.loadApplications(today);
  assert.equal(resource.getState().page.revision, "r2");
  assert.deepEqual(resource.getState().applications.day, updatedDay);
  assert.equal(resource.getState().applications.error, "");
  assert.deepEqual(urls.slice(-3).map(({ pathname, searchParams }) => [pathname.split("/").at(-1), searchParams.get("revision"), searchParams.get("today"), searchParams.get("date")]), [
    ["applications", "r1", today, today], ["range", null, null, null], ["applications", "r2", newToday, today],
  ]);
  resource.closeApplications();
  const calls = urls.length;
  await resource.loadApplications(today);
  assert.equal(urls.length, calls, "新版同日详情从新版缓存读取");
});

test("单日申请换版中再次打开同一天会合并请求，关闭后旧恢复不能重开", async () => {
  const refreshing = deferred(), refreshedRange = deferred();
  const urls = [];
  const resource = createCalendarProjectionResource(async (url) => {
    const target = new URL(url, "https://example.test");
    urls.push(target);
    if (target.pathname.endsWith("/range")) {
      if (urls.length === 1) return Response.json(page());
      refreshing.resolve();
      return refreshedRange.promise;
    }
    return Response.json({ error: "资料版本已过期" }, { status: 409 });
  });
  await resource.onRangeChange(range);
  const pending = resource.loadApplications(today);
  await refreshing.promise;
  assert.equal(resource.loadApplications(today), pending);
  resource.closeApplications();
  refreshedRange.resolve(Response.json(page("r2")));
  await pending;
  assert.equal(resource.getState().page.revision, "r2");
  assert.equal(resource.getState().applications.date, "");
  assert.equal(urls.filter(({ pathname }) => pathname.endsWith("/applications")).length, 1);
});

test("背景探测同版只查状态，较新 ready 版本读取一次固定范围", async () => {
  const urls = [];
  let head = "r1";
  const resource = createCalendarProjectionResource(async (url) => {
    const target = new URL(url, "https://example.test");
    urls.push(target);
    return Response.json(target.pathname.endsWith("/warm") ? { state: "ready", revision: head } : page(head));
  });
  await resource.onRangeChange(range);
  await Promise.all([resource.checkFreshness(), resource.checkFreshness()]);
  assert.deepEqual(urls.map(({ pathname }) => pathname), ["/api/read-model/calendar/range", "/api/read-model/warm"]);
  head = "r2";
  await resource.checkFreshness();
  assert.equal(urls.length, 4);
  assert.equal(urls[3].searchParams.get("revision"), "r2");
  assert.equal(urls[3].searchParams.get("today"), today);
  assert.equal(resource.getState().page.revision, "r2");
});

test("暂停背景探测取消构建轮询并保留已接受的范围", async () => {
  const urls = [];
  const resource = createCalendarProjectionResource(async (url) => {
    urls.push(url);
    if (url.endsWith("/warm")) return Response.json({ state: "building", revision: "r2" });
    return Response.json({ ...page(), syncState: urls.length === 1 ? "ready" : "building" });
  }, { pollDelayMs: 50 });
  await resource.onRangeChange(range);
  const building = new Promise((resolve) => {
    const stop = resource.subscribe(() => { if (resource.getState().syncState === "building") { stop(); resolve(); } });
  });
  const pending = resource.checkFreshness();
  await building;
  resource.suspendFreshness();
  await pending;
  assert.equal(urls.length, 3);
  assert.equal(resource.getState().page.revision, "r1");
  assert.equal(resource.getState().error, "");
  assert.equal(resource.getState().loading, false);
});
