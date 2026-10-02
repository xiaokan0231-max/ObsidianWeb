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

test("日历月格与议程显示明确时间范围，并标注日本时间", () => {
  const html = renderToStaticMarkup(createElement(components.default, {
    today: "2026-08-10",
    events: [{
      id: "test", note: { path: "test.md", frontmatter: { type: "todo" }, content: "" }, kind: "event", date: "2026-08-10", time: "10:00", endTime: "10:30",
      company: "株式会社テスト", label: "面谈", phase: "upcoming", caseId: "", prepPath: "",
    }],
    notes: [], interviewTargets: new Map(), onOpen() {}, onInterview() {},
  }));
  assert.match(html, /日本时间（JST）/);
  assert.match(html, /dateTime="2026-08-10T10:00\+09:00">10:00–10:30<\/time>/);
  assert.match(html, /<small>10:00–10:30 · 面谈<\/small>/);
  assert.match(html, /aria-label="2026-08-10 · 10:00–10:30 · JST · 株式会社テスト/);
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
  assert.match(html, /aria-label="当前进展图例"/);
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
