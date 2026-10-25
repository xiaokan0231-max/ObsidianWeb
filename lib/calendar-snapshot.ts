import { buildAiApplicationDays } from "./calendar-applications.ts";
import type { CalendarCompanyRating } from "./calendar-company-rating.ts";
import type { CalendarEventOrigin } from "./calendar-event-origin.ts";
import type { CalendarInterviewDestinations, CalendarInterviewTarget } from "./calendar-interview.ts";
import type { CalendarInterviewScore } from "./calendar-interview-score.ts";
import type { CalendarProgress } from "./calendar-progress.ts";
import type { CalendarEvent } from "./memory-atlas-data.ts";
import type { Note } from "./notes.ts";

export type CalendarPhaseData = {
  target: CalendarInterviewTarget | null;
  progress: CalendarProgress;
  score: CalendarInterviewScore | null;
  rating: CalendarCompanyRating | null;
};

export type CalendarSnapshot = {
  schemaVersion: 1;
  events: {
    event: CalendarEvent;
    upcoming: CalendarPhaseData;
    past: CalendarPhaseData;
    destinations: CalendarInterviewDestinations;
    origin: CalendarEventOrigin;
  }[];
  // 仅保留申请分桶需要的字段和标题；完整正文通过单篇接口按需读取。
  applicationNotes: Note[];
  selectionCount: number;
};

/** 静态副本也必须随 JST 跨日更新，不能把发布当天的 upcoming/past 冻结在云端。 */
export function calendarModelFromSnapshot(snapshot: CalendarSnapshot, today: string) {
  const events = snapshot.events.map(({ event }) => ({
    ...event, phase: event.date < today ? "past" as const : "upcoming" as const,
  }));
  const entries = snapshot.events.map((entry, index) => ({
    ...entry, event: events[index], phase: entry[events[index].phase],
  }));
  return {
    events,
    interviewTargets: new Map(entries.flatMap(({ event, phase }) => phase.target ? [[event.id, phase.target] as const] : [])),
    interviewDestinations: new Map(entries.map(({ event, destinations }) => [event.id, destinations])),
    progressByEvent: new Map(entries.map(({ event, phase }) => [event.id, phase.progress])),
    scoreByEvent: new Map(entries.map(({ event, phase }) => [event.id, phase.score])),
    companyRatingByEvent: new Map(entries.flatMap(({ event, phase }) => phase.rating ? [[event.id, phase.rating] as const] : [])),
    originByEvent: new Map(entries.map(({ event, origin }) => [event.id, origin])),
    applicationDays: buildAiApplicationDays(snapshot.applicationNotes, today),
    selectionCount: snapshot.selectionCount,
  };
}

export type CalendarModel = ReturnType<typeof calendarModelFromSnapshot>;
