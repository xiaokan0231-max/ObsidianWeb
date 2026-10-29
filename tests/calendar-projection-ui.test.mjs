import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCalendarSnapshot } from "../lib/server/calendar-snapshot.ts";
import { calendarModelFromSnapshot } from "../lib/calendar-snapshot.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const today = "2026-10-29";
const source = { path: "20_求職/テスト/振り返り.md", content: "# 架空の振り返り\n\n完整来源正文", frontmatter: { type: "review", company: "株式会社テスト", date: "2026-07-01", round: "一次面接" }, tags: [], stat: { ctime: 0, mtime: 0, size: 100 } };
const snapshot = buildCalendarSnapshot([source]);
const model = calendarModelFromSnapshot(snapshot, today);
const buckets = { "needs-user": 0, progressing: 0, unknown: 0, waiting: 2, paused: 0, closed: 0 };
const day = { date: today, companyCount: 2, positionCount: 3, bucketCounts: buckets };
const summary = { today, month: "2026-10", applications: { companyCount: 189, positionCount: 200, bucketCounts: { ...buckets, waiting: 189 } }, waitingCount: 17, historicalCount: 14, historicalTotal: 20 };
const emptyPage = { loaded: false, loading: false, error: "", total: 0, nextOffset: 0, eventIds: new Set(), events: [] };
const projection = (overrides = {}) => ({ model, summary, applicationDays: [day], revision: "r-calendar", loading: false, error: "", syncState: "ready", fetchedAt: 0,
  applications: { date: "", day: null, loading: false, error: "", fetchedAt: null }, history: { ...emptyPage }, recent: { ...emptyPage },
  onRangeChange() {}, loadApplications() {}, closeApplications() {}, loadHistory() {}, loadRecent() {}, refresh() {}, ...overrides,
});
const notes = [{ get content() { throw new Error("范围日历不应扫描全库正文"); }, get frontmatter() { throw new Error("范围日历不应扫描全库属性"); } }];
const props = (read) => ({ today, events: model.events, model, notes, interviewTargets: model.interviewTargets, projection: read, onOpen() { throw new Error("精简来源不能冒充完整Note"); }, onInterview() {} });
const locale = { useUiLocale: () => ({ locale: "zh-CN", setLocale() {} }) };
const browser = { location: { search: "?month=2026-10", pathname: "/calendar" }, history: { state: {}, replaceState() {} }, addEventListener() {}, removeEventListener() {} };

test("范围日历加载后继续采用月度预计算189汇总，日卡只使用独立摘要", async () => {
  const mod = await loadAppModule("app/calendar-view.tsx", { stubs: { "./ui-locale": locale }, globals: { window: browser } });
  const html = renderToStaticMarkup(React.createElement(mod.default, props(projection())));
  assert.match(html, /<strong>189<\/strong><span>家公司<\/span>/);
  assert.match(html, /200 个岗位/);
  assert.match(html, /无当前状态的历史场次 14 \/ 20 场/);
  assert.match(html, /AI 代投 2 家公司 · 3 个岗位/);
  assert.doesNotMatch(html, /calendar-application-panel|完整来源正文/);
  const pending = renderToStaticMarkup(React.createElement(mod.default, props(projection({ syncState: "building" }))));
  assert.match(pending, /资料索引正在同步，显示上次完整资料/);
  assert.match(pending, /<strong>189<\/strong>/);
});

const walk = (tree) => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(walk) : [tree, ...walk(tree.props?.children)];
const text = (tree) => tree == null || typeof tree === "boolean" ? "" : typeof tree !== "object" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : text(tree.props?.children);

test("日详情、历史说明和最近记录由操作触发，来源按精确路径与版本读取", async () => {
  let stateCursor = 0, refCursor = 0;
  const states = [], refs = [], effects = [], calls = [], opened = [];
  const read = projection();
  read.onRangeChange = (range) => calls.push(["range", range]);
  read.loadApplications = (date) => { calls.push(["applications", date]); read.applications = { date, day: null, loading: true, error: "", fetchedAt: null }; };
  read.loadHistory = () => { calls.push(["history"]); };
  read.loadRecent = () => { calls.push(["recent"]); };
  const mod = await loadAppModule("app/calendar-view.tsx", { stubs: {
    react: { ...React, useEffect: (effect) => effects.push(effect), useLayoutEffect() {}, useMemo: (factory) => factory(),
      useState(initial) { const index = stateCursor++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial; return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }]; },
      useRef(initial) { return refs[refCursor++] ??= { current: initial }; },
    }, "./ui-locale": locale,
    "./use-url-state": { enumCodec: () => ({}), useInitialUrlSearch: () => browser.location.search, useUrlState: (_key, initial) => [initial, () => {}] },
  }, globals: { window: browser } });
  const view = () => { stateCursor = 0; refCursor = 0; return mod.default.type({ ...props(read), onOpenPath: (...args) => opened.push(args) }); };
  let tree = view();
  while (effects.length) effects.shift()();
  assert.deepEqual(calls, [["range", { from: "2026-09-28", to: "2026-11-01", month: "2026-10" }]]);
  const trigger = walk(tree).find((element) => element.props?.className === "calendar-ai-applications");
  assert.equal("applications" in trigger.props.day, false);
  trigger.props.onOpen(day, { isConnected: true, focus() {} });
  tree = view();
  const panel = walk(tree).find((element) => element.props?.date === today && element.props?.onClose);
  assert.equal(panel.props.loading, true);
  assert.equal(panel.props.day, undefined);
  assert.equal(panel.props.summary, day);
  panel.props.onOpen(snapshot.events[0].event.note);
  assert.deepEqual(opened, [[source.path, "r-calendar"]]);
  walk(tree).find((element) => element.props?.className === "calendar-pulse-action status-neutral").props.onClick();
  tree = view();
  assert.ok(calls.some(([kind]) => kind === "applications"));
  assert.ok(calls.some(([kind]) => kind === "history"));
  const recent = walk(tree).find((element) => element.props?.className === "calendar-history");
  recent.props.onToggle({ currentTarget: { open: true } });
  assert.ok(calls.some(([kind]) => kind === "recent"));
  read.history = { ...emptyPage, loaded: true, total: 14, nextOffset: 12, eventIds: new Set([model.events[0].id]) };
  tree = view();
  const explanation = walk(tree).find((element) => element.props?.id === "calendar-historical-explanation");
  const more = walk(explanation).find((element) => element.type === "button" && text(element) === "再显示 12 场");
  assert.ok(more);
  more.props.onClick();
  assert.equal(calls.filter(([kind]) => kind === "history").length, 2);
});

test("单日摘要先显示已知公司数，详情加载或失败提供状态与重试，不冒称零记录", async () => {
  const mod = await loadAppModule("app/calendar-application-panel.tsx", { stubs: { "./ui-locale": locale } });
  for (const state of [{ loading: true }, { error: "暂不可用" }]) {
    const html = renderToStaticMarkup(React.createElement(mod.default, { date: today, summary: day, ...state, onClose() {}, onOpen() {}, onRetry() {} }));
    assert.match(html, /2 家公司 · 3 个岗位/);
    assert.doesNotMatch(html, /0 家公司|没有符合筛选的记录|已不在当前材料/);
    assert.match(html, state.loading ? /role="status"[^>]*>正在读取申请记录/ : /role="alert"/);
    if (state.error) assert.match(html, /重试/);
  }
});
