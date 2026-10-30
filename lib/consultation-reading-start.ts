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
};

// 最近按 JST 的七个自然日收齐场次；终面仍按企业汇集，避免旧资料冒充本周面试。
export function selectConsultationReadingGroups(sessions: ConsultationSessionSummary[], companies: ConsultationCompany[] = [], today = tokyoParts().date, scheduled: ConsultationMeetingHistory[] = []): ConsultationReadingGroup[] {
  const start = shiftCalendarDay(today, -6);
  const inWeek = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= start && date <= today;
  const seen = new Set<string>();
  const readable = sessions.filter(session => session.hasRaw || session.hasReadable).slice().sort((left, right) =>
    Number(Boolean(right.date)) - Number(Boolean(left.date)) || right.date.localeCompare(left.date) || left.id.localeCompare(right.id),
  ).filter(session => {
    if (seen.has(session.id)) return false;
    seen.add(session.id); return true;
  });
  const recent = readable.filter(session => inWeek(session.date));
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
  const finalCompanies = new Set<string>();
  const finals = readable.filter(session => {
    if (session.stage !== "final" || finalCompanies.has(session.companyId)) return false;
    finalCompanies.add(session.companyId); return true;
  });
  const histories: ConsultationReadingHistory[] = [];
  for (const company of companies) {
    if (finalCompanies.has(company.id)) continue;
    const interview = company.interviews?.filter(item => item.stage === "final").sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!interview) continue;
    finalCompanies.add(company.id);
    histories.push({ companyId: company.id, company: company.company, interview });
  }
  histories.sort((a, b) => b.interview.date.localeCompare(a.interview.date) || a.companyId.localeCompare(b.companyId));
  const groups: ConsultationReadingGroup[] = [
    { id: "recent", title: "最近1週間の面接・面談", description: `${start.replaceAll("-", ".")}–${today.replaceAll("-", ".")}（日本時間・今日を含む7日間）の面接・面談です。エージェント面談や原稿のない確定日程も含み、実施記録の有無を区別しています。`, sessions: recent, histories: recentHistories },
    { id: "final", title: "最終面接", description: "最終面接のある企業です。原稿のない企業は、面接履歴を確認できます。", sessions: finals, histories },
  ];
  return groups.filter(group => group.id === "recent" || group.sessions.length + group.histories.length > 0);
}
