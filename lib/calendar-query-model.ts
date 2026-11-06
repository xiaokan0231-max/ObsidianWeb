import { buildCalendarSnapshot } from "./server/calendar-snapshot.ts";
import type { CalendarSnapshot } from "./calendar-snapshot.ts";
import { calendarPulseSource, rollCalendarPulse } from "./calendar-pulse-summary.ts";
import { tokyoParts } from "./dojo/utils.ts";
import type { ReadModelRecord } from "./read-model.ts";
import type { Note } from "./notes.ts";
import type { AiApplicationDay } from "./calendar-applications.ts";

export type CalendarDaySummary = Pick<AiApplicationDay, "date" | "companyCount" | "positionCount" | "bucketCounts">;
export type CalendarCatalog = { today: string; dates: string[]; events: { id: string; date: string; time: string; live: boolean; occurred: boolean; historical: boolean }[]; applicationDays: CalendarDaySummary[]; selectionCount: number };

/** 范围查询按日期定位，投递详情另存；日历首屏不能携带全部申请正本。 */
export function buildCalendarReadModelRecords(notes: Note[], today = tokyoParts().date): ReadModelRecord[] {
  const snapshot = buildCalendarSnapshot(notes);
  const pulseSource = calendarPulseSource(snapshot), pulse = rollCalendarPulse(pulseSource, today);
  const dates = [...new Set(pulse.events.map((event) => event.date))].sort();
  const records: ReadModelRecord[] = [
    { kind: "calendar-source", key: "root", value: snapshot },
    { kind: "calendar-pulse-source", key: "root", value: pulseSource },
    { kind: "calendar-catalog", key: "root", value: { today, dates,
      events: pulse.events,
      applicationDays: pulse.applicationDays.map(({ date, companyCount, positionCount, bucketCounts }) => ({ date, companyCount, positionCount, bucketCounts })),
      selectionCount: snapshot.selectionCount } satisfies CalendarCatalog },
  ];
  for (const date of dates) records.push({ kind: "calendar-day", key: date, value: snapshot.events.filter(({ event }) => event.date === date) });
  for (const day of pulse.applicationDays) records.push({ kind: "calendar-applications", key: day.date, value: day });
  for (const summary of pulse.summaries) records.push({ kind: "calendar-pulse", key: summary.month || "default", value: summary });
  return records;
}

export type CalendarRangePage = { syncState?: "ready" | "building" | "failed"; revision: string; today: string; snapshot: CalendarSnapshot; applicationDays: CalendarDaySummary[]; historicalTotal: number; summary: import("./calendar-pulse-summary.ts").CalendarPulseSummary };
