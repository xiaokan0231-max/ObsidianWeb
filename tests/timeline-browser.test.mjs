import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { filterTimelineEntries, nearestTimelineDate, timelineDate, timelineMonths } from "../lib/timeline-browser.ts";

const entry = (id, date, extra = {}) => ({
  id, sourceId: `${id}.md`, date: timelineDate(date), kind: "note", title: "テスト記録",
  excerpt: "本文", group: "career", groupLabel: "求职", color: "#2f6b59", kindLabel: "笔记", ...extra,
});

test("日期注记归一化，非法日历日期与未知日期不伪造日期", () => {
  assert.equal(timelineDate("2026-07-21・選考"), "2026-07-21");
  assert.equal(timelineDate("2026-02-30"), "");
  assert.equal(timelineDate("日期待定"), "");
  assert.equal(timelineDate("2024-02-29"), "2024-02-29");
  assert.equal(timelineDate("2025-02-29"), "");
});

test("事件独占日期仍可检索；同来源笔记与不同岗位的两场日程均保留", () => {
  const entries = [
    entry("n", "2026-09-04"),
    entry("event:a", "2026-09-05", { kind: "event", sourceId: "n.md", time: "14:00" }),
    entry("event:b", "2026-09-05", { kind: "event", sourceId: "b.md", time: "9:00" }),
  ];
  assert.deepEqual(filterTimelineEntries(entries, { date: "2026-09-05" }).map((item) => item.id), ["event:b", "event:a"]);
  assert.deepEqual(timelineMonths(entries), [{ key: "2026-09", noteCount: 1, eventCount: 2 }]);
  assert.equal(filterTimelineEntries(entries, { kind: "event" }).length, 2);
});

test("未知日期可访问，升降序都留在最后；同一天日程先按时间显示", () => {
  const entries = [entry("unknown", "来週"), entry("old", "2025-12-31"), entry("new", "2026-01-01"), entry("event", "2026-01-01", { kind: "event" })];
  assert.deepEqual(filterTimelineEntries(entries).map((item) => item.id), ["event", "new", "old", "unknown"]);
  assert.deepEqual(filterTimelineEntries(entries, { oldestFirst: true }).map((item) => item.id), ["old", "event", "new", "unknown"]);
  assert.equal(filterTimelineEntries(entries, { month: "undated" })[0].id, "unknown");
  assert.deepEqual(timelineMonths(entries).map((month) => month.key), ["2026-01", "2025-12", "undated"]);
});

test("搜索词可跨标题、正文尾部、日程时间匹配，兼容全半角", () => {
  const event = entry("a", "2026-09-05", { kind: "event", title: "株式会社テスト · 面接", excerpt: "前言".repeat(500) + " Java ＡＰＩ", time: "14:00" });
  assert.equal(filterTimelineEntries([event], { query: "テスト java api 14:00" }).length, 1);
  assert.equal(filterTimelineEntries([event], { query: "java missing" }).length, 0);
  assert.equal(filterTimelineEntries([event], { query: "java", group: "study" }).length, 0);
  assert.equal(filterTimelineEntries([event], { query: "java", month: "2026-08" }).length, 0);
});

test("回到当下不会被未来日程带走，无当日记录时就近回看过去", () => {
  const dates = ["2026-09-10", "2026-09-05", "2026-09-03"];
  assert.equal(nearestTimelineDate(dates, "2026-09-05"), "2026-09-05");
  assert.equal(nearestTimelineDate(dates, "2026-09-04"), "2026-09-03");
  assert.equal(nearestTimelineDate(["2026-09-10"], "2026-09-05"), "2026-09-10");
  assert.equal(nearestTimelineDate([], "2026-09-05"), "");
});

test("今日取本人当地日期，不取仍在前一天的 UTC 日期", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", "import {localTimelineToday} from './lib/timeline-browser.ts'; process.stdout.write(localTimelineToday(new Date('2026-09-04T22:00:00Z')));"], { env: { ...process.env, TZ: "Asia/Tokyo" }, encoding: "utf8" });
  assert.equal(output, "2026-09-05");
});


test("全文索引保留预览中省略的代码，未知时间排在有时间的日程后面", () => {
  const coded = entry("code", "2026-09-05", { excerpt: "技术记录", searchText: "```ts\nconst retryBudget = 3;\n```" });
  assert.equal(filterTimelineEntries([coded], { query: "retryBudget" }).length, 1);
  const events = [entry("unknown", "2026-09-05", { kind: "event" }), entry("morning", "2026-09-05", { kind: "event", time: "9:00" }), entry("afternoon", "2026-09-05", { kind: "event", time: "14:00" })];
  assert.deepEqual(filterTimelineEntries(events).map((item) => item.id), ["morning", "afternoon", "unknown"]);
});
