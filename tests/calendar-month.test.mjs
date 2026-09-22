import assert from "node:assert/strict";
import test from "node:test";
import { calendarMonthDays } from "../lib/calendar-month.ts";

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

for (const [year, monthIndex, weeks] of [[2021, 1, 4], [2026, 8, 5], [2026, 2, 6], [2024, 1, 5]]) {
  test(`${year}-${monthIndex + 1} uses ${weeks} complete weeks and includes each month day exactly once`, () => {
    const days = calendarMonthDays(new Date(year, monthIndex, 15));
    assert.equal(days.length, weeks * 7);
    assert.equal(days[0].getDay(), 1);
    assert.equal(days.at(-1).getDay(), 0);
    assert.equal(new Set(days.map(dateKey)).size, days.length);
    assert.deepEqual(
      days.filter((day) => day.getMonth() === monthIndex).map((day) => day.getDate()),
      Array.from({ length: new Date(year, monthIndex + 1, 0).getDate() }, (_, index) => index + 1),
    );
  });
}

test("December and January retain adjacent dates across the year boundary", () => {
  const december = calendarMonthDays(new Date(2026, 11, 1));
  const january = calendarMonthDays(new Date(2027, 0, 1));
  assert.equal(dateKey(december.at(-1)), "2027-01-03");
  assert.equal(dateKey(january[0]), "2026-12-28");
  assert.deepEqual(december.slice(-7).map(dateKey), january.slice(0, 7).map(dateKey));
});
