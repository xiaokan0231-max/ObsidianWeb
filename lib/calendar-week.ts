import { DEFAULT_EVENT_MINUTES } from "./calendar-conflicts.ts";
import { shiftCalendarDay } from "./calendar-summary.ts";
import type { CalendarEvent } from "./memory-atlas-data.ts";

/*
 * 日历周视图的版面计算。
 *
 * 为什么全部按「JST 日期字符串 + 当日分钟数」算：日程在 vault 里本来就是日本时间，
 * 一旦经 new Date(字符串) 按本机时区解析，在上海打开就会整体错一小时。
 * 日期加减走 UTC 午夜（shiftCalendarDay），分钟数直接从 "HH:MM" 拆，不碰本机时区。
 */

/** 当周没有带时刻的场次时显示的时段：09:00–18:00。 */
export const WEEK_DEFAULT_START_MINUTES = 9 * 60;
export const WEEK_DEFAULT_END_MINUTES = 18 * 60;
/** 有场次时刻度至少这么长：一场面试不能把网格压成一条，翻周时刻度也不至于忽长忽短。 */
export const WEEK_MIN_SPAN_MINUTES = 8 * 60;
const DAY_MINUTES = 24 * 60;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function clockMinutes(time: string | undefined): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 某个 JST 日期所在周的周一（与月格一样周一开头）。读不出日期时原样返回。 */
export function calendarWeekStart(date: string): string {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) return date;
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  return shiftCalendarDay(date, -weekday);
}

export function calendarWeekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftCalendarDay(start, index));
}

/**
 * 周视图里按 ← / → 后应选中的日子。
 *
 * 选中日就在这一周里时逐日移动，越过周一／周日自然落到相邻周（调用方按结果翻周）。
 * 还没选中、或选中日在别的周（用 [ ] 翻过来的）时，第一下先落到起点，让选中框先出现再开始走：
 * 今天在这一周就是今天，否则往后走从周一、往前走从周日开始，不会一按就跳出当前看着的这一周。
 */
export function stepWeekSelection(weekStart: string, selectedDay: string, today: string, step: number): string {
  const days = calendarWeekDays(weekStart);
  if (!days.includes(selectedDay)) {
    if (days.includes(today)) return today;
    return step < 0 ? days[6] : days[0];
  }
  return shiftCalendarDay(selectedDay, step < 0 ? -1 : 1);
}

/** 场次的开始／结束分钟。没写结束或结束不晚于开始时按默认时长；跨过午夜的截在当天末尾。 */
export function eventSpan(event: Pick<CalendarEvent, "time" | "endTime">, defaultMinutes = DEFAULT_EVENT_MINUTES) {
  const start = clockMinutes(event.time);
  if (start === null) return null;
  const declaredEnd = clockMinutes(event.endTime);
  const end = declaredEnd !== null && declaredEnd > start ? declaredEnd : start + defaultMinutes;
  return { start, end: Math.min(end, DAY_MINUTES) };
}

/**
 * 时间刻度范围（整点）。只画当周场次覆盖的时段、首尾各留一小时，至少 WEEK_MIN_SPAN_MINUTES；
 * 一周三四场面试却画满 08:00–21:00，大半是空格子（本人不要大片空白）。
 * 没有带时刻的场次时用默认时段。
 */
export function calendarWeekHourRange(
  events: ReadonlyArray<Pick<CalendarEvent, "time" | "endTime">>,
  { start = WEEK_DEFAULT_START_MINUTES, end = WEEK_DEFAULT_END_MINUTES } = {},
) {
  let from = Infinity;
  let to = -Infinity;
  for (const event of events) {
    const span = eventSpan(event);
    if (!span) continue;
    from = Math.min(from, Math.floor(span.start / 60) * 60);
    to = Math.max(to, Math.ceil(span.end / 60) * 60);
  }
  if (!Number.isFinite(from)) return { start, end };
  from = Math.max(0, from - 60);
  to = Math.min(DAY_MINUTES, to + 60);
  if (to - from < WEEK_MIN_SPAN_MINUTES) {
    // 先往后补（下午场次更常见），到了午夜再往前补。
    to = Math.min(DAY_MINUTES, from + WEEK_MIN_SPAN_MINUTES);
    from = Math.max(0, to - WEEK_MIN_SPAN_MINUTES);
  }
  return { start: from, end: to };
}

export type WeekBlock<T> = {
  event: T;
  start: number;
  end: number;
  /** 0 起的列号，与 columns 一起决定横向位置。 */
  column: number;
  /** 这一簇互相（含传递）重叠的场次共分几列；同簇的块等宽，读起来是一组。 */
  columns: number;
};

/**
 * 同一天里重叠场次的并排分栏。
 *
 * 按开始时刻排序后贪心放进第一条已空出的列；只要还有块没结束就属于同一簇，
 * 簇结束时整簇共用最大列数。这样不重叠的场次始终占满整列宽，不会被别处的撞期挤窄。
 * 没有具体时刻的场次不在这里（它们进「全天」行）。
 */
export function layoutWeekDay<T extends Pick<CalendarEvent, "id" | "time" | "endTime">>(
  events: readonly T[],
  defaultMinutes = DEFAULT_EVENT_MINUTES,
): WeekBlock<T>[] {
  const timed = events
    .map((event) => ({ event, span: eventSpan(event, defaultMinutes) }))
    .filter((item): item is { event: T; span: { start: number; end: number } } => item.span !== null)
    .sort((left, right) => left.span.start - right.span.start || right.span.end - left.span.end
      || left.event.id.localeCompare(right.event.id));
  const blocks: WeekBlock<T>[] = [];
  let cluster: WeekBlock<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;
  const closeCluster = () => {
    for (const block of cluster) block.columns = columnEnds.length;
    cluster = [];
    columnEnds = [];
  };
  for (const { event, span } of timed) {
    if (span.start >= clusterEnd) closeCluster();
    let column = columnEnds.findIndex((end) => end <= span.start);
    if (column < 0) column = columnEnds.length;
    columnEnds[column] = span.end;
    const block = { event, start: span.start, end: span.end, column, columns: 1 };
    cluster.push(block);
    blocks.push(block);
    clusterEnd = Math.max(clusterEnd, span.end);
  }
  closeCluster();
  return blocks;
}

/** 当周每天的时间块与「全天」项。没有具体时刻的不硬塞进时间轴，免得被误读成某个时段被占用。 */
export function buildCalendarWeek<T extends Pick<CalendarEvent, "id" | "date" | "time" | "endTime">>(
  start: string,
  events: readonly T[],
) {
  const days = calendarWeekDays(start);
  const inWeek = events.filter((event) => days.includes(event.date));
  return {
    days: days.map((date) => {
      const dayEvents = inWeek.filter((event) => event.date === date);
      return {
        date,
        blocks: layoutWeekDay(dayEvents),
        allDay: dayEvents.filter((event) => clockMinutes(event.time) === null),
      };
    }),
    range: calendarWeekHourRange(inWeek),
  };
}

/** 某一时刻在日本时间的日期与当日分钟数。只给挂载后的实时刻度线用，渲染期不要调用。 */
export function jstClock(epochMs: number) {
  const shifted = new Date(epochMs + JST_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** 「10月5日 – 11日」；跨月写出后一个月，跨年两头都带年份。中日两种界面的写法相同。 */
export function calendarWeekRangeLabel(start: string, currentYear: string) {
  const end = shiftCalendarDay(start, 6);
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  if (startYear !== endYear) return `${startYear}年${startMonth}月${startDay}日 – ${endYear}年${endMonth}月${endDay}日`;
  const year = String(startYear) === currentYear ? "" : `${startYear}年`;
  return `${year}${startMonth}月${startDay}日 – ${startMonth === endMonth ? "" : `${endMonth}月`}${endDay}日`;
}

export function minutesLabel(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
