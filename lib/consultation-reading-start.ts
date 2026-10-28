import type { ConsultationCompany, ConsultationInterview, ConsultationSessionSummary } from "./consultation-library.ts";

export type ConsultationReadingHistory = { companyId: string; company: string; interview: ConsultationInterview };

export type ConsultationReadingGroup = {
  id: "recent" | "final";
  title: string;
  description: string;
  sessions: ConsultationSessionSummary[];
  histories: ConsultationReadingHistory[];
};

// 最近只给两个起点；终面按企业汇集实际记录，缺少原稿的企业仍保留历史入口。
export function selectConsultationReadingGroups(sessions: ConsultationSessionSummary[], companies: ConsultationCompany[] = []): ConsultationReadingGroup[] {
  const seen = new Set<string>();
  const readable = sessions.filter(session => session.hasRaw || session.hasReadable).slice().sort((left, right) =>
    Number(Boolean(right.date)) - Number(Boolean(left.date)) || right.date.localeCompare(left.date) || left.id.localeCompare(right.id),
  ).filter(session => {
    if (seen.has(session.id)) return false;
    seen.add(session.id); return true;
  });
  const recent = readable.slice(0, 2);
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
    { id: "recent", title: "最近の面接", description: "最近のやり取りから、今の話し方をご覧いただけます。", sessions: recent, histories: [] },
    { id: "final", title: "最終面接", description: "最終面接のある企業です。原稿のない企業は、面接履歴を確認できます。", sessions: finals, histories },
  ];
  return groups.filter(group => group.sessions.length + group.histories.length > 0);
}
