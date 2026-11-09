import { buildAiApplicationDays, summarizeAiApplicationDays, type AiApplicationBucket } from "./calendar-applications.ts";
import type { CalendarSnapshot } from "./calendar-snapshot.ts";
import { calendarProgressCounts, isCalendarLiveEvent } from "./calendar-summary.ts";
import { isCalendarHistoricalProgress, type CalendarProgress } from "./calendar-progress.ts";
import type { CalendarEvent } from "./memory-atlas-data.ts";

export type CalendarPulseSummary = {
  today: string;
  month: string;
  applications: {
    companyCount: number;
    positionCount: number;
    bucketCounts: Record<AiApplicationBucket, number>;
  };
  waitingCount: number;
  historicalCount: number;
  historicalTotal: number;
};

type PulseProgress = Pick<CalendarProgress, "tone" | "code" | "ownerKey" | "occurred">;
export type CalendarPulseSource = Pick<CalendarSnapshot, "applicationNotes"> & {
  events: (Pick<CalendarEvent, "id" | "date" | "time" | "caseId" | "tentative"> & Record<"upcoming" | "past", PulseProgress>)[];
};

export function calendarPulseSource(snapshot: CalendarSnapshot): CalendarPulseSource {
  const progress = ({ tone, code, ownerKey, occurred }: CalendarProgress): PulseProgress => ({ tone, code, ownerKey, occurred });
  return { applicationNotes: snapshot.applicationNotes, events: snapshot.events.map(({ event, upcoming, past }) => ({
    id: event.id, date: event.date, time: event.time, caseId: event.caseId,
    ...(event.tentative ? { tentative: event.tentative } : {}),
    upcoming: progress(upcoming.progress), past: progress(past.progress),
  })) };
}

function pulseDay(source: CalendarPulseSource, today: string) {
  const progressByEvent = new Map<string, PulseProgress>();
  const events = source.events.map(({ id, date, time, tentative, upcoming, past }) => {
    const phase = date < today ? "past" : "upcoming";
    const progress = phase === "past" ? past : upcoming;
    progressByEvent.set(id, progress);
    return { id, date, time, live: isCalendarLiveEvent({ date, phase, tentative }, progress, today),
      occurred: !tentative && (phase === "past" || progress.occurred), historical: !tentative && isCalendarHistoricalProgress(progress) };
  });
  const applicationDays = buildAiApplicationDays(source.applicationNotes, today);
  const { waitingCount, historicalCount } = calendarProgressCounts(source.events, progressByEvent);
  const historicalTotal = events.filter((event) => event.occurred).length;
  const summary = (month: string): CalendarPulseSummary => ({
    today, month, applications: summarizeAiApplicationDays(applicationDays, month),
    waitingCount, historicalCount, historicalTotal,
  });
  return { events, applicationDays, summary };
}

export function rollCalendarPulse(source: CalendarPulseSource, today: string) {
  const { events, applicationDays, summary } = pulseDay(source, today);
  const months = ["", ...new Set(applicationDays.map((day) => day.date.slice(0, 7)))].sort();
  return { events, applicationDays, summaries: months.map(summary) };
}

/** 首屏数字与完整日历沿用同一去重及状态口径，不能用逐日公司数相加代替月度去重。 */
export function buildCalendarPulseSummary(snapshot: CalendarSnapshot, today: string, month: string): CalendarPulseSummary {
  return pulseDay(calendarPulseSource(snapshot), today).summary(month);
}

/** 空月份行保存全局计数，让没有申请活动的月份也能只读一条小汇总返回零。 */
export function buildCalendarPulseSummaries(snapshot: CalendarSnapshot, today: string): CalendarPulseSummary[] {
  return rollCalendarPulse(calendarPulseSource(snapshot), today).summaries;
}
