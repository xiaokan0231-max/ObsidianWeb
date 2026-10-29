import { summarizeAiApplicationDays, type AiApplicationBucket } from "./calendar-applications.ts";
import { calendarModelFromSnapshot, type CalendarModel, type CalendarSnapshot } from "./calendar-snapshot.ts";
import { buildCalendarSummary } from "./calendar-summary.ts";

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

function globalCounts(model: CalendarModel, today: string) {
  const summary = buildCalendarSummary({ ...model, today });
  return {
    waitingCount: summary.waitingCount,
    historicalCount: summary.historicalCount,
    historicalTotal: model.events.filter((event) => event.phase === "past" || model.progressByEvent.get(event.id)?.occurred).length,
  };
}

/** 首屏数字与完整日历沿用同一去重及状态口径，不能用逐日公司数相加代替月度去重。 */
export function buildCalendarPulseSummary(snapshot: CalendarSnapshot, today: string, month: string): CalendarPulseSummary {
  const model = calendarModelFromSnapshot(snapshot, today);
  return { today, month, applications: summarizeAiApplicationDays(model.applicationDays, month), ...globalCounts(model, today) };
}

/** 空月份行保存全局计数，让没有申请活动的月份也能只读一条小汇总返回零。 */
export function buildCalendarPulseSummaries(snapshot: CalendarSnapshot, today: string): CalendarPulseSummary[] {
  const model = calendarModelFromSnapshot(snapshot, today);
  const counts = globalCounts(model, today);
  const months = ["", ...new Set(model.applicationDays.map((day) => day.date.slice(0, 7)))].sort();
  return months.map((month) => ({ today, month, applications: summarizeAiApplicationDays(model.applicationDays, month), ...counts }));
}
