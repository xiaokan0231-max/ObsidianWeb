import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { calendarInterviewScore } from "../lib/calendar-interview-score.ts";
import { resolveCalendarInterview } from "../lib/calendar-interview.ts";
import { calendarProgress } from "../lib/calendar-progress.ts";
import { buildCalendarSummary } from "../lib/calendar-summary.ts";
import { interviewRound, interviewRoundLabelJa } from "../lib/interview-round.ts";
import { buildCalendarEvents } from "../lib/memory-atlas-data.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

/*
 * 日历显示修正的回归测试：评分别名、历史数字格文案、最近记录计数、当天已面完的场次、
 * 顶栏最近安排口径、代投入口快捷键、日文轮次说明、月格短文案。公司名一律虚构。
 */

const TODAY = "2026-08-10";
const note = (path, frontmatter, content = "") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
const zh = await loadAppModule("app/calendar-view.tsx", { globals: { window: { location: { search: "?month=2026-08" } } } });
const ja = await loadAppModule("app/calendar-view.tsx", {
  stubs: { "./ui-locale": { useUiLocale: () => ({ locale: "ja", setLocale() {} }) } },
  globals: { window: { location: { search: "?month=2026-08" } } },
});
const render = (module, props) => renderToStaticMarkup(createElement(module.default, {
  today: TODAY, notes: [], events: [], interviewTargets: new Map(), onOpen() {}, onInterview() {}, ...props,
}));
const simpleEvent = (id, fields = {}) => ({
  id, note: note(`${id}.md`, { type: "todo" }), kind: "event", date: TODAY, time: "10:00",
  company: "株式会社テスト", label: "面谈", phase: "upcoming", caseId: "", prepPath: "", ...fields,
});
const section = (html, heading) => {
  const start = html.indexOf(heading);
  assert.ok(start >= 0, heading);
  return html.slice(start, html.indexOf("</section>", start));
};

// ── 1. 评分：报告已按 source_path 精确命中整理稿时，公司别名不算身份冲突 ──
const study = note("20_求職/テストキャリア/2026-09-07_エージェント面談_整理稿.md", {
  type: "transcript-study", company: "株式会社テスト", date: "2026-09-07", round: "エージェント面談", time: "13:00",
});
const report = (fields = {}) => note("80_AI分析/面试重评/2026-09-07_テストキャリア_重评.md", {
  type: "ai-report", report_kind: "interview-reassessment", report_role: "session", source_path: study.path,
  company: "テストキャリア", date: study.frontmatter.date, round: study.frontmatter.round, generated_at: "2026-10-07T11:00:00Z",
  method_version: "2026-10-v3", evaluation_mode: "scored_evidence", assessment_scope: "full_available_text", overall_score: 85,
  dimension_scores: { questionUnderstanding: 85, coverage: 85, directness: 85, evidenceCredibility: 85, riskControl: null }, ...fields,
});
const studyEvent = { id: study.path, note: study, kind: "event", date: study.frontmatter.date, time: "13:00", company: "株式会社テスト", label: "猎头面谈", phase: "past", caseId: "", prepPath: "" };
const scoreOf = (notes, event = studyEvent) => calendarInterviewScore(event, resolveCalendarInterview(event, notes), notes);

test("评分：报告公司写成文件夹别名、source_path 精确一致时照常显示分数", () => {
  assert.equal(resolveCalendarInterview(studyEvent, [study]).path, study.path);
  assert.deepEqual(scoreOf([study, report()]), { kind: "overall", scores: [85] });
});

test("评分：source_path 不同、日期不同、轮次冲突仍不给分", () => {
  assert.equal(scoreOf([study, report({ source_path: "20_求職/テストキャリア/別の回_整理稿.md" })]), null);
  assert.equal(scoreOf([study, report({ date: "2026-09-08" })]), null);
  assert.equal(scoreOf([study, report({ round: "一次面接" })]), null);
});

test("评分：没有路径锚点的 source_note 兜底分支仍核对公司名", async () => {
  const source = await readFile(new URL("../lib/calendar-interview-score.ts", import.meta.url), "utf8");
  const fallback = source.slice(source.indexOf("const candidates = notes.filter"));
  assert.match(fallback, /sameSession\(note, event\)/);
  assert.match(source, /if \(!report \|\| !sameDateRound\(report, event\)\) return null;/);
});

// ── 2. 历史紧凑入口：完整名称仍保留计数对象与不限月份的范围 ──
test("历史入口短标题仍明确计数对象及与已发生场次的关系", () => {
  const notes = [1, 2, 3].map((index) => note(`20_求職/テスト/review-${index}.md`, { type: "review", company: "株式会社テスト", date: `2026-08-0${index}`, round: "一次面接", result: "通過" }));
  const events = notes.map((source, index) => simpleEvent(`past-${index}`, { note: source, date: source.frontmatter.date, label: "第一次面试", phase: "past" }));
  // 一场已关联、仍在等回复的已发生场次：计入分母，不计入这一格。
  const job = note("20_求職/テスト/案件.md", { type: "job-case", case_id: "case", company: "株式会社テスト", status: "面接中", waiting_for: "company" });
  events.push(simpleEvent("linked", { note: job, caseId: "case", date: "2026-08-05", phase: "past" }));
  const zhHtml = render(zh, { notes: [...notes, job], events });
  assert.match(zhHtml, /aria-label="无当前状态的历史场次 3 \/ 4 场 · 不限月份"/);
  assert.match(zhHtml, /<span>历史状态说明<\/span><strong>3<\/strong><small>\/ 4 场 · 不限月份<\/small>/);
  assert.match(zhHtml, /title="查看无当前状态的历史场次及原始来源"/);
  assert.doesNotMatch(zhHtml, /全部历史/);
  const jaHtml = render(ja, { notes: [...notes, job], events });
  assert.match(jaHtml, /aria-label="現在の状態がない過去の予定 3 \/ 4 件 · 期間を問わず"/);
  assert.match(jaHtml, /<span>過去の状態の説明<\/span><strong>3<\/strong><small>\/ 4 件 · 期間を問わず<\/small>/);
  assert.doesNotMatch(jaHtml, /全履歴|過去の全予定/);
});

// ── 3. 最近记录：计数是真实总数，默认露 6 条，其余展开 ──
test("最近记录显示全部已发生场次的总数，列表默认 6 条并可展开其余", () => {
  const events = Array.from({ length: 9 }, (_, index) => simpleEvent(`past-${index}`, { date: `2026-07-${String(index + 10).padStart(2, "0")}`, phase: "past" }));
  const html = render(zh, { events });
  assert.match(html, /<summary><span>最近记录<\/span><strong>9<\/strong><\/summary>/);
  const history = section(html, "<h2>历史事实</h2>");
  assert.match(history, /<h2>历史事实<\/h2><span>9<\/span>/);
  assert.equal((history.match(/class="agenda-item /g) ?? []).length, 6);
  assert.match(history, /aria-expanded="false">另有 3 项<\/button>/);
  // 倒序：最近的一场排第一。
  assert.ok(history.indexOf("2026-07-18") < history.indexOf("2026-07-17"));
});

// ── 4. 当天已面完的场次：退出下一场／未来 7 天，进等回复与最近记录 ──
function sameDayNotes() {
  return [
    note("20_求職/テスト/テスト案件.md", { type: "job-case", case_id: "test-done", company: "株式会社テスト", status: "面接中", waiting_for: "company" }),
    note("20_求職/テスト/面接準備_一次面接.md", { type: "interview-prep", session_status: "completed", company: "株式会社テスト", date: TODAY, time: "10:00", round: "一次面接", case: "[[テスト案件]]" }),
    note(`20_求職/テスト/${TODAY}_一次面接_整理稿.md`, { type: "transcript-study", company: "株式会社テスト", date: TODAY, time: "10:00", round: "一次面接", case: "[[テスト案件]]" }),
    note("20_求職/サンプル/サンプル案件.md", { type: "job-case", case_id: "test-later", company: "株式会社サンプル", status: "面接中", next_event_at: `${TODAY} 16:00`, next_event_label: "二次面接" }),
  ];
}

test("当天已有整理稿的场次算已发生：不当下一场、不计未来 7 天，仍计等回复；同日稍后的确约接任下一场", () => {
  const notes = sameDayNotes();
  const events = buildCalendarEvents(notes, new Date(`${TODAY}T00:00:00`));
  const targets = new Map(events.map((event) => [event.id, resolveCalendarInterview(event, notes)]));
  const progress = new Map(events.map((event) => [event.id, calendarProgress(event, notes, targets.get(event.id) ?? undefined)]));
  const done = events.find((event) => event.company === "株式会社テスト");
  const later = events.find((event) => event.company === "株式会社サンプル");
  assert.ok(done && later);
  assert.equal(done.phase, "upcoming", "phase 只按日期判定，当天仍是 upcoming");
  assert.equal(progress.get(done.id).code, "waiting-case");
  assert.equal(progress.get(done.id).occurred, true);
  assert.equal(progress.get(later.id).code, "scheduled");
  assert.equal(progress.get(later.id).occurred, false);
  const summary = buildCalendarSummary({ events, progressByEvent: progress, applicationDays: [], today: TODAY });
  assert.equal(summary.next?.event.id, later.id);
  assert.equal(summary.weekCount, 1);
  assert.equal(summary.waitingCount, 1);
});

test("当天已面完的场次在侧栏从「未来 7 天」移到「最近记录」，两边都不丢", () => {
  const notes = sameDayNotes();
  const events = buildCalendarEvents(notes, new Date(`${TODAY}T00:00:00`));
  const interviewTargets = new Map(events.flatMap((event) => {
    const target = resolveCalendarInterview(event, notes);
    return target ? [[event.id, target]] : [];
  }));
  const html = render(zh, { notes, events, interviewTargets });
  const upcoming = section(html, "<h2>未来 7 天</h2>");
  assert.match(upcoming, /<h2>未来 7 天<\/h2><span>1<\/span>/);
  assert.match(upcoming, /data-next=""/);
  assert.match(upcoming, /下一场/);
  assert.match(upcoming, /今天/);
  assert.match(upcoming, /株式会社サンプル/);
  assert.doesNotMatch(upcoming, /株式会社テスト/);
  const history = section(html, "<h2>历史事实</h2>");
  assert.match(history, /<h2>历史事实<\/h2><span>1<\/span>/);
  assert.match(history, /株式会社テスト/);
});

test("不採用／保留等提前返回的分支同样带 occurred，当天已面完的这类场次也不当下一场", () => {
  const job = note("20_求職/テスト/案件.md", { type: "job-case", case_id: "held", company: "株式会社テスト", status: "保留（テスト理由）" });
  const event = simpleEvent("held", { note: job, caseId: "held" });
  const target = { view: "review", path: "held-study.md", sourcePath: job.path, company: "株式会社テスト", date: TODAY, label: "面谈", caseId: "held" };
  const progress = calendarProgress(event, [job], target);
  assert.equal(progress.code, "paused");
  assert.equal(progress.occurred, true);
  const summary = buildCalendarSummary({ events: [event], progressByEvent: new Map([[event.id, progress]]), applicationDays: [], today: TODAY });
  assert.equal(summary.next, null);
  assert.equal(calendarProgress(event, [job]).occurred, false, "没有复盘的当天保留场次仍未发生");
});

// ── 5. 顶栏「最近安排」与日历「下一场」同一口径 ──
test("顶栏最近安排复用 buildCalendarSummary 的下一场，不再只看 phase", async () => {
  const source = await readFile(new URL("../app/memory-atlas.tsx", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("const nextEvent = useMemo"), source.indexOf("// ?note= が指すノート"));
  assert.ok(block.length > 0);
  assert.match(block, /calendarProgress\(event, notes, calendarInterviewTargets\.get\(event\.id\)\)/);
  assert.match(block, /buildCalendarSummary\(\{ events: upcoming, progressByEvent, applicationDays: \[\], today: calendarToday \}\)\.next\?\.event/);
  assert.doesNotMatch(block, /toSorted/);
});

// ── 6. 代投入口按钮不吞日历快捷键 ──
test("代投入口只在面板开着时屏蔽翻页键；关闭后焦点留在入口上，[ ] 照常翻月", async () => {
  class FakeNode {}
  class FakeElement extends FakeNode {
    constructor(selectors) { super(); this.selectors = selectors; this.classList = { contains: () => false }; }
    closest(selector) { return selector.split(",").some((part) => this.selectors.includes(part.trim())) ? this : null; }
  }
  const listeners = new Map();
  const browser = {
    location: { search: "?month=2026-08", pathname: "/calendar" }, history: { state: null, replaceState() {} },
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener() {},
  };
  const document = { body: {}, documentElement: {}, querySelector: () => null };
  let stateCursor = 0, refCursor = 0;
  const states = [], refs = [];
  const view = await loadAppModule("app/calendar-view.tsx", {
    globals: { window: browser, document, Element: FakeElement, Node: FakeNode },
    stubs: {
      react: {
        memo: (component) => component, useMemo: (fn) => fn(),
        useEffect: (fn) => { fn(); }, useLayoutEffect: (fn) => { fn(); },
        useRef: (initial) => refs[refCursor++] ??= { current: initial },
        useState: (initial) => {
          const slot = stateCursor++;
          if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial;
          return [states[slot], (next) => { states[slot] = typeof next === "function" ? next(states[slot]) : next; }];
        },
      },
      "./use-url-state": { enumCodec: (values) => ({ parse: (raw) => values.includes(raw) ? raw : null }), useUrlState: (key, initial) => [initial, () => {}] },
      "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN" }) },
    },
  });
  const application = note("20_求職/テスト/応募.md", { type: "job-case", case_id: "ai", company: "株式会社テスト", position: "テスト職", status: "応募済", application_actor: "ai", application_agent: "Codex", applied_on: TODAY });
  const renderTree = () => { stateCursor = 0; refCursor = 0; return view.default({ today: TODAY, notes: [application], events: [], interviewTargets: new Map(), onOpen() {}, onInterview() {} }); };
  const walk = (value) => !value || typeof value !== "object" ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.props?.children)];
  const monthLabel = () => walk(renderTree()).find((node) => node.props?.role === "grid").props["aria-label"];
  const press = (key, target) => {
    let prevented = false;
    listeners.get("keydown")({ key, target, defaultPrevented: false, metaKey: false, ctrlKey: false, altKey: false, preventDefault() { prevented = true; } });
    return prevented;
  };
  renderTree();
  refs[0].current = { contains: () => true, closest: () => null, querySelector: () => null };
  const trigger = new FakeElement(["[data-ai-date]"]);
  const insidePanel = new FakeElement([".calendar-application-panel"]);
  assert.equal(monthLabel(), "2026年8月");

  const opener = walk(renderTree()).find((node) => node.props?.day?.date === TODAY && node.props?.onOpen);
  opener.props.onOpen(opener.props.day, { isConnected: true, focus() {} });
  renderTree();
  // 面板开着：触发按钮、面板内部和 body 上的按键都不翻动背后的月份。
  assert.equal(press("]", trigger), false);
  assert.equal(press("]", insidePanel), false);
  assert.equal(press("]", document.body), false);
  assert.equal(monthLabel(), "2026年8月");

  walk(renderTree()).find((node) => node.props?.date === TODAY && node.props?.onClose).props.onClose();
  renderTree();
  // 关闭后焦点回到触发按钮，翻页键照常交给日历。
  assert.equal(press("]", trigger), true);
  assert.equal(monthLabel(), "2026年9月");
  assert.equal(press("[", trigger), true);
  assert.equal(monthLabel(), "2026年8月");
  // 面板内部的按键始终留给面板自己。
  assert.equal(press("]", insidePanel), false);
});

// ── 7. 日文界面的轮次说明 ──
test("轮次说明有日文名，读不出轮次的 label 交给调用方兜底", () => {
  const expected = [
    ["轻松面谈", "カジュアル面談"], ["第一次面试", "一次面接"], ["第二次面试", "二次面接"], ["第三次面试", "三次面接"],
    ["最终面试", "最終面接"], ["猎头面谈", "エージェント面談"], ["一次面接", "一次面接"],
  ];
  for (const [label, japanese] of expected) assert.equal(interviewRoundLabelJa(label), japanese, label);
  for (const label of ["面试", "面谈", "招聘说明会", "人事面谈"]) assert.equal(interviewRoundLabelJa(label), "", label);
  // 中文 label 仍是正本：显示换词不能影响轮次解析。
  assert.equal(interviewRound("第一次面试"), "round-1");
});

test("日文界面的议程与卡片说明不再露出中文轮次名", () => {
  const pairs = [
    ["轻松面谈", "カジュアル面談"], ["第一次面试", "一次面接"], ["第二次面试", "二次面接"], ["最终面试", "最終面接"],
    ["猎头面谈", "エージェント面談"], ["面试", "面接"], ["面谈", "面談"], ["招聘说明会", "採用説明会"],
  ];
  // 「最近记录」默认只露 6 条，分两批渲染，让每个 label 都出现在议程里。
  for (const batch of [pairs.slice(0, 4), pairs.slice(4)]) {
    const events = batch.map(([label], index) => simpleEvent(`label-${index}`, { label, date: `2026-08-0${index + 1}`, phase: "past" }));
    const html = render(ja, { events });
    for (const [, japanese] of batch) {
      assert.match(html, new RegExp(`<small>10:00 · ${japanese}</small>`), japanese);
      assert.match(html, new RegExp(`aria-label="[^"]*株式会社テスト · ${japanese} · `), `卡片说明 ${japanese}`);
    }
    assert.doesNotMatch(html, /轻松面谈|第一次面试|第二次面试|最终面试|猎头面谈|招聘说明会|· 面试 ·|· 面谈 ·|· 面试<|· 面谈</);
    const zhHtml = render(zh, { events });
    for (const [label] of batch) assert.match(zhHtml, new RegExp(`<small>10:00 · ${label}</small>`), label);
  }
});

// ── 8. 月格卡片用短文案，右栏保留完整文案 ──
test("日文月格卡片的去向写「振り返り →」，右栏议程和 aria-label 仍是「面接の振り返り」", () => {
  const event = simpleEvent("reviewed", { label: "第一次面试", phase: "past", date: "2026-08-07" });
  const interviewTargets = new Map([[event.id, { view: "review", path: "study.md", sourcePath: event.note.path, company: event.company, date: event.date, label: event.label, caseId: "" }]]);
  const html = render(ja, { events: [event], interviewTargets });
  const card = html.match(/<button\b[^>]*class="calendar-event [^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(card, /<span class="calendar-interview-destination" aria-hidden="true">振り返り →<\/span>/);
  assert.match(card, /aria-label="[^"]*面接の振り返り"/);
  const history = section(html, "<h2>過去の記録</h2>");
  assert.match(history, /<span class="calendar-interview-destination" aria-hidden="true">面接の振り返り →<\/span>/);
  const zhHtml = render(zh, { events: [event], interviewTargets });
  assert.match(zhHtml, /class="calendar-interview-destination" aria-hidden="true">面试复盘 →<\/span>/);
});

// ── 布局与样式：状态点、分数徽章、周视图 meta 行、已结束色、工具栏、代投记号 ──
const densityCss = (await readFile(new URL("../app/styles/calendar-density.css", import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
/** 取「选择器 { … }」的声明体；同一选择器分几处写时拼在一起。选择器要逐字给出，免得断言落到别处规则上。 */
const ruleOf = (selector) => {
  const bodies = [];
  for (let start = densityCss.indexOf(`${selector} {`); start >= 0; start = densityCss.indexOf(`${selector} {`, start + 1)) {
    const before = densityCss[start - 1];
    if (start > 0 && before !== "\n" && before !== " ") continue;
    bodies.push(densityCss.slice(start + selector.length + 2, densityCss.indexOf("}", start)));
  }
  assert.ok(bodies.length, `找不到规则 ${selector}`);
  return bodies.join("\n");
};

test("月格状态点：留在标题行布局流里、保持图例同款 12px 并自己当符号的定位容器，等回复照常呼吸", () => {
  const dot = ruleOf(".calendar-event-heading > .calendar-status-dot");
  assert.match(dot, /position: relative/);
  assert.match(dot, /flex: 0 0 12px/);
  assert.match(dot, /margin-left: auto/);
  assert.doesNotMatch(dot, /8px|static/);
  // 点已不是卡片的直接子元素：以子代组合符写的绝对定位和动画规则都匹配不到，不能留着。
  assert.doesNotMatch(densityCss, /\.calendar-event(?:\.[\w-]+)* > \.calendar-status-dot/);
  assert.equal((densityCss.match(/\.calendar-event\.status-waiting \.calendar-status-dot/g) ?? []).length, 2, "呼吸动画与减弱动效各一条");
  assert.match(ruleOf(".calendar-event .calendar-event-heading"), /overflow: visible/);
  assert.match(ruleOf(".calendar-view .calendar-event.conflict .calendar-event-heading > .calendar-status-dot"), /margin-right: 5px/);
});

// 评分夹具：整理稿＋同一 source_path 的重评报告。公司名虚构。
const scoredStudy = (id, date, time, endTime) => {
  const company = `株式会社テスト${id}`;
  const study = note(`20_求職/${company}/${id}_整理稿.md`, { type: "transcript-study", company, date, round: "一次面接", time });
  const report = note(`80_AI分析/${id}.md`, {
    type: "ai-report", report_kind: "interview-reassessment", report_role: "session", source_path: study.path, company,
    date, round: "一次面接", generated_at: "2026-10-07", evaluation_mode: "scored_evidence", assessment_scope: "full_available_text",
    overall_score: 85, dimension_scores: { coverage: 85, directness: 85, questionUnderstanding: 85 }, local_assessments: [],
  });
  const event = { id, note: study, kind: "event", date, time, ...(endTime ? { endTime } : {}), company, label: "第一次面试", phase: "past", caseId: "", prepPath: "" };
  return { notes: [study, report], event };
};
const renderWith = async (search, fixtures) => {
  const view = await loadAppModule("app/calendar-view.tsx", { globals: { window: { location: { search } } } });
  const notes = fixtures.flatMap((fixture) => fixture.notes);
  const events = fixtures.map((fixture) => fixture.event);
  const interviewTargets = new Map(events.map((event) => [event.id, resolveCalendarInterview(event, notes)]));
  return renderToStaticMarkup(createElement(view.default, { today: "2026-09-13", notes, events, interviewTargets, onOpen() {}, onInterview() {} }));
};

test("月格：有分数时阶段文字让位（CSS 隐藏），类型仍留在按钮的 title 与 aria-label 里", async () => {
  assert.match(ruleOf(".calendar-event-heading:has(.calendar-interview-score) .calendar-event-stage"), /display: none/);
  const html = await renderWith("?month=2026-09", [scoredStudy("m1", "2026-09-10", "10:00", "11:00")]);
  const card = html.match(/<button\b[^>]*class="calendar-event [^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(card, /<span class="calendar-event-stage">面试<\/span><span class="calendar-interview-score"[^>]*>85分<\/span><span class="calendar-status-dot"/);
  assert.match(card, /aria-label="2026-09-10 · 10:00–11:00 · JST · 株式会社テストm1 · 第一次面试 · [^"]*85分/);
  assert.match(card, /title="2026-09-10 · 10:00–11:00 · JST · 株式会社テストm1 · 第一次面试 · /);
});

test("周视图：分数排进 meta 行末、公司名独占标题行；带结束时刻的块标记 data-ranged，有分数时只写开始时刻", async () => {
  const html = await renderWith("?calview=week&calweek=2026-09-07", [
    scoredStudy("w1", "2026-09-08", "10:00", "11:00"),
    scoredStudy("w2", "2026-09-09", "14:00", "14:30"),
    { notes: [], event: { ...simpleEvent("w3"), date: "2026-09-10", time: "17:00", endTime: "18:00", company: "株式会社サンプル", label: "第一次面试", phase: "past" } },
    { notes: [], event: { ...simpleEvent("w4"), date: "2026-09-11", time: "09:00", company: "株式会社ダミー", label: "第一次面试", phase: "past" } },
  ]);
  const block = (company) => html.match(new RegExp(`<button type="button" class="cw-block[^"]*"[^>]*aria-label="[^"]*${company}[\\s\\S]*?</button>`))?.[0] ?? "";
  const scored = block("株式会社テストw1");
  assert.match(scored, /class="cw-block past status-[\w-]+"/);
  assert.match(scored, /data-ranged=""/);
  assert.match(scored, /aria-label="2026-09-08 · 10:00–11:00 · JST/, "起止时刻仍完整写在说明里");
  assert.match(scored, /<span class="cw-block-meta"><time class="cw-block-time" dateTime="2026-09-08T10:00\+09:00">10:00<\/time><span class="calendar-round-badge[^"]*"[^>]*>1<\/span><span class="cw-block-stage">面试<\/span><span class="calendar-interview-score"[^>]*>85分<\/span><\/span>/);
  assert.match(scored, /<span class="cw-block-title"><strong class="cw-block-company">テストw1<\/strong><\/span>/);

  // 短场次也把分数排进 meta 行（上行时刻＋轮次＋分数、下行公司名整宽），只写开始时刻。
  // 改写理由：原两列布局把公司名挤到约 56px，时刻与徽标缩到 8–9px。
  const short = block("株式会社テストw2");
  assert.match(short, /class="cw-block cw-short past/);
  assert.match(short, />14:00<\/time>/);
  assert.match(short, /<span class="calendar-interview-score"[^>]*>85分<\/span><\/span><span class="cw-block-title"><strong class="cw-block-company">テストw2<\/strong><\/span>/, "短块去掉法人格省出一行");
  assert.match(short, /aria-label="[^"]*株式会社テストw2/, "全称留在 aria-label");

  // 没有分数：起止时刻照写；阶段文字是否放得下交给 CSS 折行判断。
  const ranged = block("株式会社サンプル");
  assert.match(ranged, /data-ranged=""/);
  assert.match(ranged, />17:00–18:00<\/time>/);
  assert.doesNotMatch(ranged, /calendar-interview-score/);
  assert.doesNotMatch(block("株式会社ダミー"), /data-ranged/);
});

test("周视图 CSS：阶段文字整段显示或整段折走，分数与轮次先占位、不收缩", () => {
  const ranged = ruleOf(".cw-block[data-ranged]:not(.cw-short) .cw-block-meta");
  for (const declaration of ["flex: 0 0 auto", "flex-wrap: wrap", "height: 16px", "overflow: hidden"]) assert.ok(ranged.includes(declaration), declaration);
  assert.match(ruleOf(".cw-block[data-ranged]:not(.cw-short) .cw-block-stage"), /flex: 0 0 auto/);
  const scored = ruleOf(".cw-block .cw-block-meta:has(> .calendar-interview-score)");
  for (const declaration of ["flex: 0 0 auto", "flex-direction: row-reverse", "flex-wrap: wrap", "height: 16px", "overflow: hidden"]) assert.ok(scored.includes(declaration), declaration);
  assert.match(ruleOf(".cw-block .cw-block-meta:has(> .calendar-interview-score) > .calendar-interview-score"), /order: -2/);
  assert.match(ruleOf(".cw-block .cw-block-meta:has(> .calendar-interview-score) > .calendar-round-badge"), /order: -1/);
  assert.match(ruleOf(".cw-block .cw-block-meta:has(> .calendar-interview-score) .cw-block-stage"), /display: none/);
  // 分数徽章压到 16px 高（14px 行高＋上下边框），与轮次徽标同高。
  const badge = ruleOf(".cw-block-meta > .calendar-interview-score");
  assert.match(badge, /padding-block: 0/);
  assert.match(badge, /line-height: 14px/);
});

test("已结束：月格、议程与周视图同用灰色左缘，红色只留在「終了」小方块上", () => {
  // 改写理由：本人要已结束的场次退到背景里（10-07 去掉删除线与灰底），整卡染红会比进行中的还抢眼；
  // 一致性改为「月格、周视图都用灰边」，与图例对得上的是状态点本身的红色。
  const closed = ruleOf(".calendar-view .calendar-event.status-closed,\n.calendar-view .agenda-item.status-closed");
  assert.match(closed, /--commitment-tone: var\(--text-tertiary\)/);
  assert.match(closed, /--commitment-wash: var\(--surface\)/);
  const week = ruleOf(".calendar-view :is(.cw-block, .cw-chip).status-closed:not(:hover)");
  assert.match(week, /border-left-color: var\(--text-tertiary\)/);
  assert.match(week, /background: var\(--surface-raised-solid\)/);
  assert.match(ruleOf(".calendar-view .status-closed"), /--calendar-status-color: var\(--danger\)/, "状态点仍是红色");
  assert.match(densityCss, /\.calendar-view \.calendar-event\.status-closed,\n\.calendar-view \.agenda-item\.status-closed \{ opacity: \.62; \}/, "变淡保留");
});

test("工具栏：图例按 0 宽参与断行，工具组留在第一行右侧；窄屏 grid 规则不变", () => {
  const legend = ruleOf(".calendar-toolbar .calendar-legend");
  assert.match(legend, /flex: 1 1 0;/);
  // 复核改动理由：收到 0 时较窄的桌面宽度（实测 1100）下图例只剩 33px，胶囊溢出压到工具组；最窄收到最宽一枚胶囊。
  assert.match(legend, /min-width: min-content/);
  assert.match(densityCss, /@media \(max-width: 820px\) \{\n  \.calendar-toolbar \{\n    display: grid;/);
});

test("周视图代投胶囊与月格同一记号：信息色＋热度梯度，不用品牌橙", () => {
  const pill = ruleOf(".cw-ai");
  assert.match(pill, /color: var\(--info\)/);
  assert.doesNotMatch(pill, /--brand|--interactive/);
  for (const heat of ["2", "3", "4"]) assert.match(ruleOf(`.cw-ai[data-heat="${heat}"]`), /var\(--info\)/);
  assert.match(ruleOf(".cw-ai:hover,\n.cw-ai[aria-expanded=\"true\"]"), /border-color: var\(--info\)/);
});

// ── 复核补充：日文换词只认中文正本词；周视图时刻标签不被撑满一小时 ──
test("日文界面只换逐字等于中文正本的轮次词，带补充的原文 label 原样显示", () => {
  const events = [
    simpleEvent("raw-casual", { label: "カジュアル面談（原文）", date: "2026-08-03", phase: "past" }),
    simpleEvent("raw-round", { label: "第一次面试（テスト補足）", date: "2026-08-04", phase: "past" }),
    simpleEvent("canonical", { label: "第二次面试", date: "2026-08-05", phase: "past" }),
  ];
  const html = render(ja, { events });
  assert.match(html, /<small>10:00 · カジュアル面談（原文）<\/small>/);
  assert.match(html, /<small>10:00 · 第一次面试（テスト補足）<\/small>/);
  assert.match(html, /<small>10:00 · 二次面接<\/small>/);
});

test("周视图左侧时刻标签按自身高度对齐（align-self: start），不能被网格撑满一小时而整体上移半小时", () => {
  assert.match(ruleOf(".cw-times span"), /align-self: start/);
});
