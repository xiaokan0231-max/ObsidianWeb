import assert from "node:assert/strict";
import test from "node:test";
import { AI_APPLICATION_BUCKETS, buildAiApplicationDays, summarizeAiApplicationDays } from "../lib/calendar-applications.ts";
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

function reviewedTodo(caseId, fields = {}, id = caseId) {
  return {
    path: `20_求職/_TODO/テスト_${id}.md`, tags: [], stat: { ctime: 0, mtime: 1, size: 0 },
    content: "# 依頼された書類を提出する\n\n企業から書類の追加提出依頼を確認済み。",
    frontmatter: {
      type: "todo", case_id: caseId, status: "未着手", audience: "user",
      action: "依頼された書類を提出する", action_owner: "user", action_kind: "required", action_reviewed_at: TODAY,
      action_reason: "企業から追加書類の提出依頼がある", action_source: "https://example.com/messages/request-1",
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

test("六桶互斥统计公司，只有审核明确的本人动作进入needs-user", () => {
  const notes = [
    application("needs", { company: "株式会社テスト一", waiting_for: "company" }),
    application("progress", { company: "株式会社テスト二", status: "書類通過" }),
    application("unknown", { company: "株式会社テスト三" }),
    application("waiting", { company: "株式会社テスト四", waiting_for: "agent" }),
    application("paused", { company: "株式会社テスト五", status: "保留" }),
    application("closed", { company: "株式会社テスト六", status: "不採用（書類選考）" }),
    reviewedTodo("needs"),
  ];
  const [day] = buildAiApplicationDays(notes, TODAY);
  assert.deepEqual(AI_APPLICATION_BUCKETS, ["needs-user", "progressing", "unknown", "waiting", "paused", "closed"]);
  assert.equal(day.companyCount, 6);
  assert.equal(day.positionCount, 6);
  assert.deepEqual(Object.values(day.bucketCounts), [1, 1, 1, 1, 1, 1]);
  assert.equal(Object.values(day.bucketCounts).reduce((sum, count) => sum + count, 0), day.companyCount);
  assert.deepEqual(day.applications.find((item) => item.id === "needs").requiredActions, [notes.at(-1)]);
  assert.equal(day.companies.find((item) => item.applications[0].id === "waiting").bucket, "waiting");
});

test("本人动作须精确case_id，不能由公司名、文件路径或泛next_action补出", () => {
  const own = application("specific", { waiting_for: "company", next_action: "返信と書類提出が必要" });
  const noId = application("path-only", { case_id: undefined, company: "株式会社別テスト", waiting_for: "self" });
  const notes = [own, noId,
    reviewedTodo("specific-other"),
    reviewedTodo(" specific"),
    reviewedTodo("missing", { case_id: undefined, company: own.frontmatter.company }),
    reviewedTodo(noId.path),
  ];
  const [day] = buildAiApplicationDays(notes, TODAY);
  const found = day.applications.find((item) => item.id === "specific");
  assert.equal(found.bucket, "waiting");
  assert.deepEqual(found.requiredActions, []);
  assert.deepEqual(found.reviewActions, []);
  assert.equal(day.applications.find((item) => item.id === noId.path).bucket, "unknown");
  assert.equal(day.bucketCounts["needs-user"], 0);
});

test("未审核老TODO与self是待核对线索，缺字段不能计为本人义务", () => {
  for (const field of ["action_owner", "action_kind", "action_reviewed_at", "action", "action_reason", "action_source"]) {
    const job = application("legacy", { waiting_for: "company" });
    const todo = reviewedTodo("legacy", { [field]: undefined });
    const [day] = buildAiApplicationDays([job, todo], TODAY);
    assert.equal(day.applications[0].bucket, "unknown", field);
    assert.deepEqual(day.applications[0].requiredActions, [], field);
    assert.deepEqual(day.applications[0].reviewActions, [todo], field);
  }
  for (const fields of [
    { waiting_for: "self" },
    { application_decision: "await_company_reply" },
    { next_action: "企業からの依頼に返信する" },
  ]) {
    const [day] = buildAiApplicationDays([application("no-action-evidence", fields)], TODAY);
    assert.equal(day.applications[0].bucket, "unknown");
    assert.equal(day.bucketCounts["needs-user"], 0);
  }
  for (const status of ["書類通過", "面接中", "内定"]) {
    const [self] = buildAiApplicationDays([application("self", { status, waiting_for: "self" })], TODAY);
    assert.equal(self.applications[0].bucket, "unknown", `${status} 的self缺证据仍待核`);
    const old = reviewedTodo("progress", { action_reviewed_at: undefined });
    const [progress] = buildAiApplicationDays([application("progress", { status, waiting_for: "company" }), old], TODAY);
    assert.equal(progress.applications[0].bucket, "progressing");
    assert.deepEqual(progress.applications[0].reviewActions, [old]);
  }
});

test("同case_id不同来源的歧义案件不会被随意分配本人动作", () => {
  const first = application("ambiguous", { waiting_for: "company" });
  const other = { ...application("ambiguous", { status: "不採用" }), path: "20_求職/テスト/別の案件.md" };
  const todo = reviewedTodo("ambiguous");
  const [day] = buildAiApplicationDays([first, other, todo], TODAY);
  assert.equal(day.positionCount, 1, "保持原有case_id去重口径");
  assert.equal(day.applications[0].bucket, "unknown");
  assert.deepEqual(day.applications[0].requiredActions, []);
  assert.deepEqual(day.applications[0].reviewActions, [todo]);
});

test("审核日及TODO状态无效时不生成需本人处理，纯投影不改原数据", () => {
  for (const fields of [
    { status: "確認済み" }, { status: undefined }, { action_reviewed_at: "2026-08-11" },
    { action_reviewed_at: "2026-02-30" }, { expires_at: "不明" },
  ]) {
    const notes = [application("invalid", { waiting_for: "company" }), reviewedTodo("invalid", fields)];
    const before = structuredClone(notes);
    Object.freeze(notes[0].frontmatter); Object.freeze(notes[1].frontmatter); Object.freeze(notes);
    const [day] = buildAiApplicationDays(notes, TODAY);
    assert.equal(day.bucketCounts["needs-user"], 0, JSON.stringify(fields));
    assert.deepEqual(day.applications[0].requiredActions, []);
    assert.deepEqual(notes, before);
  }
});

test("可选、系统、历史、已完、保留及过期TODO不把外部等待升级为本人动作", () => {
  const nonActions = [
    { action_kind: "optional" }, { action_kind: "reference" }, { action_kind: "history" },
    { action_kind: "waiting", action_owner: "company" },
    { action_owner: "ai" }, { action_owner: "system" }, { action_owner: "agent" }, { action_owner: "platform" },
    { audience: "system" }, { status: "完了" }, { status: "保留" },
    { expires_at: "2026-08-09" },
  ];
  for (const fields of nonActions) {
    const [day] = buildAiApplicationDays([
      application("external", { waiting_for: "company" }), reviewedTodo("external", fields),
    ], TODAY);
    assert.equal(day.applications[0].bucket, "waiting", JSON.stringify(fields));
    assert.deepEqual(day.applications[0].requiredActions, [], JSON.stringify(fields));
    assert.deepEqual(day.applications[0].reviewActions, [], JSON.stringify(fields));
  }
});

test("同日同公司跨职位取优先桶，日期间独立且岗位与TODO均不重复", () => {
  const kinds = {
    "needs-user": { status: "応募済", waiting_for: "company" },
    progressing: { status: "面接中" },
    unknown: { status: "応募済" },
    waiting: { status: "応募済", waiting_for: "platform" },
    paused: { status: "保留" },
    closed: { status: "不採用" },
  };
  for (let first = 0; first < AI_APPLICATION_BUCKETS.length - 1; first += 1) {
    const preferred = AI_APPLICATION_BUCKETS[first];
    const lower = AI_APPLICATION_BUCKETS[first + 1];
    const one = application("one", { company: "株式会社ＴＥＳＴ", ...kinds[preferred] });
    const two = application("two", { company: "test（東京）", ...kinds[lower] });
    const action = reviewedTodo("one");
    const notes = [one, one, two, application("earlier", { company: "test", status: "不採用", applied_on: "2026-08-09" })];
    if (preferred === "needs-user") notes.push(action, action);
    const days = buildAiApplicationDays(notes, TODAY);
    assert.equal(days[0].companies[0].bucket, "closed");
    const day = days[1];
    assert.equal(day.companyCount, 1, preferred);
    assert.equal(day.positionCount, 2, preferred);
    assert.equal(day.companies[0].key, "test");
    assert.equal(day.companies[0].bucket, preferred);
    assert.equal(day.companies[0].applications.length, 2);
    assert.equal(day.bucketCounts[preferred], 1);
    assert.equal(Object.values(day.bucketCounts).reduce((sum, count) => sum + count, 0), 1);
    if (preferred === "needs-user") assert.deepEqual(day.applications.find((item) => item.id === "one").requiredActions, [action]);
  }
});

test("后续进展和拒否只改变当前桶，历史申请日与执行者不变", () => {
  const todo = reviewedTodo("history");
  for (const [status, expected] of [["応募済", "needs-user"], ["書類通過", "needs-user"], ["保留", "paused"], ["不採用（面談前終了）", "closed"]]) {
    const note = application("history", { status, applied_on: "2026-08-01", status_updated: TODAY, waiting_for: "self" });
    const [day] = buildAiApplicationDays([note, todo], TODAY);
    assert.equal(day.date, "2026-08-01");
    assert.equal(day.applications[0].bucket, expected);
    assert.equal(day.applications[0].agent, "Codex");
    assert.equal(day.companyCount, 1);
    assert.equal(day.applications[0].note, note);
    if (["paused", "closed"].includes(expected)) assert.deepEqual(day.applications[0].requiredActions, []);
  }
  for (const status of ["書類通過", "面接中", "内定"]) {
    const [day] = buildAiApplicationDays([application("selection", { status, waiting_for: "company" })], TODAY);
    assert.equal(day.applications[0].bucket, "progressing", status);
  }
});

test("受理凭证不是回复义务，明示等待和旧收据检查不能误增needs-user", () => {
  const note = application("receipt", { waiting_for: "company", next_action: "応募を受け付けました。ログインしてメッセージを確認できます" });
  const waiting = reviewedTodo("receipt", { action_owner: "company", action_kind: "waiting", action: "選考結果を待つ" });
  const receipt = { ...reviewedTodo("receipt", { type: "material" }, "receipt-material"), content: "# 応募受理\n返信先とログイン案内がある通知。" };
  const [day] = buildAiApplicationDays([note, waiting, receipt], TODAY);
  assert.equal(day.applications[0].bucket, "waiting");
  assert.equal(day.bucketCounts["needs-user"], 0);
  const oldReceiptTask = reviewedTodo("receipt", {
    action: "受理メールを確認する", action_owner: undefined, action_kind: undefined, action_reviewed_at: undefined,
  }, "old-receipt-task");
  const [needsReview] = buildAiApplicationDays([note, oldReceiptTask], TODAY);
  assert.equal(needsReview.applications[0].bucket, "unknown");
  assert.equal(needsReview.bucketCounts["needs-user"], 0);
});


test("月内跨日期同公司多岗位只占一段，并保留最高优先级的当前进展", () => {
  const days = buildAiApplicationDays([
    application("a", { applied_on: "2026-08-01", status: "不採用" }),
    application("b", { applied_on: "2026-08-03", status: "面接中" }),
    application("c", { company: "株式会社ダミー", applied_on: "2026-08-03", status: "応募済", waiting_for: "company" }),
    application("old", { company: "株式会社サンプル", applied_on: "2026-07-03", status: "不採用" }),
  ], TODAY);
  const summary = summarizeAiApplicationDays(days, "2026-08");
  assert.equal(summary.companyCount, 2);
  assert.equal(summary.positionCount, 3);
  assert.equal(summary.bucketCounts.progressing, 1);
  assert.equal(summary.bucketCounts.waiting, 1);
  assert.equal(summary.bucketCounts.closed, 0);
  assert.equal(Object.values(summary.bucketCounts).reduce((a, b) => a + b, 0), summary.companyCount);
  assert.equal(summarizeAiApplicationDays(days, "2026-09").companyCount, 0);
});
