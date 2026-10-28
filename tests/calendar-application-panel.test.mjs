import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { AI_APPLICATION_BUCKETS, buildAiApplicationDays } from "../lib/calendar-applications.ts";

const note = (id, fields = {}) => ({ path: `20_求職/株式会社テスト/${id}.md`, content: `# 株式会社テスト — 求人${id}`, tags: [], stat: { mtime: 0, ctime: 0, size: 0 }, frontmatter: { type: "job-case", case_id: id, company: "株式会社テスト", position: `求人${id}`, status: "応募済", next_action: "記録された次の対応", application_actor: "ai", application_agent: "Codex", applied_on: "2026-08-10", ...fields } });
function fixture() {
  const companies = AI_APPLICATION_BUCKETS.map((bucket, index) => ({ key: `test-${index}`, company: `株式会社テスト${index}`, bucket,
    applications: Array.from({ length: index === 0 ? 23 : 1 }, (_, i) => {
      const id = `${index}-${i}`; const item = note(id, { company: `株式会社テスト${index}`, position: `原始岗位${id}`, status: bucket === "closed" ? "不採用（原始补充）" : "応募済" });
      return { id, date: "2026-08-10", company: item.frontmatter.company, companyKey: `test-${index}`, position: item.frontmatter.position, agent: "Codex", note: item, bucket,
        requiredActions: index === 0 && i === 0 ? [note("todo-required", { type: "todo", action: "原始待办要求" })] : [], reviewActions: index === 2 ? [note("todo-review", { type: "todo", action: "未核对待办原文" })] : [] };
    }),
  }));
  return { date: "2026-08-10", companyCount: 6, positionCount: 28, applications: companies.flatMap(company => company.applications), companies, bucketCounts: Object.fromEntries(AI_APPLICATION_BUCKETS.map(bucket => [bucket, 1])) };
}
const walk = value => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
const text = value => typeof value === "string" || typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
const find = (tree, predicate) => { const found = walk(tree).find(predicate); assert.ok(found); return found; };
const button = (tree, label) => find(tree, node => node.type === "button" && text(node).includes(label));

async function harness(exportName, initialProps, { locale = "zh-CN", file = "app/calendar-application-panel.tsx", effects = true, search = "?month=2026-08" } = {}) {
  let props = initialProps, stateCursor = 0, refCursor = 0, effectCursor = 0, clock = 0, timerId = 0, modal = false, inert = false;
  const states = [], refs = [], effectSlots = [], queue = [], timers = new Map(), listeners = new Map(), calls = [];
  const browser = { innerWidth: 1440, innerHeight: 900, location: new URL(`http://localhost:3000/calendar${search}`),
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type),
    history: { state: {}, replaceState() {} } };
  const effect = (fn, deps) => {
    const index = effectCursor++; const previous = effectSlots[index];
    if (!effects || (previous && deps && previous.deps?.length === deps.length && deps.every((dep, i) => Object.is(dep, previous.deps[i])))) return;
    queue.push(() => { previous?.cleanup?.(); effectSlots[index] = { deps, cleanup: fn() }; });
  };
  const portalBody = {};
  const components = await loadAppModule(file, { globals: { window: browser, document: { body: portalBody, querySelector: () => modal ? {} : null },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: clock + delay }); return id; }, clearTimeout: id => timers.delete(id) },
    stubs: {
      react: { ...React, useState(initial) { const slot = stateCursor++; if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial; return [states[slot], value => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }]; },
        useRef(initial) { const slot = refCursor++; return refs[slot] ??= { current: initial }; }, useEffect: effect, useLayoutEffect: effect, useMemo: fn => fn() },
      "./ui-locale": { useUiLocale: () => ({ locale }) },
      "react-dom": { createPortal: (children, target) => { assert.equal(target, portalBody); return children; } },
      "./use-url-state": { enumCodec: () => ({}), useInitialUrlSearch: () => browser.location.search, useUrlState: (key, fallback) => [browser.location.searchParams.get(key) ?? fallback, () => {}] },
    },
  });
  const Component = components[exportName];
  const view = () => { stateCursor = 0; refCursor = 0; effectCursor = 0; return (Component.type ?? Component)(props); };
  return { view, html: () => renderToStaticMarkup(view()), props: value => { props = { ...props, ...value }; }, calls, refs, listeners,
    flush() { while (queue.length) queue.shift()(); },
    advance(ms) { clock += ms; for (const [id, item] of timers) if (item.at <= clock) { timers.delete(id); item.fn(); } },
    modal(value) { modal = value; }, inert(value) { inert = value; },
    mountRefs(tree = view()) { for (const node of walk(tree)) if (node.props?.ref && typeof node.props.ref === "object") node.props.ref.current = { focus: () => calls.push(["focus", node.props.className]), closest: () => inert ? {} : null, scrollTop: 0, getBoundingClientRect: () => ({ left: 1300, bottom: 850 }) }; },
    cleanup() { for (const slot of effectSlots) slot?.cleanup?.(); },
  };
}

test("悬停和键盘聚焦等300ms后显示纯文本预览，离开或点击取消；按钮原生支持Enter/Space", async () => {
  const opened = []; const day = fixture();
  const h = await harness("CalendarApplicationTrigger", { day, expanded: false, className: "calendar-ai-applications", label: "申请详情", children: "代投", onOpen: (...args) => opened.push(args) });
  let tree = h.view(); h.mountRefs(tree); h.flush();
  const trigger = () => find(h.view(), node => node.type === "button");
  trigger().props.onPointerEnter(); h.advance(299); assert.equal(h.html().includes('role="tooltip"'), false);
  h.advance(1); let html = h.html(); assert.ok(html.includes('role="tooltip"')); assert.ok(html.includes("6 家公司 · 28 个岗位")); assert.equal(html.includes("原始岗位"), false);
  const preview = find(h.view(), node => node.props?.role === "tooltip"); assert.equal(walk(preview).some(node => ["button", "a", "input"].includes(node.type)), false);
  assert.deepEqual(preview.props.style, { left: 1108, top: 670 });
  trigger().props.onPointerLeave(); assert.equal(h.html().includes('role="tooltip"'), false);
  trigger().props.onFocus(); h.advance(300); assert.ok(h.html().includes('role="tooltip"'));
  const element = { isConnected: true }; trigger().props.onClick({ currentTarget: element }); assert.deepEqual(opened, [[day, element]]); assert.equal(h.html().includes('role="tooltip"'), false);
  assert.equal(trigger().type, "button"); assert.equal(trigger().props.type, "button");
  h.props({ expanded: true }); trigger().props.onFocus(); h.advance(300); assert.equal(h.html().includes('role="tooltip"'), false);
  h.props({ expanded: false }); trigger().props.onFocus(); h.cleanup(); h.advance(300); assert.equal(h.html().includes('role="tooltip"'), false);
});

test("公司进展条按互斥公司数绘制，隐藏零桶，精简图例仍保留完整无障碍语义", async () => {
  const bucketCounts = { "needs-user": 0, progressing: 0, unknown: 0, waiting: 1, paused: 0, closed: 7 };
  const h = await harness("ApplicationProgressBar", { bucketCounts, legend: "counts" });
  const tree = h.view();
  assert.equal(tree.props.role, "img");
  assert.equal(tree.props["aria-label"], "当前进展（公司数）：等待对方 1 · 已结束 7");
  const segments = walk(tree).filter(node => node.props?.className === "application-progress-segment");
  assert.deepEqual(segments.map(node => [node.props["data-bucket"], node.props.style.width]), [["waiting", "12.5%"], ["closed", "87.5%"]]);
  const legend = find(tree, node => node.props?.className === "application-progress-legend application-progress-legend-counts");
  assert.equal(legend.props["aria-hidden"], "true");
  assert.equal(text(legend), "17");
  h.props({ legend: "labels" });
  assert.equal(text(find(h.view(), node => node.props?.className === "application-progress-legend application-progress-legend-labels")), "等待对方1已结束7");
  h.props({ legend: "none", bucketCounts: Object.fromEntries(AI_APPLICATION_BUCKETS.map(bucket => [bucket, 0])) });
  assert.equal(walk(h.view()).filter(node => node.props?.className === "application-progress-segment").length, 0);
  assert.equal(h.html().includes("NaN"), false);
});

test("日卡图形使用公司桶，不把同公司的多个岗位重复计算；按钮完整朗读进展", async () => {
  const day = fixture();
  const h = await harness("CalendarApplicationTrigger", { day, expanded: false, className: "calendar-ai-applications", label: "6 家公司 · 28 个岗位", children: "代投 6家", showCounts: true, onOpen() {} });
  const trigger = find(h.view(), node => node.type === "button");
  assert.ok(trigger.props["aria-label"].includes("6 家公司 · 28 个岗位"));
  for (const value of ["待我处理 1", "推进中 1", "待核对 1", "等待对方 1", "暂缓 1", "已结束 1"]) assert.ok(trigger.props["aria-label"].includes(value), value);
  const graphic = find(h.view(), node => node.props?.className === "calendar-ai-graphic");
  assert.equal(graphic.props["aria-hidden"], "true");
  assert.equal(graphic.props.children.props.bucketCounts, day.bucketCounts);
  assert.equal(graphic.props.children.props.legend, "counts");
  assert.equal(h.html().includes("calendar-ai-counts"), false);
});

test("固定非模态面板完整呈现23岗位公司组、六互斥公司筛选、原状态/下一步与真实读取时间", async () => {
  const { default: Panel } = await loadAppModule("app/calendar-application-panel.tsx");
  const html = renderToStaticMarkup(React.createElement(Panel, { day: fixture(), date: "2026-08-10", fetchedAt: Date.parse("2026-08-10T02:34:00Z"), onClose() {}, onOpen() {}, onOpenCompany() {} }));
  assert.equal((html.match(/class="calendar-application-company"/g) ?? []).length, 6);
  assert.equal((html.match(/class="calendar-application-position"/g) ?? []).length, 28);
  assert.ok(html.includes("原始岗位0-22")); assert.ok(html.includes("不採用（原始补充）")); assert.ok(html.includes("記録された次の対応")); assert.ok(html.includes("原始待办要求"));
  for (const value of ["8月10日代投 · 当前进展", "待我处理", "推进中", "待核对", "等待对方", "暂缓", "已结束", "站内未实时核验", "11:34 JST"]) assert.ok(html.includes(value), value);
  assert.equal(html.includes('aria-modal="true"'), false); assert.equal(html.includes('role="dialog"'), false);
  assert.match(html, /class="calendar-application-scroll" tabindex="0"/);
});

test("筛选/搜索仅影响面板；开来源和公司带精确Note，Note回读后状态与滚动不清空", async () => {
  const day = fixture(), opened = [], companies = [];
  const h = await harness("default", { day, date: day.date, onClose() {}, onOpen: note => opened.push(note), onOpenCompany: (...args) => companies.push(args) });
  h.mountRefs(); h.flush();
  button(h.view(), "待我处理").props.onClick(); assert.equal((h.html().match(/class="calendar-application-company"/g) ?? []).length, 1);
  const input = find(h.view(), node => node.type === "input"); input.props.onChange({ target: { value: "原始岗位0-22" } });
  assert.equal((h.html().match(/class="calendar-application-position"/g) ?? []).length, 1);
  const scroll = find(h.view(), node => node.props?.className === "calendar-application-scroll").props.ref.current; scroll.scrollTop = 456;
  button(h.view(), "查看来源记录").props.onClick(); assert.equal(opened[0], day.companies[0].applications[22].note);
  button(h.view(), "查看公司").props.onClick(); assert.deepEqual(companies[0], [day.companies[0].company, day.companies[0].applications[22].note]);
  h.props({ day: { ...day } }); h.view(); h.flush();
  assert.equal(scroll.scrollTop, 456); assert.equal(find(h.view(), node => node.type === "input").props.value, "原始岗位0-22"); assert.equal(button(h.view(), "待我处理").props["aria-pressed"], true);
  input.props.onChange({ target: { value: "no-match" } }); assert.ok(h.html().includes("没有符合筛选的记录")); button(h.view(), "清空搜索").props.onClick(); assert.equal(find(h.view(), node => node.type === "input").props.value, "");
});

test("Escape只关最上层：原笔记或inert时不关面板，无模态层时关闭且移除监听", async () => {
  let closed = 0; const h = await harness("default", { day: fixture(), date: "2026-08-10", onClose: () => closed++, onOpen() {} });
  h.mountRefs(); h.flush(); assert.ok(h.calls.some(call => call[1] === "calendar-application-close"));
  const event = { key: "Escape", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {} };
  h.modal(true); h.listeners.get("keydown")({ ...event }); assert.equal(closed, 0);
  h.modal(false); h.inert(true); h.listeners.get("keydown")({ ...event }); assert.equal(closed, 0);
  h.inert(false); h.listeners.get("keydown")({ ...event }); assert.equal(closed, 1);
  h.cleanup(); assert.equal(h.listeners.has("keydown"), false);
});

test("月/周使用同一触发器打开固定面板；关面板焦点回原按钮，开Note不关闭面板", async () => {
  const record = note("one"); const day = buildAiApplicationDays([record], "2026-08-10")[0];
  for (const search of ["?month=2026-08", "?calview=week&calweek=2026-08-10"]) {
    const opened = []; const h = await harness("default", { today: "2026-08-10", notes: [record], events: [], interviewTargets: new Map(), onOpen: item => opened.push(item), onInterview() {} }, { file: "app/calendar-view.tsx", effects: false, search });
    let tree = h.view();
    if (search.includes("calview")) { const week = find(tree, node => node.props?.onShowApplications); assert.ok(week.type(week.props).props); tree = week.type(week.props); }
    const trigger = find(tree, node => node.props?.day?.date === day.date && node.props?.className !== "calendar-application-open");
    let focused = 0; trigger.props.onOpen(day, { isConnected: true, focus: () => focused++ });
    const panel = () => find(h.view(), node => node.props?.date === day.date && node.props?.onClose);
    assert.equal(panel().key, day.date); panel().props.onOpen(record); assert.equal(opened[0], record); assert.equal(panel().props.date, day.date);
    panel().props.onClose(); assert.equal(focused, 1); assert.equal(walk(h.view()).some(node => node.props?.date === day.date && node.props?.onClose), false);
  }
});

test("日语界面翻译状态/操作/空态，原岗位和状态不改写且没有读取时间时不编造", async () => {
  const h = await harness("default", { day: fixture(), date: "2026-08-10", onClose() {}, onOpen() {} }, { locale: "ja" });
  const html = h.html(); for (const value of ["8月10日の代行応募 · 現在の進捗", "対応が必要", "選考進行中", "要確認", "返信待ち", "保留", "終了", "読み込み時刻は未提供", "リアルタイムに確認していません", "原始岗位0-22", "不採用（原始补充）", "出典の記録を見る"]) assert.ok(html.includes(value), value);
  assert.equal(html.includes("资料读取"), false); assert.equal(html.includes("待我处理"), false);
  find(h.view(), node => node.type === "input").props.onChange({ target: { value: "no-match" } }); assert.ok(h.html().includes("条件に一致する記録はありません"));
});
