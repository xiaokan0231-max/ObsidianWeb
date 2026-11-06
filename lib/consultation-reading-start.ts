import type { ConsultationCompany, ConsultationInterview, ConsultationSessionSummary, ConsultationMeetingHistory } from "./consultation-library.ts";
import { shiftCalendarDay } from "./calendar-summary.ts";
import { tokyoParts } from "./dojo/utils.ts";

export type ConsultationReadingHistory = { companyId: string; company: string; interview: ConsultationInterview };

export type ConsultationReadingGroup = {
  id: "recent" | "final";
  title: string;
  description: string;
  sessions: ConsultationSessionSummary[];
  histories: ConsultationReadingHistory[];
  companyGroups?: { companyId: string; company: string; sessions: ConsultationSessionSummary[]; histories: ConsultationReadingHistory[] }[];
};

// 最近按 JST 的十四个自然日收齐场次；终面按企业汇集全部轮次，避免旧资料冒充本周面试。
export function selectConsultationReadingGroups(sessions: ConsultationSessionSummary[], companies: ConsultationCompany[] = [], today = tokyoParts().date, scheduled: ConsultationMeetingHistory[] = []): ConsultationReadingGroup[] {
  const start = shiftCalendarDay(today, -13);
  const inWeek = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= start && date <= today;
  const seen = new Set<string>();
  const readable = sessions.filter(session => session.hasRaw || session.hasReadable).slice().sort((left, right) =>
    Number(Boolean(right.date)) - Number(Boolean(left.date)) || right.date.localeCompare(left.date) || left.id.localeCompare(right.id),
  ).filter(session => {
    if (seen.has(session.id)) return false;
    seen.add(session.id); return true;
  });
  const recent = readable.filter(session => inWeek(session.date)).sort((a, b) =>
    (a.readingGuide?.priority ?? Infinity) - (b.readingGuide?.priority ?? Infinity) || b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const readableIds = new Set(readable.map(session => session.id));
  const recentHistoryIds = new Set<string>();
  const recentHistories: ConsultationReadingHistory[] = [];
  for (const company of companies) {
    for (const interview of company.interviews ?? []) {
      const key = `${company.id}:${interview.id}`;
      if (!inWeek(interview.date) || (interview.sessionId && readableIds.has(interview.sessionId)) || recentHistoryIds.has(key)) continue;
      recentHistoryIds.add(key);
      recentHistories.push({ companyId: company.id, company: company.company, interview });
    }
  }
  for (const history of scheduled) {
    if (inWeek(history.interview.date)) recentHistories.push(history);
  }
  recentHistories.sort((a, b) => b.interview.date.localeCompare(a.interview.date) || a.interview.id.localeCompare(b.interview.id));
  const finalCompanies = new Set([
    ...readable.filter(session => session.stage === "final").map(session => session.companyId),
    ...companies.filter(company => company.interviews?.some(item => item.stage === "final")).map(company => company.id),
  ]);
  const chronological = (a: { date: string; id: string }, b: { date: string; id: string }) =>
    Number(!a.date) - Number(!b.date) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  const companyGroups = [...finalCompanies].map(companyId => {
    const company = companies.find(item => item.id === companyId);
    const sessions = readable.filter(session => session.companyId === companyId).sort(chronological);
    const histories = (company?.interviews ?? []).filter(interview => !interview.sessionId || !readableIds.has(interview.sessionId))
      .map(interview => ({ companyId, company: company!.company, interview })).sort((a, b) => chronological(a.interview, b.interview));
    return { companyId, company: company?.company ?? sessions[0]?.company ?? "会社名は未確認", sessions, histories };
  }).sort((a, b) => {
    const date = (group: typeof a) => [...group.sessions.map(item => item.date), ...group.histories.map(item => item.interview.date)].sort().at(-1) ?? "";
    return date(b).localeCompare(date(a)) || a.companyId.localeCompare(b.companyId);
  });
  const finals = companyGroups.flatMap(group => group.sessions);
  const histories = companyGroups.flatMap(group => group.histories);
  const groups: ConsultationReadingGroup[] = [
    { id: "recent", title: "最近2週間の面接・面談", description: `${start.replaceAll("-", ".")}–${today.replaceAll("-", ".")}（日本時間・今日を含む14日間）の面接・面談です。エージェント面談や原稿のない確定日程も含み、実施記録の有無を区別しています。`, sessions: recent, histories: recentHistories },
    { id: "final", title: "最終面接", description: "最終面接に進んだ企業ごとに、初回から最終までの面接・面談を並べています。原稿がない回は、面接まとめや履歴を確認できます。", sessions: finals, histories, companyGroups },
  ];
  return groups.filter(group => group.id === "recent" || group.sessions.length + group.histories.length > 0);
}
