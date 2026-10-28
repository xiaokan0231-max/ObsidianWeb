import type { ConsultationSessionSummary } from "./consultation-library.ts";

// 只有最新的实际原稿和本人明确指定的重点进入起点区，不按录用结果替本人决定关注点。
export function selectConsultationReadingStarts(sessions: ConsultationSessionSummary[]): ConsultationSessionSummary[] {
  const seen = new Set<string>();
  const readable = sessions.filter(session => session.hasRaw || session.hasReadable).slice().sort((left, right) =>
    Number(Boolean(right.date)) - Number(Boolean(left.date)) || right.date.localeCompare(left.date) || left.id.localeCompare(right.id),
  ).filter(session => {
    if (seen.has(session.id)) return false;
    seen.add(session.id); return true;
  });
  if (!readable.length) return [];
  const latest = readable[0];
  return [latest, ...readable.filter(session => session.id !== latest.id && session.readingGuide?.featured === true).slice(0, 2)];
}
