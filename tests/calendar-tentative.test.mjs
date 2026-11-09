import assert from "node:assert/strict";
import test from "node:test";
import { earliestCalendarCandidate } from "../lib/calendar-candidates.ts";
import { calendarConflicts } from "../lib/calendar-conflicts.ts";
import { resolveCalendarInterviewRequest } from "../lib/calendar-interview.ts";
import { buildCalendarReadModelRecords } from "../lib/calendar-query-model.ts";
import { calendarModelFromSnapshot } from "../lib/calendar-snapshot.ts";
import { buildCalendarSummary } from "../lib/calendar-summary.ts";
import { resolveIndexedInterviewTarget } from "../lib/interview-read-model-target.ts";
import { buildCalendarEvents, buildCommitments } from "../lib/memory-atlas-data.ts";
import { todayAppointmentCount } from "../lib/nav-badges.ts";
import { buildCalendarSnapshot } from "../lib/server/calendar-snapshot.ts";

const today = "2026-11-09";
const now = new Date(`${today}T12:00:00`);
const company = "株式会社テスト";
const note = (path, type, fields = {}, content = "# 测试资料") => ({
  path, content, tags: [], stat: { ctime: 0, mtime: 1, size: 0 }, frontmatter: { company, type, ...fields },
});
const owner = (fields = {}) => note("测试/岗位A.md", "job-case", {
  case_id: "role-a", status: "書類通過（書類審査）", status_updated: "2026-11-07",
  next_event_candidates: ["2026-11-15 15:00", "2026-11-12 10:00"], ...fields,
});
const prep = (fields = {}, path = "测试/一次面接准备.md") => note(path, "interview-prep", {
  case: "[[测试/岗位A]]", date: "未定", round: "一次面接", session_status: "preparing", ...fields,
});

test("仅使用真实日期和规范 JST 候选起点，全天候选保留空时间", () => {
  assert.equal(earliestCalendarCandidate("2026-11-12"), null);
  assert.deepEqual(earliestCalendarCandidate([
    "2026-02-29", "2026-11-10 24:00", "2026-11-11 17:00+08:00",
    "2026-11-12 09:00", "2026-11-12", "2026-11-13 09:00",
  ]), { date: "2026-11-12", time: "" });
  assert.deepEqual(earliestCalendarCandidate(["2026-11-11 12:00", "2026-11-11 09:00"]), {
    date: "2026-11-11", time: "09:00",
  });
});

test("书类通过的候选可打开同案未定稿，正文、TODO 和同公司另一岗位不借用", () => {
  const caseA = owner();
  const caseB = note("测试/岗位B.md", "job-case", {
    case_id: "role-b", status: "書類通過", next_event_candidates: ["2026-11-11"],
  });
  const noOffer = note("测试/岗位C.md", "job-case", { status: "書類通過", follow_up_at: "2026-11-09" }, "候选 2026-11-11 10:00");
  const noPass = note("测试/岗位D.md", "job-case", { status: "応募済", next_event_candidates: ["2026-11-11"] });
  const todo = note("测试/准备任务.md", "todo", { status: "書類通過", next_event_candidates: ["2026-11-11"] });
  const preparing = prep();
  const events = buildCalendarEvents([caseA, caseB, noOffer, noPass, todo, preparing], now);
  assert.deepEqual(events.map(({ date, time, caseId, tentative, prepPath }) => [date, time, caseId, tentative, prepPath]), [
    ["2026-11-11", "", "role-b", true, ""],
    ["2026-11-12", "10:00", "role-a", true, preparing.path],
  ]);
  const [ambiguous] = buildCalendarEvents([caseA, preparing, prep({}, "测试/另一准备稿.md")], now);
  assert.equal(ambiguous.prepPath, "");
});

test("真实确认取代本轮候选，过去的其他轮次保留", () => {
  const historical = prep({ round: "カジュアル面談", date: "2026-11-06", time: "11:00", session_status: "completed" });
  const preparing = prep({}, "测试/下一轮准备.md");
  const waiting = buildCalendarEvents([owner(), historical, preparing], now);
  assert.deepEqual(waiting.map(({ date, tentative }) => [date, tentative]), [
    ["2026-11-06", undefined], ["2026-11-12", true],
  ]);
  for (const notes of [
    [owner({ next_event_at: "2026-11-13 13:00" }), historical],
    [owner(), historical, prep({ date: "2026-11-13", time: "13:00", session_status: "scheduled" }, "测试/已确认.md")],
  ]) {
    assert.deepEqual(buildCalendarEvents(notes, now).map(({ date, tentative }) => [date, tentative]), [
      ["2026-11-06", undefined], ["2026-11-13", undefined],
    ]);
  }
});

test("逾期候选仍可通过索引打开准备稿，待确认日期不算已约定、发生或冲突", () => {
  const caseA = owner({ status_updated: "2026-11-01", next_event_candidates: ["2026-11-08 10:00", "2026-11-09 10:00"] });
  const preparing = prep();
  const notes = [caseA, preparing];
  const snapshot = buildCalendarSnapshot(notes);
  const model = calendarModelFromSnapshot(snapshot, today);
  const [event] = model.events;
  assert.equal(event.phase, "past");
  assert.equal(event.date, "2026-11-08");
  const progress = model.progressByEvent.get(event.id);
  assert.equal(progress.code, "tentative");
  assert.equal(progress.occurred, false);
  const destinations = model.interviewDestinations.get(event.id);
  assert.equal(destinations.session.path, preparing.path);
  assert.equal(destinations.review, null);
  assert.deepEqual(resolveCalendarInterviewRequest(destinations.session, notes, model.events, today), destinations.session);

  const records = buildCalendarReadModelRecords(notes, today);
  const catalog = records.find(({ kind }) => kind === "calendar-catalog").value;
  const day = records.find(({ kind, key }) => kind === "calendar-day" && key === event.date).value;
  assert.deepEqual(catalog.dates, [event.date]);
  assert.deepEqual(catalog.events.map(({ live, occurred, historical }) => [live, occurred, historical]), [[false, false, false]]);
  assert.equal(resolveIndexedInterviewTarget(destinations.session, day).path, preparing.path);
  assert.equal(records.find(({ kind }) => kind === "calendar-pulse").value.historicalTotal, 0);
  assert.equal(todayAppointmentCount(model.events, event.date), 0);
  assert.equal(buildCalendarSummary({ ...model, today: event.date }).next, null);
  assert.deepEqual(buildCommitments(notes, now), []);
  assert.equal(calendarConflicts([event, { id: "已确认", date: event.date, time: event.time }]).size, 0);
});
