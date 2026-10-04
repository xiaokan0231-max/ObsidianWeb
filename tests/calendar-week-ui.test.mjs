import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

/*
 * 日历周视图（?calview=week）。月视图的逐字锁定在 calendar-view-ui / calendar-dashboard-ui，这里只补周视图，
 * 并确认不带参数时仍是原来的月格。
 */
const load = (search, stubs) => loadAppModule("app/calendar-view.tsx", { stubs, globals: { window: { location: { search } } } });
// 周中的周三也应归到那周的周一（2026-08-10）。
const zh = await load("?calview=week&calweek=2026-08-12");
const ja = await load("?calview=week&calweek=2026-08-12", { "./ui-locale": { useUiLocale: () => ({ locale: "ja", setLocale() {} }) } });
const month = await load("?month=2026-08");

const note = (path, frontmatter) => ({ path, frontmatter, content: "", tags: [], stat: { ctime: 0, mtime: 1, size: 0 } });
const event = (id, fields) => ({
  id, note: note(`${id}.md`, { type: "todo" }), kind: "event", date: "2026-08-12", time: "10:00",
  company: `株式会社テスト${id}`, label: "一次面接", phase: "upcoming", caseId: "", prepPath: "", ...fields,
});
const events = [
  event("A", { time: "10:00", endTime: "11:00" }),
  event("B", { time: "10:30" }),
  event("C", { time: "", date: "2026-08-14", label: "カジュアル面談" }),
  event("D", { time: "07:30", date: "2026-08-11", label: "最終面接" }),
  event("E", { date: "2026-08-20" }),
];
const render = (module, props = {}) => renderToStaticMarkup(createElement(module.default, {
  today: "2026-08-10", notes: [], events, interviewTargets: new Map(), onOpen() {}, onInterview() {}, ...props,
}));
const blocks = (html) => [...html.matchAll(/<button type="button" class="cw-block [^"]*"[\s\S]*?<\/button>/g)].map((match) => match[0]);

test("周视图：7 列时间块、全天行、冲突并排分栏，别周的场次不出现", () => {
  const html = render(zh);
  assert.match(html, /class="calendar-week-view" role="group" aria-label="8月10日 – 16日 · 周视图（日本时间）"/);
  assert.match(html, /<span class="calendar-month-label">8月10日 – 16日<\/span>/);
  assert.doesNotMatch(html, /role="grid"|class="calendar-event /, "周视图不再画月格");
  assert.equal((html.match(/class="cw-day-head/g) ?? []).length, 7);
  assert.equal((html.match(/class="cw-col/g) ?? []).length, 7);
  assert.match(html, /class="cw-day-head today" data-day="2026-08-10" aria-current="date"/);
  assert.match(html, /class="cw-col today" data-day="2026-08-10"/);

  const cards = blocks(html);
  assert.equal(cards.length, 3);
  const [early, first, second] = ["D", "A", "B"].map((id) => cards.find((card) => card.includes(`株式会社テスト${id}`)));
  assert.match(first, /class="cw-block upcoming status-active conflict"/);
  assert.match(second, /class="cw-block upcoming status-active conflict"/);
  assert.match(first, /aria-label="[^"]*时间冲突"/);
  assert.match(first, /left:calc\(0% \+ 2px\);width:calc\(50% - 4px\)/);
  assert.match(second, /left:calc\(50% \+ 2px\);width:calc\(50% - 4px\)/);
  assert.match(first, /<time class="cw-block-time" dateTime="2026-08-12T10:00\+09:00">10:00–11:00<\/time>/);
  assert.match(first, /<strong class="cw-block-company">株式会社テストA<\/strong>/);
  assert.doesNotMatch(early, /conflict/);
  assert.match(early, /round-final/);
  // 当周场次落在 07:30–11:30：刻度 06:00 起、留足 8 小时到 14:00，不再画满 08:00–21:00。
  assert.match(html, /--cw-hours:8/);
  assert.match(html, /<span>06:00<\/span>/);
  assert.match(html, /<span>13:00<\/span>/);
  assert.doesNotMatch(html, /<span>20:00<\/span>/);
  // 07:30 在 06:00–14:00 里的位置：90/480；60 分钟占 60/480。
  assert.match(early, /top:18\.75%;height:12\.5%/);

  const allDay = html.match(/<div class="cw-allday">[\s\S]*?<div class="cw-body">/)?.[0] ?? "";
  assert.match(allDay, /<span class="cw-gutter-label" title="未写具体时刻，不占时间段">全天<\/span>/);
  assert.match(allDay, /class="cw-chip upcoming status-active"[\s\S]*株式会社テストC/);
  // 别周的场次仍在侧栏「稍后安排」里，但不进本周网格。
  const board = html.slice(html.indexOf('class="calendar-week-view"'), html.indexOf('<aside class="calendar-agenda">'));
  assert.doesNotMatch(board, /株式会社テストE/);
  assert.match(html, /株式会社テストE/);
  // 当前时刻线要等挂载后由 effect 算，SSR 里不出现，避免与客户端对不上。
  assert.doesNotMatch(html, /cw-now/);
});

test("周视图工具栏：月／周分段控件、上一周／本周／下一周，键盘提示与月视图一致", () => {
  const html = render(zh);
  assert.match(html, /<div class="cw-switch" role="group" aria-label="日历视图"><button type="button" aria-pressed="false">月<\/button><button type="button" aria-pressed="true">周<\/button><\/div>/);
  assert.match(html, /aria-label="上一周" aria-keyshortcuts="\[">←<\/button>/);
  assert.match(html, /aria-keyshortcuts="T">本周<\/button>/);
  assert.match(html, /aria-label="下一周" aria-keyshortcuts="\]">→<\/button>/);
  assert.doesNotMatch(html, /上一个月|下一个月/);
});

test("没有时刻的周不画空的全天行；AI 代投只在日期头显示，不进时间轴", () => {
  const applied = note("20_求職/テスト/応募.md", {
    type: "job-case", case_id: "ai", company: "株式会社ダミー", position: "データ基盤", status: "応募済",
    applied_on: "2026-08-10", application_actor: "ai", application_agent: "Codex",
  });
  const html = render(zh, { events: [event("A", {})], notes: [applied] });
  assert.doesNotMatch(html, /cw-allday/);
  assert.match(html, /<button type="button" class="cw-ai" data-heat="1" aria-label="2026-08-10 JST · AI 代投 1 家公司 · 1 个岗位 · 展开申请详情">代投 1家<\/button>/);
  assert.equal(blocks(html).length, 1);
  assert.match(html, /<span>09:00<\/span>/, "10:00 的场次前留一小时，从 09:00 开始");
  assert.doesNotMatch(html, /<span>08:00<\/span>/);
});

test("周视图日语界面", () => {
  const html = render(ja);
  assert.match(html, /aria-label="8月10日 – 16日 · 週表示（日本時間）"/);
  assert.match(html, /aria-pressed="true">週<\/button>/);
  assert.match(html, /aria-label="前の週"/);
  assert.match(html, />今週<\/button>/);
  assert.match(html, />終日<\/span>/);
  assert.match(html, /時間が重複/);
  assert.doesNotMatch(html, /周视图|全天|本周|上一周|时间冲突/);
});

test("不带 calview 时仍是月格，分段控件停在「月」", () => {
  const html = render(month);
  assert.match(html, /role="grid"/);
  assert.match(html, /class="calendar-event upcoming kind-event status-active conflict"/);
  assert.match(html, /aria-pressed="true">月<\/button><button type="button" aria-pressed="false">周<\/button>/);
  assert.doesNotMatch(html, /calendar-week-view|cw-block/);
});

test("周视图沿用同一个打开回调与键盘守卫，不在渲染期取当前时刻", async () => {
  const source = await readFile(new URL("../app/calendar-view.tsx", import.meta.url), "utf8");
  assert.match(source, /onOpenEvent=\{openEvent\}/);
  assert.match(source, /useUrlState\("calview", "month"/);
  const board = source.slice(source.indexOf("function WeekBoard"), source.indexOf("function NextHero"));
  assert.ok(board.length > 0);
  assert.doesNotMatch(board, /Date\.now\(\)|new Date\(/);
  // 时间块的位置只来自 lib 的 JST 分钟数，不经 new Date(字符串) 按本机时区解析。
  assert.doesNotMatch(await readFile(new URL("../lib/calendar-week.ts", import.meta.url), "utf8"), /new Date\(`|new Date\("/);
});

test("不带 calweek 时落在 today 所在周；收尾整点有标签；短场次改单行", async () => {
  const implicit = await load("?calview=week");
  const html = render(implicit, {
    today: "2026-08-12",
    events: [event("S", { time: "14:00", endTime: "14:30" }), event("L", { time: "16:00" })],
  });
  assert.match(html, /<span class="calendar-month-label">8月10日 – 16日<\/span>/);
  assert.match(html, /class="cw-day-head today" data-day="2026-08-12"/);
  assert.match(html, /<span class="cw-time-end">21:00<\/span>/);
  const [short, long] = ["S", "L"].map((id) => blocks(html).find((card) => card.includes(`株式会社テスト${id}`)));
  assert.match(short, /class="cw-block cw-short upcoming status-active"/);
  assert.match(long, /class="cw-block upcoming status-active"/);
});

test("「本周」不写进 URL；切回月视图时清掉 calweek", async () => {
  const source = await readFile(new URL("../app/calendar-view.tsx", import.meta.url), "utf8");
  assert.match(source, /useUrlState\("calweek", "", WEEK_START_CODEC\)/);
  assert.match(source, /setWeekParam\(next === currentWeek \? "" : next\)/);
  const switcher = source.slice(source.indexOf("const switchView"), source.indexOf("const onCalendarKey"));
  assert.match(switcher, /setWeekParam\(""\)/);
});

test("周视图键盘：← → 逐日选择、[ ] 翻周、T 选中今天、Enter 打开当日第一场；提示中日两份", async () => {
  const zhHtml = render(zh);
  const jaHtml = render(ja);
  assert.match(zhHtml, /class="cw-day-select" aria-pressed="false" aria-label="[^"]+" aria-keyshortcuts="ArrowLeft ArrowRight Enter" title="← → 逐日选择 · \[ \] 翻周 · T 回到今天 · Enter 打开当日第一场"/);
  assert.match(jaHtml, /aria-keyshortcuts="ArrowLeft ArrowRight Enter" title="← → 日を選択 · \[ \] 週を移動 · T 今日に戻る · Enter その日の最初の予定を開く"/);
  // 翻周按钮仍只认方括号：方向键不再翻周。
  assert.match(zhHtml, /aria-label="上一周" aria-keyshortcuts="\[">/);

  const source = await readFile(new URL("../app/calendar-view.tsx", import.meta.url), "utf8");
  const weekKeys = source.slice(source.indexOf('if (calView === "week") {', source.indexOf("const onCalendarKey")), source.indexOf('if (key === "[" || key === "]") {\n      event.preventDefault();\n      moveMonth'));
  assert.ok(weekKeys.length > 0);
  assert.match(weekKeys, /moveWeek\(key === "\[" \? -1 : 1\)/);
  assert.match(weekKeys, /stepWeekSelection\(weekStart, selectedDay, today, key === "ArrowLeft" \? -1 : 1\)/);
  assert.match(weekKeys, /setSelectedDay\(today\)/);
  assert.match(weekKeys, /openEvent\(first\)/, "与点时间块同一个打开回调");
  assert.doesNotMatch(weekKeys, /moveWeek\(key === "\[" \|\| key === "ArrowLeft"/, "方向键不再整周翻页");
  // 跨周重挂后焦点要还给新选中那天：聚焦选择器同时认月格与周视图的日期按钮。
  assert.match(source, /:is\(\.calendar-day-select, \.cw-day-select\)/);
});
