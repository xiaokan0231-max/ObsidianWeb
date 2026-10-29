import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 日历概况只负责投递与记录入口；未来安排在右侧完整显示一次。
// 接口读完就显示终值，不能再启动一轮从零滚动，造成仍在加载的错觉。
const noCounterAnimation = { "./count-up": { CountUp() { throw new Error("日历概况不能等待数字滚动"); } } };
const zh = await loadAppModule("app/calendar-view.tsx", { stubs: noCounterAnimation, globals: { window: { location: { search: "?month=2026-08" } } } });
const ja = await loadAppModule("app/calendar-view.tsx", {
  stubs: { ...noCounterAnimation, "./ui-locale": { useUiLocale: () => ({ locale: "ja", setLocale() {} }) } },
  globals: { window: { location: { search: "?month=2026-08" } } },
});

const note = (path, frontmatter) => ({ path, frontmatter, content: "", tags: [], stat: { ctime: 0, mtime: 1, size: 0 } });
const event = (id, fields) => ({
  id, note: note(`${id}.md`, { type: "todo" }), kind: "event", date: "2026-08-12", time: "10:00",
  company: "株式会社テスト", label: "一次面接", phase: "upcoming", caseId: "", prepPath: "", ...fields,
});
const render = (module, props) => renderToStaticMarkup(createElement(module.default, {
  today: "2026-08-10", notes: [], events: [], interviewTargets: new Map(), onOpen() {}, onInterview() {}, ...props,
}));

test("投递概况加载时说明正在读取，不先显示零或空态", () => {
  const html = render(zh, { loading: true });
  const strip = html.match(/<div class="calendar-pulse"[\s\S]*?<div class="calendar-layout">/)?.[0] ?? "";
  assert.ok(strip, "月度概况在月格上方");
  assert.match(strip, /role="region"/);
  assert.match(strip, /aria-busy="true"/);
  assert.match(strip, /正在读取申请记录/);
  assert.doesNotMatch(strip, /<strong>0<\/strong>/);
  assert.doesNotMatch(strip, /当前月份暂无已确认的 AI 代投/);
});

test("概况直接显示准确计数，下一场只显示一次，等待案件按案件去重", () => {
  const waiting = note("20_求職/テスト/案件.md", { type: "job-case", case_id: "case", company: "株式会社テスト", status: "面接中", waiting_for: "company", applied_on: "2026-08-01", application_actor: "ai", application_agent: "Codex" });
  const events = [
    event("past-1", { date: "2026-08-03", phase: "past", caseId: "case", note: waiting }),
    event("past-2", { date: "2026-08-05", phase: "past", caseId: "case", note: waiting }),
    event("next", { date: "2026-08-11", company: "株式会社ダミー", label: "最终面试" }),
  ];
  const html = render(zh, {
    notes: [waiting], events,
    interviewTargets: new Map([["next", { view: "session", path: "prep.md", company: "株式会社ダミー", date: "2026-08-11", label: "最终面试", sourcePath: "next.md", caseId: "" }]]),
  });
  assert.match(html, /<span>等回复案件<\/span><strong>1<\/strong>/, "同一案件两场等待只算一次");
  assert.match(html, /<strong>1<\/strong><span>家公司<\/span>/, "当月公司数直接显示最终值");
  assert.match(html, /<span>历史状态说明<\/span><strong>0<\/strong>/, "已经关联当前状态的旧预约不计入历史说明");
  const aside = html.slice(html.indexOf('<aside class="calendar-agenda">'), html.indexOf("</aside>"));
  assert.match(aside, /<h2>未来 7 天<\/h2><span>1<\/span>/);
  assert.match(aside, /<[^>]+class="agenda-item [^>]+data-next=""/);
  assert.match(aside, /下一场/);
  assert.match(aside, /明天/);
  assert.match(aside, /round-final/);
  assert.match(aside, /查看安排/);
  assert.equal((aside.match(/<strong>ダミー<\/strong>/g) ?? []).length, 1, "下一场不再重复为独立大卡");
  assert.doesNotMatch(html, /calendar-next-hero|未来 7 天场次/);
});

test("下一场超过七天时保留在稍后安排，不重复挤进未来七天", () => {
  const html = render(zh, { events: [event("later", { date: "2026-08-20", company: "株式会社ダミー" })] });
  const aside = html.slice(html.indexOf('<aside class="calendar-agenda">'), html.indexOf("</aside>"));
  const upcomingStart = aside.indexOf("<h2>未来 7 天</h2>");
  const upcoming = aside.slice(upcomingStart, aside.indexOf("</section>", upcomingStart));
  assert.match(upcoming, /未来七天没有已确认的安排/);
  assert.doesNotMatch(upcoming, /株式会社ダミー|data-next/);
  assert.match(aside, /<[^>]+class="agenda-item [^>]+data-next=""/);
  assert.equal((aside.match(/<strong>ダミー<\/strong>/g) ?? []).length, 1);
});

test("同日重叠的场次追加 conflict 类与读屏说明，已结束的旧预约不参与", () => {
  const rejected = note("20_求職/テスト/不採用.md", { type: "job-case", case_id: "closed", status: "不採用" });
  const events = [
    event("a", { time: "10:00", endTime: "11:00" }),
    event("b", { time: "10:30" }),
    event("c", { time: "10:15", caseId: "closed", note: rejected }),
  ];
  const html = render(zh, { notes: [rejected], events });
  assert.match(html, /class="calendar-event upcoming kind-event status-active conflict"/);
  assert.match(html, /class="agenda-item upcoming kind-event status-active conflict"/);
  assert.match(html, /aria-label="[^"]*查看原始记录 · 时间冲突"/);
  assert.match(html, /class="calendar-event upcoming kind-event status-closed"/);
});

test("月格带网格语义：列头、今天 aria-current、日期按钮可选中", () => {
  const html = render(zh, {});
  assert.match(html, /role="grid"/);
  assert.equal((html.match(/role="columnheader"/g) ?? []).length, 7);
  assert.match(html, /role="gridcell" data-day="2026-08-10" aria-current="date"/);
  assert.match(html, /class="calendar-day-select" aria-pressed="false"/);
  assert.match(html, /aria-label="日程状态图例"[\s\S]*?<button type="button" aria-pressed="false"/);
});

test("日语界面按 code 翻译进展说明，原始等待标签保留", () => {
  const waiting = note("20_求職/テスト/案件.md", {
    type: "job-case", case_id: "case", status: "面接中", waiting_for: "agent", waiting_label: "面談後の結果",
  });
  const html = render(ja, {
    notes: [waiting], events: [event("past", { date: "2026-08-09", phase: "past", caseId: "case", note: waiting })],
  });
  assert.match(html, /返信待ち：予定は過ぎ、この案件はエージェントからの返信待ちです：面談後の結果。/);
  assert.match(html, /<h2>今後 7 日間<\/h2>/);
  assert.match(html, /今月のAI代行応募/);
  assert.doesNotMatch(html, /日程已过|等待中介|当前案件|未来 7 天|下一场|时间冲突|另有/);
});

test("快捷键先过输入场景判定，并把 R / ⌘K / Esc 留给外壳", async () => {
  const source = await readFile(new URL("../app/calendar-view.tsx", import.meta.url), "utf8");
  assert.match(source, /isTypingTarget\(event\.target\)/);
  assert.match(source, /event\.defaultPrevented \|\| event\.metaKey \|\| event\.ctrlKey/);
  assert.doesNotMatch(source, /key === "Escape"|key\.toLowerCase\(\) === "r"/);
  // 浮层盖在日历上、焦点掉回 body 时，方向键不能在背后翻月。
  assert.match(source, /section\.closest\("\[inert\]"\) \|\| document\.querySelector\('\[aria-modal="true"\]'\)/);
});

test("今天落在周末时仍是今天的底色：今天规则的特异性不低于周末与过去日", async () => {
  const css = await readFile(new URL("../app/styles/calendar-density.css", import.meta.url), "utf8");
  const weekend = css.indexOf(".calendar-day.weekend:not(.outside) {");
  const today = css.indexOf(".calendar-grid .calendar-day.today {");
  assert.ok(weekend >= 0 && today > weekend, "今天规则写在周末规则之后，且多一层 .calendar-grid");
});
