import type { ConsultationSessionSummary } from "./consultation-library.ts";

export type ConsultationReadingGroup = {
  id: "recent" | "final" | "examples";
  title: string;
  description: string;
  sessions: ConsultationSessionSummary[];
};

// 每组只给两个真实入口；补充例子由资料显式指定，避免刷新后随机跳动而找不回原稿。
export function selectConsultationReadingGroups(sessions: ConsultationSessionSummary[]): ConsultationReadingGroup[] {
  const seen = new Set<string>();
  const readable = sessions.filter(session => session.hasRaw || session.hasReadable).slice().sort((left, right) =>
    Number(Boolean(right.date)) - Number(Boolean(left.date)) || right.date.localeCompare(left.date) || left.id.localeCompare(right.id),
  ).filter(session => {
    if (seen.has(session.id)) return false;
    seen.add(session.id); return true;
  });
  const recent = readable.slice(0, 2);
  const finals = readable.filter(session => session.stage === "final").slice(0, 2);
  const primary = new Set([...recent, ...finals].map(session => session.id));
  return [
    { id: "recent", title: "最近の面接", description: "最近のやり取りから、今の話し方をご覧いただけます。", sessions: recent },
    { id: "final", title: "最終面接", description: "最終面接での受け答えを、記録からご覧いただけます。", sessions: finals },
    { id: "examples", title: "ほかの面接", description: "別の企業・場面での話し方も見たいときに。", sessions: readable.filter(session => !primary.has(session.id) && (session.readingGuide?.example || session.readingGuide?.featured)).slice(0, 2) },
  ].filter(group => group.sessions.length > 0) as ConsultationReadingGroup[];
}
