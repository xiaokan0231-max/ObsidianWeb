import assert from "node:assert/strict";
import test from "node:test";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { buildCalendarReadModelRecords } from "../lib/calendar-query-model.ts";
import { buildCalendarSnapshot } from "../lib/server/calendar-snapshot.ts";
import { buildCalendarPulseSummary } from "../lib/calendar-pulse-summary.ts";
import { buildAiApplicationDays } from "../lib/calendar-applications.ts";

const TODAY = "2026-10-29";
class ReadModelError extends Error { constructor(message, status = 503) { super(message); this.status = status; } }
function application(id, fields = {}) {
  return { path: `20_求職/测试/${id}.md`, tags: [], stat: { ctime: 1, mtime: 2, size: 20 }, content: "# 株式会社テスト — 开发", frontmatter: {
    type: "job-case", company: "株式会社テスト", case_id: id, status: "応募済", application_actor: "ai", application_agent: "Codex", applied_on: "2026-10-01", ...fields,
  } };
}
async function moduleFor(notes, today = TODAY, transform = () => {}) {
  const records = new Map(buildCalendarReadModelRecords(notes, today).map((record) => [JSON.stringify([record.kind, record.key]), record.value]));
  transform(records);
  let date = today;
  const calls = [];
  const runtime = { revision: "pinned-test", syncState: "ready", model: {
    async readRecord(revision, kind, key) { assert.equal(revision, "pinned-test"); calls.push({ kind, keys: [key] }); return records.get(JSON.stringify([kind, key])) ?? null; },
    async readRecords(revision, kind, keys) {
      assert.equal(revision, "pinned-test"); calls.push({ kind, keys });
      // 真正 SQL 按 key 升序返回，不能假设与 IN 参数或 UI 所需顺序相同。
      return [...new Set(keys)].sort().flatMap((key) => { const value = records.get(JSON.stringify([kind, key])); return value ? [{ kind, key, value }] : []; });
    },
  } };
  const loaded = await loadAppModule("app/read-model-calendar.ts", { stubs: {
    "./read-model-server": { ReadModelError, async readModelRuntime(revision) { if (revision && revision !== runtime.revision) throw new ReadModelError("版本已过期", 409); return runtime; } },
    "@/lib/dojo/utils": { tokyoParts: () => ({ date }) },
  } });
  return { ...loaded, calls, records, setDate(value) { date = value; } };
}

test("范围只批量读取相关日期，月度公司跨日去重沿用预聚合，未知月不伪造全局零值", async () => {
  const notes = [application("first", { next_event_at: "2026-10-03 10:00", next_event_label: "一次面接" }), application("second", { applied_on: "2026-10-02" }), application("other", { company: "株式会社ダミー", applied_on: "2026-10-04" }), application("future", { next_event_at: "2026-11-20 11:00", next_event_label: "一次面接" })];
  const loaded = await moduleFor(notes);
  const snapshot = buildCalendarSnapshot(notes);
  const page = await loaded.calendarRange(new URLSearchParams({ revision: "pinned-test", from: "2026-10-01", to: "2026-10-31", month: "2026-10" }));
  assert.deepEqual(page.summary, buildCalendarPulseSummary(snapshot, TODAY, "2026-10"));
  assert.equal(page.summary.applications.companyCount, 2);
  assert.equal(page.summary.applications.positionCount, 4);
  assert.deepEqual(page.snapshot.applicationNotes, []);
  assert.equal(page.revision, "pinned-test");
  assert.equal(loaded.calls.filter((call) => call.kind === "calendar-day").length, 1);
  assert.equal(new Set(loaded.calls.find((call) => call.kind === "calendar-day").keys).size, loaded.calls.find((call) => call.kind === "calendar-day").keys.length);
  assert.ok(loaded.calls.every((call) => !["calendar-source", "calendar-applications"].includes(call.kind)));
  const empty = await loaded.calendarRange(new URLSearchParams({ from: "2027-01-01", to: "2027-01-31", month: "2027-01" }));
  assert.deepEqual(empty.summary, buildCalendarPulseSummary(snapshot, TODAY, "2027-01"));
  await assert.rejects(loaded.calendarRange(new URLSearchParams({ revision: "wrong" })), { status: 409 });
});

test("历史每页12场且保持降序，同日多场只读取一次日期，不把整日其他场次带回本页", async () => {
  const notes = Array.from({ length: 20 }, (_, index) => application(`case${index}`, { company: `株式会社テスト${index}`, next_event_at: `2026-10-${String(Math.floor(index / 2) + 1).padStart(2, "0")} ${index % 2 ? "11:00" : "10:00"}`, next_event_label: "一次面接" }));
  const loaded = await moduleFor(notes, TODAY, (records) => { const catalog = records.get(JSON.stringify(["calendar-catalog", "root"])); catalog.events = catalog.events.map((event) => ({ ...event, historical: true })); });
  const first = await loaded.calendarHistory(new URLSearchParams({ revision: "pinned-test" }));
  assert.equal(first.events.length, 12);
  assert.equal(first.total, 20);
  assert.equal(first.nextOffset, 12);
  const sorted = [...first.events].sort((a, b) => b.event.date.localeCompare(a.event.date) || b.event.time.localeCompare(a.event.time) || a.event.id.localeCompare(b.event.id));
  assert.deepEqual(first.events.map((entry) => entry.event.id), sorted.map((entry) => entry.event.id));
  const second = await loaded.calendarHistory(new URLSearchParams({ revision: "pinned-test", offset: String(first.nextOffset) }));
  assert.equal(second.events.length, 8);
  assert.equal(second.nextOffset, null);
  assert.equal(new Set([...first.events, ...second.events].map((entry) => entry.event.id)).size, 20);
  assert.ok(loaded.calls.filter((call) => call.kind === "calendar-day").every((call) => call.keys.length <= 6));
});

test("JST跨日按固定资料版本重算申请与过期行动桶，之后复用当日投影", async () => {
  const notes = [application("case"), { path: "20_求職/_TODO/测试.md", tags: [], stat: { ctime: 1, mtime: 2, size: 1 }, content: "# 提交资料", frontmatter: {
    type: "todo", case_id: "case", status: "未着手", audience: "user", action: "提交资料", action_owner: "user", action_kind: "required", action_reviewed_at: TODAY,
    action_reason: "测试通知要求", action_source: "https://example.com/test", expires_at: TODAY,
  } }, application("tomorrow", { applied_on: "2026-10-30", company: "株式会社ダミー" })];
  const loaded = await moduleFor(notes);
  const before = await loaded.calendarApplication(new URLSearchParams({ revision: "pinned-test", date: "2026-10-01" }));
  assert.equal(before.day.bucketCounts["needs-user"], 1);
  assert.equal((await loaded.calendarApplication(new URLSearchParams({ date: "2026-10-30" }))).day, null);
  loaded.setDate("2026-10-30");
  const after = await loaded.calendarApplication(new URLSearchParams({ revision: "pinned-test", date: "2026-10-01" }));
  assert.deepEqual(after.day, buildAiApplicationDays(buildCalendarSnapshot(notes).applicationNotes, "2026-10-30").find((day) => day.date === "2026-10-01"));
  assert.equal(after.day.bucketCounts["needs-user"], 0);
  assert.equal((await loaded.calendarApplication(new URLSearchParams({ date: "2026-10-30" }))).day.companyCount, 1);
  const range = await loaded.calendarRange(new URLSearchParams({ month: "2026-10", from: "2026-10-01", to: "2026-10-31" }));
  assert.equal(range.today, "2026-10-30");
  assert.deepEqual(range.summary, buildCalendarPulseSummary(buildCalendarSnapshot(notes), "2026-10-30", "2026-10"));
  assert.equal(loaded.calls.filter((call) => call.kind === "calendar-source").length, 1);
});

test("无效公历日、月份及过宽范围明确返回400，二月默认范围使用真实月末", async () => {
  const loaded = await moduleFor([]);
  for (const input of [{ from: "2026-02-30", to: "2026-03-01" }, { from: "2026-01-01", to: "2026-12-01" }, { month: "2026-13" }, { from: "2026-10-02", to: "2026-10-01" }]) await assert.rejects(loaded.calendarRange(new URLSearchParams(input)), { status: 400 });
  await assert.rejects(loaded.calendarApplication(new URLSearchParams({ date: "2026-02-30" })), { status: 400 });
  const february = await moduleFor([], "2026-02-28");
  assert.equal((await february.calendarRange(new URLSearchParams())).summary.month, "2026-02");
});
