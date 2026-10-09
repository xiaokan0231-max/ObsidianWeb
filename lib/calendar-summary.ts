import type { AiApplicationDay } from "./calendar-applications.ts";
import { isCalendarHistoricalProgress, type CalendarProgress } from "./calendar-progress.ts";
import { queueCompanyKey } from "./job-queue.mjs";
import type { CalendarEvent } from "./memory-atlas-data.ts";

/** 两个 JST 日期字符串相差几天。按 UTC 午夜算，不受浏览器时区和夏令时影响。 */
export function calendarDayOffset(from: string, to: string) {
  const left = Date.parse(`${from}T00:00:00Z`);
  const right = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.round((right - left) / 86400000);
}

export function shiftCalendarDay(date: string, days: number) {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) return date;
  return new Date(time + days * 86400000).toISOString().slice(0, 10);
}

export type CalendarSummary = {
  /** 今天起 7 天内（含今天）仍在推进的场次。 */
  weekCount: number;
  next: { event: CalendarEvent; days: number } | null;
  /** 日程已过、仍在等对方回复的案件数（同一案件多场只算一次）。 */
  waitingCount: number;
  /** 明确关联冲突的场次数；同一 event.id 只算一次，不把资料缺项当异常。 */
  unknownCount: number;
  /** 全部历史中需说明当轮结果或关联范围的场次，包含已记载当轮不通过。 */
  historicalCount: number;
  monthAiCompanies: number;
};

type SummaryProgress = Pick<CalendarProgress, "tone"> & Partial<Pick<CalendarProgress, "code" | "ownerKey" | "occurred">>;

/**
 * 「下一场」「未来 7 天」和顶栏「最近安排」共用的口径：只留仍会进行的确约。
 * 同一天的场次可能已面完（已有整理稿或准备稿已完成），phase 仍是 upcoming——它已计入等回复与最近记录，
 * 不能同时再当下一场；历史通过和拒信之后残留的旧预约也不是要去的面试。
 */
export function isCalendarLiveEvent(event: CalendarEvent, progress: SummaryProgress | undefined, today: string) {
  return event.phase === "upcoming" && event.date >= today && !progress?.occurred && progress?.tone !== "closed"
    && !(progress?.code && isCalendarHistoricalProgress({ code: progress.code }));
}

/**
 * 日历首屏的态势数字。
 *
 * 日历只拿到 actions scope（job-case 全量、todo、面试资料），所以这里只用日程、进展和
 * AI 代投三样——它们在冷启动和全量加载后都一样，数字不会在读完全部资料后跳变。
 * 已记录不採用的场次不算「下一场」「未来 7 天」：拒信之后残留的旧预约不是要去的面试。
 */
export function buildCalendarSummary({ events, progressByEvent, applicationDays, today }: {
  events: readonly CalendarEvent[];
  progressByEvent: ReadonlyMap<string, SummaryProgress>;
  applicationDays: readonly AiApplicationDay[];
  today: string;
}): CalendarSummary {
  const horizon = shiftCalendarDay(today, 6);
  const live = [...events]
    .filter((event) => isCalendarLiveEvent(event, progressByEvent.get(event.id), today))
    .sort((left, right) => left.date.localeCompare(right.date) || left.time.localeCompare(right.time) || left.id.localeCompare(right.id));
  const first = live[0];
  const waiting = new Set<string>();
  const unknown = new Set<string>();
  const historical = new Set<string>();
  for (const event of events) {
    const progress = progressByEvent.get(event.id);
    if (progress?.tone === "waiting") waiting.add(progress.ownerKey || (event.caseId ? `case:${event.caseId}` : `event:${event.id}`));
    if (progress?.code === "association-conflict") unknown.add(event.id);
    if (progress?.code && isCalendarHistoricalProgress({ code: progress.code })) historical.add(event.id);
  }
  const month = today.slice(0, 7);
  const companies = new Set(applicationDays
    .filter((day) => day.date.startsWith(month) && day.date <= today)
    .flatMap((day) => day.applications.map((application) => queueCompanyKey(application.company))));
  return {
    weekCount: live.filter((event) => event.date <= horizon).length,
    next: first ? { event: first, days: calendarDayOffset(today, first.date) ?? 0 } : null,
    waitingCount: waiting.size,
    unknownCount: unknown.size,
    historicalCount: historical.size,
    monthAiCompanies: companies.size,
  };
}
