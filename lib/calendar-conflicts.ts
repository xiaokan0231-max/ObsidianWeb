import type { CalendarEvent } from "./memory-atlas-data.ts";

/** 没写结束时刻的场次按一小时估算：面试通知里最常见的时长，也足够让紧挨着的两场被提醒。 */
export const DEFAULT_EVENT_MINUTES = 60;

function minutesOf(time: string | undefined) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time ?? "");
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * 同一天里时间段重叠的场次 id。
 *
 * 只比有开始时刻的场次：没写时刻的不知道落在哪，硬算会把整天都标成冲突。
 * 和所有更早开始、尚未结束的场次比，而不只是相邻的上一场——一场长会可能盖住后面好几场。
 */
export function calendarConflicts(
  events: ReadonlyArray<Pick<CalendarEvent, "id" | "date" | "time" | "endTime">>,
  defaultMinutes = DEFAULT_EVENT_MINUTES,
): Set<string> {
  const byDate = new Map<string, { id: string; start: number; end: number }[]>();
  for (const event of events) {
    const start = minutesOf(event.time);
    if (start === null) continue;
    const declaredEnd = minutesOf(event.endTime);
    const end = declaredEnd !== null && declaredEnd > start ? declaredEnd : start + defaultMinutes;
    byDate.set(event.date, [...(byDate.get(event.date) ?? []), { id: event.id, start, end }]);
  }
  const conflicts = new Set<string>();
  for (const slots of byDate.values()) {
    slots.sort((left, right) => left.start - right.start || left.end - right.end);
    slots.forEach((slot, index) => {
      for (const earlier of slots.slice(0, index)) {
        if (slot.start < earlier.end) {
          conflicts.add(slot.id);
          conflicts.add(earlier.id);
        }
      }
    });
  }
  return conflicts;
}
