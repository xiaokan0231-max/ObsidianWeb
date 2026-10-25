import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCalendarEvents } from "../lib/memory-atlas-data.ts";
import { resolveCalendarInterview } from "../lib/calendar-interview.ts";
import { noteInVaultScope, vaultScopeForView } from "../lib/vault-scope.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

// 月份从 ?month= 读：注入一个只有 location 的 window，其余 lib 依赖由加载器按真实模块解析。
const components = await loadAppModule("app/calendar-view.tsx", { globals: { window: { location: { search: "?month=2026-08" } } } });

test("月格突出开始时刻，完整起止范围保留在说明和议程，并标注日本时间", () => {
  const html = renderToStaticMarkup(createElement(components.default, {
    today: "2026-08-10",
    events: [{
      id: "test", note: { path: "test.md", frontmatter: { type: "todo" }, content: "" }, kind: "event", date: "2026-08-10", time: "10:00", endTime: "10:30",
      company: "株式会社テスト", label: "面谈", phase: "upcoming", caseId: "", prepPath: "",
    }],
    notes: [], interviewTargets: new Map(), onOpen() {}, onInterview() {},
  }));
  assert.match(html, /日本时间（JST）/);
  assert.match(html, /dateTime="2026-08-10T10:00\+09:00">10:00<\/time>/);
  assert.match(html, /<span class="agenda-time">10:00–10:30<\/span>/);
  assert.match(html, /<small>面谈<\/small>/);
  assert.match(html, /aria-label="2026-08-10 · 10:00–10:30 · JST · 株式会社テスト/);
  assert.match(html, /title="2026-08-10 · 10:00–10:30 · JST · 株式会社テスト/);
});

test("月格和议程的状态点提供文字说明，不只靠颜色区分等待与结束", () => {
  const notes = [
    { path: "waiting.md", frontmatter: { type: "job-case", case_id: "waiting", status: "面接中", waiting_for: "company", waiting_label: "面談後の結果" }, content: "" },
    { path: "closed.md", frontmatter: { type: "job-case", case_id: "closed", status: "不採用", waiting_for: "company" }, content: "" },
  ];
  const html = renderToStaticMarkup(createElement(components.default, {
    today: "2026-08-10", notes,
    events: notes.map((note) => ({
      id: note.frontmatter.case_id, note, caseId: note.frontmatter.case_id,
      kind: "event", date: "2026-08-09", time: "10:00", company: "株式会社テスト",
      label: "面谈", phase: "past", prepPath: "",
    })),
    interviewTargets: new Map(), onOpen() {}, onInterview() {},
  }));
  assert.match(html, /aria-label="日程状态图例"/);
  assert.match(html, /calendar-event past kind-event status-waiting/);
  assert.match(html, /agenda-item past kind-event status-waiting/);
  assert.match(html, /calendar-event past kind-event status-closed/);
  assert.match(html, /agenda-item past kind-event status-closed/);
  assert.match(html, /aria-label="[^"]*面談後の結果/);
  assert.match(html, /title="[^"]*已结束/);
});

test("轮次未确认与猎头面谈有明确标记，不能伪装成轻松面谈或正式第一轮", () => {
  const labels = ["人事面谈", "猎头面谈", "招聘说明会"];
  const html = renderToStaticMarkup(createElement(components.default, {
    today: "2026-08-10", notes: [],
    events: labels.map((label, index) => ({
      id: String(index), note: { path: `${index}.md`, frontmatter: { type: "todo" }, content: "" },
      kind: "event", date: "2026-08-10", time: "10:00", company: "株式会社テスト", label,
      phase: "upcoming", caseId: "", prepPath: "",
    })),
    interviewTargets: new Map(), onOpen() {}, onInterview() {},
  }));
  const cards = [...html.matchAll(/<button\b[^>]*class="calendar-event [^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
  assert.equal(cards.length, 3);
  assert.match(cards[0], /aria-label="[^"]*人事面谈 · 轮次待确认/);
  assert.match(cards[0], /aria-hidden="true">\?<\/span>/);
  assert.match(cards[1], /aria-hidden="true">猎<\/span>/);
  assert.doesNotMatch(cards[1], /轮次待确认/);
  assert.doesNotMatch(cards[2], /calendar-round-badge/);
  assert.doesNotMatch(cards.join(""), /round-(?:casual|numbered|final)/);
});

test("移除待办页面后，日历仍读取独立面谈并定位准备稿，期限和跟进不占用日历", () => {
  const note = (path, frontmatter) => ({ path, frontmatter, content: "", tags: [], stat: { ctime: 0, mtime: 1, size: 0 } });
  const meetingPath = "20_求職/_TODO/テスト_独立面談.md";
  const prepPath = "20_求職/テスト/面談準備.md";
  const notes = [
    note(meetingPath, { type: "todo", company: "株式会社テスト", status: "進行中", next_event_at: "2026-08-12 15:00", next_event_end_at: "2026-08-12 16:00", due: "2026-08-11" }),
    note(prepPath, { type: "interview-prep", company: "株式会社テスト", meeting: `[[${meetingPath}]]`, date: "2026-08-12", time: "15:00", round: "カジュアル面談", session_status: "scheduled" }),
    note("20_求職/_TODO/準備期限.md", { type: "todo", action: "資料を準備する", status: "未着手", due: "2026-08-13", priority: "high" }),
    note("20_求職/サンプル/案件.md", { type: "job-case", company: "株式会社サンプル", status: "応募済", waiting_for: "company", follow_up_at: "2026-08-14" }),
  ];
  const scoped = notes.filter((item) => noteInVaultScope(item, vaultScopeForView("calendar")));
  const events = buildCalendarEvents(scoped, new Date("2026-08-10T12:00:00+09:00"));
  assert.equal(events.length, 1);
  assert.equal(events[0].date, "2026-08-12");
  assert.equal(events[0].time, "15:00");
  const target = resolveCalendarInterview(events[0], scoped);
  assert.equal(target.view, "session");
  assert.equal(target.path, prepPath);
  const html = renderToStaticMarkup(createElement(components.default, {
    today: "2026-08-10", events, notes: scoped, interviewTargets: new Map([[events[0].id, target]]), onOpen() {}, onInterview() {},
  }));
  assert.match(html, /JST · 株式会社テスト/);
  assert.match(html, /15:00–16:00/);
  assert.match(html, /查看安排/);
  assert.doesNotMatch(html, /資料を準備する|株式会社サンプル|行动期限|跟进日期|行动清单/);
});

test("月度代投概况与日格入口保留多岗位差异，不预载巨大列表", () => {
  const note = (id, company, position) => ({ path: `20_求職/テスト/${id}.md`, content: `# ${company} — ${position}`,
    frontmatter: { type: "job-case", case_id: id, company, position, status: "応募済", applied_on: "2026-08-10", application_actor: "ai", application_agent: "Codex" }, tags: [], stat: { ctime: 0, mtime: 1, size: 0 } });
  const notes = [note("a", "株式会社テスト", "データ基盤"), note("b", "テスト", "バックエンド"), note("c", "株式会社ダミー", "SRE")];
  const html = renderToStaticMarkup(createElement(components.default, {
    today: "2026-08-10", notes, events: [], interviewTargets: new Map(), onOpen() {}, onInterview() {},
  }));
  assert.match(html, /<button type="button" class="calendar-ai-applications"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(html, /calendar-application-list|<details class="calendar-ai-applications"/);
  assert.match(html, /aria-label="2026-08-10 JST · AI 代投 2 家公司 · 3 个岗位 · 展开申请详情[^"]*"/);
  assert.match(html, /class="calendar-month-applications"/);
  assert.match(html, /本月 AI 代投/);
  assert.match(html, /<strong>2<\/strong><span>家公司<\/span>/);
  assert.match(html, /3 个岗位/);
  assert.doesNotMatch(html, /今天 AI 代投|calendar-application-summary/);
  for (const title of ["データ基盤", "バックエンド", "SRE"]) assert.doesNotMatch(html, new RegExp(title));
  assert.doesNotMatch(html, /class="calendar-event |class="agenda-item /);
  assert.match(html, /未来七天没有已确认的安排/);
});

test("申请资料未加载时不冒称当月零代投，默认月份使用传入的JST日期", async () => {
  const defaultMonth = await loadAppModule("app/calendar-view.tsx", { globals: { window: { location: { search: "" } } } });
  const html = renderToStaticMarkup(createElement(defaultMonth.default, {
    today: "2026-08-10", notes: [], events: [], loading: true, interviewTargets: new Map(), onOpen() {}, onInterview() {},
  }));
  assert.match(html, /2026年8月/);
  assert.match(html, /正在读取申请记录/);
  assert.doesNotMatch(html, /当前月份暂无已确认的 AI 代投|calendar-application-count/);
});

test("AI代投栏随日语界面切换，保留原始公司岗位并翻译加载和空态", async () => {
  const japanese = await loadAppModule("app/calendar-view.tsx", {
    stubs: { "./ui-locale": { useUiLocale: () => ({ locale: "ja", setLocale() {} }) } },
    globals: { window: { location: { search: "?month=2026-08" } } },
  });
  const note = {
    path: "20_求職/テスト/応募.md", content: "# 株式会社テスト — 原始中文岗位", tags: [], stat: { ctime: 0, mtime: 1, size: 0 },
    frontmatter: { type: "job-case", case_id: "test", company: "株式会社テスト", position: "原始中文岗位", status: "応募済", applied_on: "2026-08-10", application_actor: "ai", application_agent: "Codex" },
  };
  const props = { today: "2026-08-10", notes: [note], events: [], interviewTargets: new Map(), onOpen() {}, onInterview() {} };
  const html = renderToStaticMarkup(createElement(japanese.default, props));
  assert.match(html, /今月のAI代行応募/);
  assert.match(html, /AI代行応募 1 社 · 1 求人 · 応募の詳細を開く/);
  const trigger = html.match(/<button[^>]+class="calendar-ai-applications"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.ok(trigger);
  assert.doesNotMatch(trigger.replace(/<[^>]+>/g, ""), /1 求人/, "会社数と同じ求人件数は日格で繰り返さない");
  assert.doesNotMatch(html, /原始中文岗位|calendar-application-list/);
  assert.doesNotMatch(html, /AI 代投|家公司的|个岗位|查看记录|今天暂无/);

  const loading = renderToStaticMarkup(createElement(japanese.default, { ...props, notes: [], loading: true }));
  assert.match(loading, /応募記録を読み込み中/);
  assert.doesNotMatch(loading, /対象月に確認済みのAI代行応募はありません|calendar-application-count/);
  const empty = renderToStaticMarkup(createElement(japanese.default, { ...props, notes: [] }));
  assert.match(empty, /対象月に確認済みのAI代行応募はありません/);
});

test("投递概况依据当前显示月份，公司的多个岗位仍保留数量差异", async () => {
  const anotherMonth = await loadAppModule("app/calendar-view.tsx", { globals: { window: { location: { search: "?month=2026-07" } } } });
  const note = (id, applied_on, company) => ({ path: `20_求職/テスト/${id}.md`, content: `# ${company} — 求人${id}`, tags: [], stat: { ctime: 0, mtime: 1, size: 0 },
    frontmatter: { type: "job-case", case_id: id, company, position: `求人${id}`, status: "応募済", applied_on, application_actor: "ai", application_agent: "Codex" } });
  const html = renderToStaticMarkup(createElement(anotherMonth.default, {
    today: "2026-08-10", notes: [note("a", "2026-07-10", "株式会社テスト"), note("b", "2026-07-11", "株式会社テスト"), note("c", "2026-08-10", "株式会社ダミー")],
    events: [], interviewTargets: new Map(), onOpen() {}, onInterview() {},
  }));
  const pulse = html.slice(html.indexOf('<div class="calendar-pulse"'), html.indexOf('<div class="calendar-layout">'));
  assert.match(html, /2026年7月/);
  assert.match(pulse, /<strong>1<\/strong><span>家公司<\/span>/);
  assert.match(pulse, /2 个岗位/);
  assert.doesNotMatch(pulse, /<strong>2<\/strong><span>家公司<\/span>/, "不能统计真实今天所在月份");
});
