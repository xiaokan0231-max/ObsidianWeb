import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarSnapshot } from "../lib/server/calendar-snapshot.ts";
import { calendarModelFromSnapshot } from "../lib/calendar-snapshot.ts";
import { buildCalendarEvents } from "../lib/memory-atlas-data.ts";
import { buildAiApplicationDays } from "../lib/calendar-applications.ts";
import { resolveCalendarInterview, resolveCalendarInterviewDestinations } from "../lib/calendar-interview.ts";
import { calendarProgress } from "../lib/calendar-progress.ts";

const note = (path, frontmatter, content = "# テスト\n本文") => ({
  path, frontmatter, content, tags: [], stat: { ctime: 1, mtime: 2, size: content.length },
});
const owner = note("案件.md", { type: "job-case", company: "株式会社テスト", case_id: "test-case", status: "書類通過",
  next_event: "2026-10-28 17:00 面接", applied_on: "2026-10-01", application_actor: "ai", application_agent: "Codex" });
const prep = note("準備.md", { type: "interview-prep", case: "[[案件]]", case_id: "test-case", company: "株式会社テスト",
  date: "2026-10-28", time: "17:00", round: "一次面接", session_status: "scheduled" });
const todo = note("対応.md", { type: "todo", case_id: "test-case", status: "未着手", audience: "user",
  action_owner: "user", action_kind: "required", action_next_owner: "company", action_reviewed_at: "2026-10-01",
  action: "資料を提出", action_reason: "企業から依頼", action_source: "受信連絡", expires_at: "2026-10-27" });

const comparableApplications = (days) => days.map((day) => ({ date: day.date, companyCount: day.companyCount,
  positionCount: day.positionCount, bucketCounts: day.bucketCounts, applications: day.applications.map((application) => ({
    id: application.id, position: application.position, bucket: application.bucket,
    required: application.requiredActions.map((item) => item.path), review: application.reviewActions.map((item) => item.path),
  })),
}));

test("轻量日历跨 JST 日界后仍与完整材料的日程、状态和显式入口一致", () => {
  const notes = [owner, prep, todo];
  const snapshot = JSON.parse(JSON.stringify(buildCalendarSnapshot(notes)));
  for (const today of ["2026-10-26", "2026-10-28", "2026-10-29"]) {
    const model = calendarModelFromSnapshot(snapshot, today);
    const events = buildCalendarEvents(notes, new Date(`${today}T00:00:00`));
    assert.deepEqual(model.events.map((event) => ({ ...event, note: undefined })), events.map((event) => ({ ...event, note: undefined })));
    assert.ok(events.length, "验证真实场次而不是空数组");
    for (const event of events) {
      const target = resolveCalendarInterview(event, notes);
      assert.deepEqual(model.interviewTargets.get(event.id), target);
      assert.deepEqual(model.interviewDestinations.get(event.id), resolveCalendarInterviewDestinations(event, notes));
      assert.deepEqual(model.progressByEvent.get(event.id), calendarProgress(event, notes, target));
    }
    assert.deepEqual(comparableApplications(model.applicationDays), comparableApplications(buildAiApplicationDays(notes, today)));
  }
});

test("超大正文和非日历元数据不进入摘要，岗位仍保留正文标题兜底结果", () => {
  const marker = "不应传给日历首屏的正文";
  const large = { ...owner, content: `# 株式会社テスト · データ基盤\n${marker.repeat(200_000)}`,
    frontmatter: { ...owner.frontmatter, unrelated: marker.repeat(1000) } };
  const snapshot = buildCalendarSnapshot([large, prep]);
  const serialized = JSON.stringify(snapshot);
  assert.ok(Buffer.byteLength(serialized) < 10_000);
  assert.equal(serialized.includes(marker), false);
  assert.deepEqual(calendarModelFromSnapshot(snapshot, "2026-10-26").applicationDays.map((day) => day.positionCount), [1]);
  assert.equal(snapshot.selectionCount, 1);
});

test("申请同 ID 的归属冲突和已过期待办不能在摘要中变成确定行动", () => {
  const duplicate = { ...owner, path: "重复案件.md", frontmatter: { ...owner.frontmatter, application_actor: "user" } };
  const notes = [owner, duplicate, todo];
  const snapshot = buildCalendarSnapshot(notes);
  for (const today of ["2026-10-26", "2026-10-30"]) {
    assert.deepEqual(comparableApplications(calendarModelFromSnapshot(snapshot, today).applicationDays),
      comparableApplications(buildAiApplicationDays(notes, today)));
  }
});
