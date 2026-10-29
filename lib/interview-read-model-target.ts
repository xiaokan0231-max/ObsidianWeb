import type { CalendarInterviewTarget } from "./calendar-interview.ts";
import type { CalendarSnapshot } from "./calendar-snapshot.ts";
import { interviewRound } from "./interview-round.ts";

/** 只恢复日历已生成的明确场次关联；目录是否加载、URL 是否带 prep 都不代表资料缺失。 */
export function resolveIndexedInterviewTarget(requested: CalendarInterviewTarget, entries: CalendarSnapshot["events"]): CalendarInterviewTarget {
  const expectedRound = interviewRound(requested.label);
  const candidates = entries.filter(({ event }) => {
    if (event.note.path !== requested.sourcePath || event.date !== requested.date) return false;
    if (requested.caseId && event.caseId && requested.caseId !== event.caseId) return false;
    if (requested.time && event.time && requested.time !== event.time) return false;
    const round = interviewRound(event.label);
    return !round || !expectedRound || round === expectedRound;
  });
  const targets = candidates.map((entry) => entry.destinations[requested.view]);
  if (!targets.length || targets.some((target) => !target)) return { ...requested, path: null };
  const distinct = new Map(targets.map((target) => [JSON.stringify([
    target!.path, target!.sourcePath, target!.date, target!.time ?? "", target!.caseId, interviewRound(target!.label),
  ]), target!]));
  return distinct.size === 1 ? [...distinct.values()][0] : { ...requested, path: null };
}
