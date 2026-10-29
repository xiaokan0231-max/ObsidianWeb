import { buildCalendarCompanyRatings } from "../calendar-company-rating.ts";
import { buildCalendarEventOrigins } from "../calendar-event-origin.ts";
import { resolveCalendarInterview, resolveCalendarInterviewDestinations } from "../calendar-interview.ts";
import { calendarInterviewScore } from "../calendar-interview-score.ts";
import { calendarProgress } from "../calendar-progress.ts";
import type { CalendarSnapshot } from "../calendar-snapshot.ts";
import { buildCompanyOverviews } from "../company-overview.ts";
import { jobPosition } from "../jobs.ts";
import { buildCalendarEvents, type CalendarEvent } from "../memory-atlas-data.ts";
import { selectionCaseCount } from "../nav-badges.ts";
import { getTitle, getType, type Note } from "../notes.ts";

const FIELDS = [
  "type", "company", "case_id", "status", "next_action", "round", "action", "audience",
  "applied_on", "application_actor", "application_agent", "formal_application_status", "waiting_for",
  "action_owner", "action_kind", "action_next_owner", "action_reviewed_at", "action_reason", "action_source",
  "due", "due_text", "expires_at", "focus", "focus_until", "suggested_due", "action_resolved_at",
  "action_resolution", "action_resolution_note",
] as const;

function calendarReference(note: Note): Note {
  return {
    path: note.path, stat: note.stat, tags: [],
    frontmatter: Object.fromEntries(FIELDS.filter((key) => key in note.frontmatter).map((key) => [key, note.frontmatter[key]])),
    content: `# ${getTitle(note)}`,
  };
}

/** 在服务端/发布时完成全文关联与评分解析，日历访客只下载已经算好的显示字段。 */
export function buildCalendarSnapshot(notes: Note[]): CalendarSnapshot {
  const events = buildCalendarEvents(notes);
  const upcoming = events.map((event) => ({ ...event, phase: "upcoming" as const }));
  const past = events.map((event) => ({ ...event, phase: "past" as const }));
  const targets = (items: CalendarEvent[]) => new Map(items.flatMap((event) => {
    const target = resolveCalendarInterview(event, notes);
    return target ? [[event.id, target] as const] : [];
  }));
  const upcomingTargets = targets(upcoming);
  const pastTargets = targets(past);
  // 两种日期阶段共用同一份公司事实，避免完整解析画像、来源及评价两遍。
  const companyContexts = buildCompanyOverviews(notes);
  const upcomingRatings = buildCalendarCompanyRatings(upcoming, notes, upcomingTargets, companyContexts);
  const pastRatings = buildCalendarCompanyRatings(past, notes, pastTargets, companyContexts);
  const origins = buildCalendarEventOrigins(events, notes);
  const phaseData = (event: CalendarEvent, phase: "upcoming" | "past") => {
    const target = (phase === "past" ? pastTargets : upcomingTargets).get(event.id);
    return {
      target: target ?? null,
      progress: calendarProgress(event, notes, target),
      score: calendarInterviewScore(event, target, notes),
      rating: (phase === "past" ? pastRatings : upcomingRatings).get(event.id) ?? null,
    };
  };
  return {
    schemaVersion: 1,
    events: events.map((event, index) => ({
      event: { ...event, note: calendarReference(event.note) },
      upcoming: phaseData(upcoming[index], "upcoming"),
      past: phaseData(past[index], "past"),
      destinations: resolveCalendarInterviewDestinations(event, notes),
      origin: origins.get(event.id)!,
    })),
    applicationNotes: notes.filter((note) => ["job-case", "todo"].includes(getType(note))).map((note) => {
      const reference = calendarReference(note);
      if (getType(note) === "job-case") reference.frontmatter.position = jobPosition(note);
      return reference;
    }),
    selectionCount: selectionCaseCount(notes),
  };
}
