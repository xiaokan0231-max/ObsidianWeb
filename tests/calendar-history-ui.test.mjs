import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const today = "2026-10-05";
const sensitiveResult = "面談完了・旧準備作業：架空メモ・担当者：テスト担当・参考金額：999";
const note = (id, fields = {}) => ({ path: `20_求職/株式会社テスト/${id}.md`, frontmatter: { type: "review", company: `株式会社テスト${id}`, date: "2026-07-10", round: "一次面接", ...fields }, content: "# 元の振り返り\n原文の記録を保持。", tags: [], stat: { ctime: 0, mtime: 1, size: 0 } });
const historyNotes = [
  ...[1, 2, 3, 4].map((id) => note(`不採用${id}`, { date: `2026-07-0${id}`, result: "不採用" })),
  note("通過", { date: "2026-06-15", result: "通過" }),
  note("面談", { date: "2026-07-05", result: sensitiveResult }),
  note("翌日", { date: "2026-08-15", result: "翌日の返信で終了を記録" }),
  note("未関連", { date: "2026-09-01" }),
  note("参照欠落", { date: "2026-07-06", meeting: "[[20_求職/_TODO/未収録面談.md]]" }),
];
const event = (source, fields = {}) => ({ id: source.path, note: source, kind: "event", date: source.frontmatter.date, time: "10:00", company: source.frontmatter.company, label: "一次面接", phase: "past", caseId: source.frontmatter.case_id || "", prepPath: "", ...fields });
const historyEvents = historyNotes.map((source) => event(source));
const props = { today, notes: historyNotes, events: historyEvents, interviewTargets: new Map(), onOpen() {}, onInterview() {} };
async function render({ locale = "zh-CN", search = "?month=2026-07", ...overrides } = {}) {
  const viewModule = await loadAppModule("app/calendar-view.tsx", { stubs: { "./ui-locale": { useUiLocale: () => ({ locale }) } }, globals: { window: { location: { search } } } });
  return renderToStaticMarkup(createElement(viewModule.default, { ...props, ...overrides }));
}
const walk = (value) => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
const text = (value) => value == null || typeof value === "boolean" ? "" : typeof value !== "object" ? String(value) : Array.isArray(value) ? value.map(text).join("") : text(value.props?.children);
const find = (tree, predicate) => { const item = walk(tree).find(predicate); assert.ok(item); return item; };
const button = (tree, label) => find(tree, (item) => item.type === "button" && (text(item.props.children) === label || item.props["aria-label"] === label));
const historyControl = (html) => {
  const control = html.match(/<button\b[^>]*aria-controls="calendar-historical-explanation"[^>]*>[\s\S]*?<\/button>/)?.[0];
  assert.ok(control, "历史说明保留独立展开入口");
  return control;
};
function assertHistoryCount(html, count, total, locale = "zh-CN") {
  const control = historyControl(html);
  const label = locale === "ja" ? `現在の状態がない過去の予定 ${count} / ${total} 件 · 期間を問わず` : `无当前状态的历史场次 ${count} / ${total} 场 · 不限月份`;
  assert.ok(control.includes(`aria-label="${label}"`), "短标题仍通过完整无障碍名称交代计数对象和范围");
  assert.ok(control.includes(`<strong>${count}</strong>`));
  assert.ok(control.includes(locale === "ja" ? `<small>/ ${total} 件 · 期間を問わず</small>` : `<small>/ ${total} 场 · 不限月份</small>`));
}
async function interactive() {
  let cursor = 0, refCursor = 0;
  const states = [], refs = [], opened = [], openedNotes = [], reviewed = [];
  const target = { view: "review", path: historyNotes[0].path, sourcePath: historyNotes[0].path, company: historyNotes[0].frontmatter.company, date: historyNotes[0].frontmatter.date, label: "一次面接", caseId: "" };
  const viewModule = await loadAppModule("app/calendar-view.tsx", {
    stubs: { react: { memo: (component) => component, useMemo: (fn) => fn(), useEffect() {}, useLayoutEffect() {}, useRef(initial) { return refs[refCursor++] ??= { current: initial }; }, useState(initial) { const slot = cursor++; if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial; return [states[slot], (next) => { states[slot] = typeof next === "function" ? next(states[slot]) : next; }]; } },
      "./use-url-state": { enumCodec: (values) => ({ parse: (raw) => values.includes(raw) ? raw : null }), useUrlState: (key, initial) => [initial, () => {}] },
      "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN" }) },
    }, globals: { window: { location: { search: "?month=2026-07" } } },
  });
  const view = () => { cursor = 0; refCursor = 0; return viewModule.default({ ...props, interviewTargets: new Map([[historyEvents[0].id, target]]), onOpen: (source) => { opened.push(source.path); openedNotes.push(source); }, onInterview: (entry) => reviewed.push(entry.id) }); };
  return { view, opened, openedNotes, reviewed, viewModule };
}

test("旧复盘保留当轮结果：四条不採用关闭，其他历史中性显示且无虚假警示", async () => {
  const html = await render();
  const cards = [...html.matchAll(/<button\b[^>]*class="calendar-event [^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
  assert.equal(cards.length, 6, "七月六场保持原日历位置");
  assert.equal(cards.filter((card) => card.includes("status-closed")).length, 4);
  assert.equal(cards.filter((card) => card.includes("status-neutral")).length, 2);
  assert.equal(cards.filter((card) => card.includes("status-unknown")).length, 0);
  assert.match(cards[0], /当轮未通过/); assert.match(cards[0], /当轮历史结果，不代替当前案件状态/);
  // 短标题节省首屏宽度；完整可访问名称仍明确子集与全部已发生场次的关系。
  assertHistoryCount(html, 9, 9);
  assert.match(html, /日程状态图例/); assert.match(html, />历史记录<\/button>/);
  assert.doesNotMatch(html, /资料待核对|calendar-legend-item status-unknown|calendar-association-conflicts/);
  assert.doesNotMatch(html, /calendar-historical-explanation" id=/, "说明列表默认收起");
});

test("历史入口跨月周仍保持全量口径，未来安排与月度投递各自独立", async () => {
  for (const search of ["?month=2026-07", "?month=2026-08", "?calview=week&calweek=2026-07-06"]) {
    const html = await render({ search });
    assertHistoryCount(html, 9, 9);
    assert.match(html, /<h2>未来 7 天<\/h2><span>0<\/span>/);
    assert.match(html, /class="calendar-month-applications"/);
    assert.match(html, /当前月份暂无已确认的 AI 代投/);
    assert.doesNotMatch(html, /calendar-next-hero|今天 AI 代投|未来 7 天场次/);
    assert.doesNotMatch(html, /资料待核对|status-unknown/);
  }
  const loading = await render({ loading: true });
  assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(historyControl(loading), /<strong>/, "加载中不提前给出历史计数");
});

test("历史说明可展开九场理由与精确原始来源，打开记录不新增操作", async () => {
  const ui = await interactive();
  const toggle = find(ui.view(), (item) => item.type === "button" && item.props["aria-controls"] === "calendar-historical-explanation");
  assert.equal(toggle.props["aria-expanded"], false); toggle.props.onClick();
  const tree = ui.view();
  assert.equal(find(tree, (item) => item.type === "button" && item.props["aria-controls"] === "calendar-historical-explanation").props["aria-expanded"], true);
  const listing = find(tree, (item) => typeof item.type === "function" && item.type.name === "CalendarRecordExplanationList");
  assert.equal(listing.props.events.length, 9);
  const content = listing.type(listing.props);
  assert.equal(walk(content).filter((item) => item.type === "li").length, 9);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /这些是日程记录，不是本人待办；当轮结果不代表当前选考状态/);
  assert.match(html, /不限当前显示的月份或周/);
  assert.match(html, /当轮通过/); assert.match(html, /面谈已完成/); assert.match(html, /当轮结果已记录/); assert.doesNotMatch(html, /旧準備作業|テスト担当|999|翌日の返信で終了を記録/);
  const sourceLabel = `${historyNotes[0].frontmatter.date} · ${historyNotes[0].frontmatter.company} · 查看原始记录`;
  button(content, sourceLabel).props.onClick();
  const links = find(content, (item) => typeof item.type === "function" && item.type.name === "CalendarInterviewLinks" && item.props.targets?.review?.sourcePath === historyEvents[0].note.path);
  links.props.onNavigate("review");
  assert.deepEqual(ui.opened, [historyNotes[0].path]); assert.deepEqual(ui.reviewed, [historyEvents[0].id]);
  button(content, `${historyNotes[5].frontmatter.date} · ${historyNotes[5].frontmatter.company} · 查看原始记录`).props.onClick();
  assert.equal(ui.openedNotes.at(-1).frontmatter.result, sensitiveResult, "原始记录完整保留，只有主动打开才交给阅读器");
  button(tree, "收起历史状态说明").props.onClick();
  assert.equal(walk(ui.view()).some((item) => item.props?.id === "calendar-historical-explanation"), false);
});

test("只有明确关联冲突保留警示及来源说明，不计入历史说明数字", async () => {
  const one = note("案件一", { type: "job-case", case_id: "ambiguous", status: "面接中" });
  const two = note("案件二", { type: "job-case", case_id: "ambiguous", status: "応募済" });
  const conflicting = note("冲突复盘", { case_id: "ambiguous", result: "通過" });
  const html = await render({ notes: [...historyNotes, one, two, conflicting], events: [...historyEvents, event(conflicting)] });
  assertHistoryCount(html, 9, 10);
  assert.match(html, /calendar-legend-item status-unknown/);
  assert.match(html, /<details class="calendar-association-conflicts"><summary>关联冲突 1 场<\/summary>/);
  assert.match(html, /明确的关联冲突/); assert.match(html, /不计为本人待办/);
  assert.match(html, /calendar-event past kind-event status-unknown/);
  assert.match(html, /冲突复盘/);
});

test("日语历史说明区分当轮结果和当前状态，自由文本仅通过主动打开来源查看", async () => {
  const html = await render({ locale: "ja" });
  assert.match(html, /予定の状態の凡例/);
  assertHistoryCount(html, 9, 9, "ja");
  assert.doesNotMatch(html, /全履歴|過去の全予定/);
  assert.match(html, /当該回は不採用/); assert.match(html, /面談実施済み/); assert.match(html, /現在の選考状況は推測しません/); assert.doesNotMatch(html, /旧準備作業|テスト担当|999|翌日の返信で終了を記録/);
  assert.doesNotMatch(html, /資料の確認が必要|资料待核对|当轮未通过|关联冲突/);
});

test("历史中性色在月周图例与高亮一致，黄金只保留明确关联冲突", async () => {
  const css = await readFile(new URL("../app/styles/calendar-density.css", import.meta.url), "utf8");
  assert.match(css, /\.calendar-view \.status-neutral \{ --calendar-status-color: var\(--text-tertiary\); \}/);
  assert.match(css, /data-focus-tone="neutral"\] :is\(\.calendar-event, \.agenda-item\)\.status-neutral/);
  assert.match(css, /data-focus-tone="neutral"\] :is\(\.cw-block, \.cw-chip\)\.status-neutral/);
  const source = await readFile(new URL("../app/calendar-view.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /postJson|\/api\/todos|onNoteWritten/);
});

test("同日已有复盘及已结束旧预约不列入未来安排，日历事实和原始来源保留", async () => {
  const completed = note("已复盘", { date: today, result: "通過", company: "株式会社テスト既実施" });
  const closed = note("已结束预约", { type: "job-case", case_id: "closed", date: "2026-10-06", status: "不採用", company: "株式会社テスト終了" });
  const html = await render({ search: "?month=2026-10", notes: [completed, closed], events: [event(completed, { phase: "upcoming" }), event(closed, { phase: "upcoming" })] });
  assert.match(html, /<h2>未来 7 天<\/h2><span>0<\/span>/);
  assert.doesNotMatch(html, /data-next=""/);
  assert.match(html, /calendar-event upcoming kind-event status-neutral/);
  assert.match(html, /calendar-event upcoming kind-event status-closed/);
  const start = html.indexOf("<h2>未来 7 天</h2>"); assert.ok(start > 0);
  const upcoming = html.slice(start, html.indexOf("</section>", start));
  assert.match(upcoming, /未来七天没有已确认的安排/);
  assert.doesNotMatch(upcoming, /株式会社テスト既実施|株式会社テスト終了/);
  assertHistoryCount(html, 1, 1);
});
