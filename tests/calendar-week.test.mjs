import assert from "node:assert/strict";
import test from "node:test";
import { calendarConflicts } from "../lib/calendar-conflicts.ts";
import {
  buildCalendarWeek,
  calendarWeekDays,
  calendarWeekHourRange,
  calendarWeekRangeLabel,
  calendarWeekStart,
  eventSpan,
  jstClock,
  layoutWeekDay,
  minutesLabel,
  stepWeekSelection,
} from "../lib/calendar-week.ts";

const slot = (id, time, endTime, date = "2026-08-12") => ({ id, date, time, ...(endTime ? { endTime } : {}) });

test("周从周一开始，跨月跨年都按 JST 日期字符串推算", () => {
  assert.equal(calendarWeekStart("2026-10-05"), "2026-10-05");
  assert.equal(calendarWeekStart("2026-10-04"), "2026-09-28", "周日归到前一个周一");
  assert.equal(calendarWeekStart("2027-01-01"), "2026-12-28");
  assert.equal(calendarWeekStart("不是日期"), "不是日期");
  assert.deepEqual(calendarWeekDays("2026-12-28"), [
    "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
  ]);
});

test("没有结束时刻或结束不晚于开始时按 60 分钟，跨午夜截在当天末尾", () => {
  assert.deepEqual(eventSpan(slot("a", "10:00")), { start: 600, end: 660 });
  assert.deepEqual(eventSpan(slot("b", "10:00", "10:30")), { start: 600, end: 630 });
  assert.deepEqual(eventSpan(slot("c", "10:00", "09:00")), { start: 600, end: 660 });
  assert.deepEqual(eventSpan(slot("d", "23:30")), { start: 1410, end: 1440 });
  assert.equal(eventSpan(slot("e", "")), null);
  assert.equal(eventSpan(slot("f", "25:00")), null);
});

test("刻度只盖住当周场次、首尾各留一小时，至少 8 小时；没有带时刻的场次时用 09:00–18:00", () => {
  assert.deepEqual(calendarWeekHourRange([]), { start: 540, end: 1080 });
  assert.deepEqual(calendarWeekHourRange([slot("b", "")]), { start: 540, end: 1080 });
  // 10:00–11:00 → 09:00–12:00 不足 8 小时，往后补到 17:00。
  assert.deepEqual(calendarWeekHourRange([slot("a", "10:00"), slot("b", "")]), { start: 540, end: 1020 });
  assert.deepEqual(calendarWeekHourRange([slot("a", "07:30")]), { start: 360, end: 840 });
  // 晚场往后补到午夜就补不动了，改往前补。
  assert.deepEqual(calendarWeekHourRange([slot("a", "21:30", "22:15")]), { start: 960, end: 1440 });
  assert.deepEqual(calendarWeekHourRange([slot("a", "23:30")]), { start: 960, end: 1440 });
  // 跨度本来就够长时只留首尾各一小时。
  assert.deepEqual(calendarWeekHourRange([slot("a", "08:00"), slot("b", "19:00", "20:00")]), { start: 420, end: 1260 });
});

test("重叠的场次并排分栏，不重叠的仍占整列", () => {
  const blocks = layoutWeekDay([slot("c", "13:00"), slot("b", "10:30"), slot("a", "10:00", "11:00"), slot("x", "")]);
  const byId = Object.fromEntries(blocks.map((block) => [block.event.id, [block.column, block.columns]]));
  assert.deepEqual(byId, { a: [0, 2], b: [1, 2], c: [0, 1] });
  assert.equal(blocks.length, 3, "没有时刻的不进时间轴");
});

test("传递重叠的一簇共用列数，空出来的列被后面的场次复用", () => {
  const blocks = layoutWeekDay([slot("a", "10:00", "12:00"), slot("b", "10:30", "11:00"), slot("c", "11:00", "11:30")]);
  const byId = Object.fromEntries(blocks.map((block) => [block.event.id, [block.column, block.columns]]));
  assert.deepEqual(byId, { a: [0, 2], b: [1, 2], c: [1, 2] });
  // 只是首尾相接（11:00 结束、11:00 开始）不算重叠，和 calendarConflicts 的口径一致。
  const touching = [slot("p", "10:00", "11:00"), slot("q", "11:00")];
  assert.deepEqual(layoutWeekDay(touching).map((block) => block.columns), [1, 1]);
  assert.equal(calendarConflicts(touching).size, 0);
});

test("周数据只收当周 7 天，没有时刻的进全天行", () => {
  const week = buildCalendarWeek("2026-08-10", [
    slot("in", "10:00", "", "2026-08-12"),
    slot("allday", "", "", "2026-08-16"),
    slot("out", "09:00", "", "2026-08-17"),
    slot("early", "06:45", "", "2026-08-09"),
  ]);
  assert.deepEqual(week.days.map((day) => day.date), calendarWeekDays("2026-08-10"));
  assert.deepEqual(week.days[2].blocks.map((block) => block.event.id), ["in"]);
  assert.deepEqual(week.days[6].allDay.map((event) => event.id), ["allday"]);
  assert.equal(week.days.flatMap((day) => day.blocks).length, 1);
  // 只按本周的 10:00 场次定刻度：09:00 起补足 8 小时；别周 06:45 的早场不把刻度拉到 05:00。
  assert.deepEqual(week.range, { start: 540, end: 1020 }, "别周的早场不扩本周刻度");
});

test("当前时刻按日本时间换算，不受本机时区影响", () => {
  assert.deepEqual(jstClock(Date.parse("2026-10-04T15:30:00Z")), { date: "2026-10-05", minutes: 30 });
  assert.deepEqual(jstClock(Date.parse("2026-10-05T01:05:00Z")), { date: "2026-10-05", minutes: 605 });
  assert.equal(minutesLabel(420), "07:00");
  assert.equal(minutesLabel(1260), "21:00");
});

test("周标题：同月只写一次月份，跨月写出后一个月，跨年或非本年带年份", () => {
  assert.equal(calendarWeekRangeLabel("2026-10-05", "2026"), "10月5日 – 11日");
  assert.equal(calendarWeekRangeLabel("2026-09-28", "2026"), "9月28日 – 10月4日");
  assert.equal(calendarWeekRangeLabel("2026-12-28", "2026"), "2026年12月28日 – 2027年1月3日");
  assert.equal(calendarWeekRangeLabel("2025-10-06", "2026"), "2025年10月6日 – 12日");
});

test("周视图方向键：周内逐日移动，越过周一／周日落到相邻周", () => {
  // 2026-08-10（周一）– 16（周日）这一周。
  assert.equal(stepWeekSelection("2026-08-10", "2026-08-12", "2026-08-12", 1), "2026-08-13");
  assert.equal(stepWeekSelection("2026-08-10", "2026-08-12", "2026-08-12", -1), "2026-08-11");
  assert.equal(stepWeekSelection("2026-08-10", "2026-08-16", "2026-08-12", 1), "2026-08-17", "周日往后是下周一");
  assert.equal(stepWeekSelection("2026-08-10", "2026-08-10", "2026-08-12", -1), "2026-08-09", "周一往前是上周日");
  assert.equal(calendarWeekStart(stepWeekSelection("2026-08-10", "2026-08-16", "", 1)), "2026-08-17", "调用方据此翻到下一周");
  assert.equal(stepWeekSelection("2026-12-28", "2027-01-03", "", 1), "2027-01-04", "跨年照常");
});

test("周视图方向键：还没选中或选中日在别周时，先落到起点", () => {
  assert.equal(stepWeekSelection("2026-08-10", "", "2026-08-12", 1), "2026-08-12", "今天在这周：先选中今天");
  assert.equal(stepWeekSelection("2026-08-10", "", "2026-08-12", -1), "2026-08-12");
  assert.equal(stepWeekSelection("2026-08-17", "", "2026-08-12", 1), "2026-08-17", "今天不在这周：往后从周一开始");
  assert.equal(stepWeekSelection("2026-08-17", "", "2026-08-12", -1), "2026-08-23", "往前从周日开始");
  assert.equal(stepWeekSelection("2026-08-17", "2026-08-12", "2026-08-12", 1), "2026-08-17", "选中日在别周（[ ] 翻过来的）不跳回去");
});
