import { buildCalendarSnapshot } from "./server/calendar-snapshot.ts";
import { calendarModelFromSnapshot, type CalendarSnapshot } from "./calendar-snapshot.ts";
import { buildCalendarPulseSummaries } from "./calendar-pulse-summary.ts";
import { tokyoParts } from "./dojo/utils.ts";
import type { ReadModelRecord } from "./read-model.ts";
import type { Note } from "./notes.ts";
import { isCalendarHistoricalProgress } from "./calendar-progress.ts";
import { isCalendarLiveEvent } from "./calendar-summary.ts";
import type { AiApplicationDay } from "./calendar-applications.ts";

export type CalendarDaySummary = Pick<AiApplicationDay, "date" | "companyCount" | "positionCount" | "bucketCounts">;
export type CalendarCatalog = { today: string; dates: string[]; events: { id: string; date: string; time: string; live: boolean; occurred: boolean; historical: boolean }[]; applicationDays: CalendarDaySummary[]; selectionCount: number };

/** 范围查询按日期定位，投递详情另存；日历首屏不能携带全部申请正本。 */
export function buildCalendarReadModelRecords(notes: Note[], today = tokyoParts().date): ReadModelRecord[] {
  const snapshot = buildCalendarSnapshot(notes);
  const model = calendarModelFromSnapshot(snapshot, today);
  const dates = [...new Set(model.events.map((event) => event.date))].sort();
  const records: ReadModelRecord[] = [
    { kind: "calendar-source", key: "root", value: snapshot },
    { kind: "calendar-catalog", key: "root", value: { today, dates,
      events: model.events.map((event) => { const progress = model.progressByEvent.get(event.id); return { id: event.id, date: event.date, time: event.time, live: isCalendarLiveEvent(event, progress, today), occurred: event.phase === "past" || Boolean(progress?.occurred), historical: Boolean(progress && isCalendarHistoricalProgress(progress)) }; }),
      applicationDays: model.applicationDays.map(({ date, companyCount, positionCount, bucketCounts }) => ({ date, companyCount, positionCount, bucketCounts })),
      selectionCount: snapshot.selectionCount } satisfies CalendarCatalog },
  ];
  for (const date of dates) records.push({ kind: "calendar-day", key: date, value: snapshot.events.filter(({ event }) => event.date === date) });
  for (const day of model.applicationDays) records.push({ kind: "calendar-applications", key: day.date, value: day });
  for (const summary of buildCalendarPulseSummaries(snapshot, today)) records.push({ kind: "calendar-pulse", key: summary.month || "default", value: summary });
  return records;
}

export type CalendarRangePage = { syncState?: "ready" | "building" | "failed"; revision: string; today: string; snapshot: CalendarSnapshot; applicationDays: CalendarDaySummary[]; historicalTotal: number; summary: import("./calendar-pulse-summary.ts").CalendarPulseSummary };
