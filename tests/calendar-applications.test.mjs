import assert from "node:assert/strict";
import test from "node:test";
import { buildAiApplicationDays } from "../lib/calendar-applications.ts";
import { buildCalendarEvents, buildCommitments, countdownLabel } from "../lib/memory-atlas-data.ts";
import { resolveCalendarInterview } from "../lib/calendar-interview.ts";
import { tokyoParts } from "../lib/dojo/utils.ts";
import { noteInVaultScope, vaultScopeForView } from "../lib/vault-scope.ts";

const TODAY = "2026-08-10";
function application(id, fields = {}) {
  return {
    path: `20_求職/テスト/${id}.md`, tags: [], stat: { ctime: 0, mtime: 1, size: 0 },
    content: "# 株式会社テスト — データエンジニア",
    frontmatter: {
      type: "job-case", case_id: id, company: "株式会社テスト", position: "データエンジニア",
      status: "応募済", applied_on: TODAY, application_actor: "ai", application_agent: "Codex",
      ...fields,
    },
  };
}

test("JST跨日时日历日程与面试入口同用日本日期，保留本机视图口径", () => {
  const previousTimezone = process.env.TZ;
  const instant = new Date("2026-10-02T15:30:00Z");
  const notes = [
    application("past", { next_event_at: "2026-10-02 10:00", next_event_label: "一次面接" }),
    application("today", { next_event_at: "2026-10-03 10:00", next_event_label: "一次面接" }),
  ];
  try {
    for (const timezone of ["UTC", "Asia/Shanghai", "America/Los_Angeles"]) {
      process.env.TZ = timezone;
      const calendarToday = tokyoParts(instant).date;
      assert.equal(calendarToday, "2026-10-03");
      assert.equal(buildCalendarEvents(notes, instant)[0].phase, "upcoming", timezone);
      const calendarNow = new Date(`${calendarToday}T00:00:00`);
      const events = buildCalendarEvents(notes, calendarNow);
      assert.deepEqual(events.map(({ date, phase, time }) => [date, phase, time]), [
        ["2026-10-02", "past", "10:00"], ["2026-10-03", "upcoming", "10:00"],
      ], timezone);
      assert.deepEqual(events.map((event) => resolveCalendarInterview(event, notes)?.view), ["review", "session"], timezone);
      const nextEvent = events.filter((event) => event.phase === "upcoming")
        .toSorted((left, right) => `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`))[0];
      assert.equal(nextEvent.date, calendarToday, timezone);
      assert.equal(resolveCalendarInterview(nextEvent, notes)?.view, "session", timezone);
      assert.equal(countdownLabel(nextEvent.date, calendarNow), "今天", timezone);
      assert.equal(countdownLabel(nextEvent.date, instant), "明天", `${timezone} 本机日界与JST不同`);
      assert.equal(countdownLabel("2026-10-02", calendarNow), "1 天前", timezone);
      assert.equal(countdownLabel("2026-10-04", calendarNow), "明天", timezone);
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("代投只认明确执行者和合法成功応募，不从作者、推荐或状态观察日推定", () => {
  const notes = [
    application("confirmed"),
    application("author", { application_actor: undefined, ai_author: "Codex", origin: "ai-reco" }),
    application("user", { application_actor: "user" }),
    application("agent", { application_actor: "agent" }),
    application("draft", { status: "未応募" }),
    application("no-agent", { application_agent: "" }),
    application("unknown-status", { status: "送信未確認" }),
    application("observed", { applied_on: undefined, status: "応募済（2026-08-10確認）", date: TODAY }),
    application("invalid-day", { applied_on: "2026-02-30" }),
    application("invalid-month", { applied_on: "2026-13-01" }),
    application("timestamp", { applied_on: "2026-08-10T00:00:00+09:00" }),
    application("future", { applied_on: "2026-08-11" }),
    application("log", { type: "application_log" }),
  ];
  const days = buildAiApplicationDays(notes, TODAY);
  assert.equal(days.length, 1);
  assert.equal(days[0].companyCount, 1);
  assert.deepEqual(days[0].applications.map((item) => item.id), ["confirmed"]);
});

test("当天公司正規化去重，多个岗位和其他日的申请各自保留", () => {
  const first = application("first", { company: "株式会社ＴＥＳＴ", position: "データ基盤" });
  const notes = [
    first, first,
    application("second", { company: "test（東京）", position: "バックエンド" }),
    application("other", { company: "株式会社ダミー" }),
    application("earlier", { company: "test", applied_on: "2026-08-09" }),
  ];
  const days = buildAiApplicationDays(notes, TODAY);
  assert.deepEqual(days.map(({ date, companyCount, positionCount }) => ({ date, companyCount, positionCount })), [
    { date: "2026-08-09", companyCount: 1, positionCount: 1 },
    { date: TODAY, companyCount: 2, positionCount: 3 },
  ]);
  assert.deepEqual(new Set(days[1].applications.map((item) => item.note.path)), new Set(notes.slice(0, 4).map((note) => note.path)));
});

test("date-only応募日不转换；JST已跨日时与浏览器时区无关", () => {
  const previousTimezone = process.env.TZ;
  try {
    for (const timezone of ["UTC", "Asia/Shanghai", "America/Los_Angeles"]) {
      process.env.TZ = timezone;
      const today = tokyoParts(new Date("2026-08-09T15:30:00Z")).date;
      assert.equal(today, TODAY);
      const days = buildAiApplicationDays([application("jst")], today);
      assert.equal(days[0].date, TODAY);
    }
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("历史本人いいかも及今天AI初回联络不会生成今日代投；后来拒否不删除真实代投", () => {
  const notes = [
    application("old-like", { channel: "Findy", applied_on: "2026-08-01", application_actor: "user", ai_author: "Codex", date: TODAY, updated: TODAY }),
    application("contact", { type: "todo", applied_on: undefined, date: TODAY }),
    application("closed", { status: "不採用（2026-08-10・書類選考）", applied_on: "2026-08-09" }),
    application("interviewing", { status: "面接中" }),
  ];
  const days = buildAiApplicationDays(notes, TODAY);
  assert.deepEqual(days.flatMap((day) => day.applications.map((item) => item.id)), ["closed", "interviewing"]);
});

test("冷启动calendar scope可读活动，申请不进入日程、承诺和占用", () => {
  const note = application("scoped");
  const notes = [note].filter((item) => noteInVaultScope(item, vaultScopeForView("calendar")));
  assert.equal(buildAiApplicationDays(notes, TODAY)[0].positionCount, 1);
  const now = new Date(`${TODAY}T12:00:00+09:00`);
  assert.deepEqual(buildCalendarEvents(notes, now), []);
  assert.deepEqual(buildCommitments(notes, now), []);
  const scheduled = { ...note, frontmatter: { ...note.frontmatter, next_event_at: "2026-08-12 10:00", next_event_label: "一次面接" } };
  assert.deepEqual(buildCalendarEvents([scheduled], now).map((event) => event.date), ["2026-08-12"]);
});
