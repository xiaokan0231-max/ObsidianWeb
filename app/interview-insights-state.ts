import type { InterviewInsights, AdvisoryEvidenceRef } from "../lib/interview-advisory.ts";

export type AdvisoryCoverage = {
  sourcePath: string; company: string; date: string; round: string;
  status: "ready" | "stale" | "missing" | "blocked";
  reason: string; stage?: string; lastError?: string;
};
export type InsightsState = {
  report: InterviewInsights | null; coverage: AdvisoryCoverage[]; pending: boolean;
  insightsStatus?: string; active?: { stage: string; sourcePath?: string } | null;
  error?: string | null; done?: boolean; processedPath?: string;
};
export type InsightsFilter = { company: string; from: string; to: string; stage: string };
export const EMPTY_INSIGHTS_FILTER: InsightsFilter = { company: "", from: "", to: "", stage: "" };
export const ADVISORY_STAGE_LABELS: Record<string, string> = {
  agency: "中介面谈", matching: "条件与岗位匹配", technical: "技术面试", final: "最终面试", other: "其他阶段",
};

export function filterAdvisoryCoverage(coverage: AdvisoryCoverage[], filter: InsightsFilter) {
  return coverage.filter((item) => (!filter.company || item.company === filter.company)
    && (!filter.from || (Boolean(item.date) && item.date >= filter.from))
    && (!filter.to || (Boolean(item.date) && item.date <= filter.to))
    && (!filter.stage || item.stage === filter.stage));
}

export function evidenceIntersects(evidence: AdvisoryEvidenceRef[], sources: Set<string>) {
  return evidence.some((ref) => sources.has(ref.sourcePath));
}

/** 筛选仅定位已有发现，不能把全样本的推断伪装成重新分析过的子样本结论。 */
export function filterInsightModules(report: InterviewInsights, coverage: AdvisoryCoverage[], filter: InsightsFilter) {
  if (!Object.values(filter).some(Boolean)) return report.modules;
  const paths = new Set(filterAdvisoryCoverage(coverage, filter).map((item) => item.sourcePath));
  return report.modules.map((module) => ({ ...module, findings: module.findings.filter((finding) => evidenceIntersects(finding.evidence, paths)) }));
}
