import assert from "node:assert/strict";
import test from "node:test";
import { buildAiApplicationDays } from "../lib/calendar-applications.ts";
import { calendarConflicts } from "../lib/calendar-conflicts.ts";
import { calendarProgress } from "../lib/calendar-progress.ts";
import { buildCalendarSummary, calendarDayOffset, shiftCalendarDay } from "../lib/calendar-summary.ts";

const TODAY = "2026-08-10";

function event(id, date, fields = {}) {
  return {
    id, date, time: "10:00", company: "株式会社テスト", label: "第一次面试", kind: "event",
    phase: date >= TODAY ? "upcoming" : "past", caseId: "", prepPath: "",
    note: { path: `${id}.md`, frontmatter: {}, content: "", tags: [], stat: { ctime: 0, mtime: 0, size: 0 } },
    ...fields,
  };
}

function application(id, company, appliedOn) {
  return {
    path: `20_求職/テスト/${id}.md`, content: "", tags: [], stat: { ctime: 0, mtime: 1, size: 0 },
    frontmatter: {
      type: "job-case", case_id: id, company, position: "データ基盤", status: "応募済",
      applied_on: appliedOn, application_actor: "ai", application_agent: "Codex",
    },
  };
}

test("JST 日期差与平移按日历日计算，跨月跨年不受本机时区影响", () => {
  assert.equal(calendarDayOffset("2026-08-10", "2026-08-10"), 0);
  assert.equal(calendarDayOffset("2026-08-10", "2026-08-13"), 3);
  assert.equal(calendarDayOffset("2026-08-10", "2026-08-07"), -3);
  assert.equal(calendarDayOffset("2026-12-31", "2027-01-01"), 1);
  assert.equal(calendarDayOffset("2026-08-10", "not-a-date"), null);
  assert.equal(shiftCalendarDay("2026-08-31", 1), "2026-09-01");
  assert.equal(shiftCalendarDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftCalendarDay("2026-08-10", 6), "2026-08-16");
});

test("态势数字：7 天窗口含今天，下一场跳过已结束案件的旧预约", () => {
  const events = [
    event("past-waiting-a", "2026-08-01", { caseId: "case-a" }),
    event("past-waiting-a2", "2026-08-05", { caseId: "case-a" }),
    event("past-waiting-b", "2026-08-06", { caseId: "case-b" }),
    event("past-unknown", "2026-08-07"),
    event("stale-rejected", "2026-08-10", { time: "09:00" }),
    event("today", "2026-08-10", { time: "15:00" }),
    event("edge", "2026-08-16"),
    event("outside", "2026-08-17"),
  ];
  const tones = {
    "past-waiting-a": "waiting", "past-waiting-a2": "waiting", "past-waiting-b": "waiting",
    "past-unknown": "unknown", "stale-rejected": "closed", today: "active", edge: "active", outside: "active",
  };
  const progressByEvent = new Map(Object.entries(tones).map(([id, tone]) => [id, { tone,
    ...(id === "past-unknown" ? { code: "association-conflict" } : {}),
  }]));
  const summary = buildCalendarSummary({ events, progressByEvent, applicationDays: [], today: TODAY });
  assert.equal(summary.weekCount, 2);
  assert.equal(summary.next?.event.id, "today");
  assert.equal(summary.next?.days, 0);
  assert.equal(summary.waitingCount, 2, "同一案件多场等回复只算一次");
  assert.equal(summary.unknownCount, 1);
  assert.equal(summary.historicalCount, 0);
  assert.equal(summary.monthAiCompanies, 0);
});

test("没有未来场次时下一场为空，不把过去的日程当成下一场", () => {
  const events = [event("past", "2026-08-01")];
  const summary = buildCalendarSummary({
    events, progressByEvent: new Map([["past", { tone: "active" }]]), applicationDays: [], today: TODAY,
  });
  assert.equal(summary.next, null);
  assert.equal(summary.weekCount, 0);
});

test("当天已完成复盘的历史通过不冒充下一场，真正scheduled场次保持", () => {
  const completed = event("today-completed", TODAY, { time: "09:00" });
  completed.note.frontmatter = { type: "review", company: completed.company, date: TODAY, result: "通過" };
  const progress = calendarProgress(completed, [completed.note], {
    view: "review", path: completed.note.path, sourcePath: completed.note.path,
    company: completed.company, date: TODAY, label: completed.label, caseId: "",
  });
  assert.equal(progress.code, "recorded-passed");
  const upcoming = event("today-scheduled", TODAY, { time: "16:00" });
  const summary = buildCalendarSummary({ events: [completed, upcoming],
    progressByEvent: new Map([[completed.id, progress], [upcoming.id, { tone: "active", code: "scheduled" }]]),
    applicationDays: [], today: TODAY });
  assert.equal(summary.historicalCount, 1);
  assert.equal(summary.weekCount, 1);
  assert.equal(summary.next?.event.id, upcoming.id);
});

test("本月 AI 代投按公司名归一去重，只算今天以前的本月记录", () => {
  const notes = [
    application("a", "株式会社テスト", "2026-08-03"),
    application("b", "テスト", "2026-08-09"),
    application("c", "株式会社ダミー", "2026-08-10"),
    application("d", "株式会社サンプル", "2026-07-31"),
  ];
  const applicationDays = buildAiApplicationDays(notes, TODAY);
  const summary = buildCalendarSummary({ events: [], progressByEvent: new Map(), applicationDays, today: TODAY });
  assert.equal(summary.monthAiCompanies, 2);
});

test("历史说明统计全部历史独立场次，含当轮拒绝，不与真正关联冲突混算", () => {
  const facts = [
    ["rejected-a", "2026-07-01", "recorded-rejected", "closed"],
    ["rejected-b", "2026-07-02", "recorded-rejected", "closed"],
    ["rejected-c", "2026-07-03", "recorded-rejected", "closed"],
    ["rejected-d", "2026-07-04", "recorded-rejected", "closed"],
    ["passed", "2026-07-05", "recorded-passed", "neutral"],
    ["generic", "2026-07-06", "historical-result", "neutral"],
    ["unlinked", "2026-08-01", "historical-unlinked", "neutral"],
    ["missing", "2026-08-02", "association-missing", "neutral"],
    ["meeting", "2026-08-03", "recorded-meeting-completed", "neutral"],
    ["conflict", "2026-08-04", "association-conflict", "unknown"],
    ["known-current", "2026-08-05", "rejected", "closed"],
  ];
  const events = facts.map(([id, date]) => event(id, date, { caseId: "same-company-different-rounds" }));
  const progressByEvent = new Map(facts.map(([id, , code, tone]) => [id, { code, tone }]));
  const summary = buildCalendarSummary({ events: [...events, events[0], events[9]], progressByEvent, applicationDays: [], today: TODAY });
  assert.equal(summary.historicalCount, 9, "历史场次不按公司/案件合并，不被本月筛选裁掉");
  assert.equal(summary.unknownCount, 1, "同一冲突场次重复输入只算一次");
  assert.equal(summary.waitingCount, 0);
});

test("等待按明确案件或独立面谈正本去重，不能按同公司混合不同归属", () => {
  const facts = [
    ["case-a1", "case:a"], ["case-a2", "case:a"], ["case-b", "case:b"],
    ["meeting-a1", "meeting:20_求職/テスト/独立A.md"], ["meeting-a2", "meeting:20_求職/テスト/独立A.md"],
    ["meeting-b", "meeting:20_求職/テスト/独立B.md"],
  ];
  const events = facts.map(([id]) => event(id, "2026-08-01"));
  const progressByEvent = new Map(facts.map(([id, ownerKey]) => [id, { tone: "waiting", ownerKey }]));
  const summary = buildCalendarSummary({ events, progressByEvent, applicationDays: [], today: TODAY });
  assert.equal(summary.waitingCount, 4);
});

test("时间冲突：重叠才算，首尾相接不算，缺结束时刻按 60 分钟", () => {
  const slots = [
    { id: "a", date: TODAY, time: "10:00", endTime: "11:00" },
    { id: "b", date: TODAY, time: "11:00", endTime: "12:00" },
    { id: "c", date: TODAY, time: "13:00" },
    { id: "d", date: TODAY, time: "13:30", endTime: "14:00" },
    { id: "e", date: "2026-08-11", time: "13:30" },
    { id: "f", date: TODAY, time: "" },
  ];
  assert.deepEqual([...calendarConflicts(slots)].sort(), ["c", "d"]);
});

test("时间冲突：长场次盖住后面多场时都标出，无效结束时刻退回默认时长", () => {
  const slots = [
    { id: "long", date: TODAY, time: "09:00", endTime: "12:00" },
    { id: "mid", date: TODAY, time: "10:00", endTime: "10:30" },
    { id: "late", date: TODAY, time: "11:30" },
    { id: "bad-end", date: "2026-08-12", time: "10:00", endTime: "09:00" },
    { id: "after-bad", date: "2026-08-12", time: "10:30" },
  ];
  assert.deepEqual([...calendarConflicts(slots)].sort(), ["after-bad", "bad-end", "late", "long", "mid"]);
});
