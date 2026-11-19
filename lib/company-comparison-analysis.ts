export type ComparisonPoint = { text: string; evidenceIds: string[] };
export type ComparisonImpact = ComparisonPoint & { implication: string };
export type ComparisonDifference = ComparisonImpact & { axis: string };
export type ComparisonScenario = { priority: string; choice: string; verify: string; evidenceIds: string[] };
export type ComparisonQuestion = { question: string; reason: string; evidenceIds: string[] };

export type CompanyComparisonEvidence = {
  id: string;
  path: string;
  label: string;
  value: string;
  asOf: string;
  scope: string;
  sourceLabels: string[];
  sources?: { label: string; url?: string }[];
};

export type CompanyComparisonAnalysis = {
  companies: {
    path: string;
    label: string;
    role: string;
    advantages: ComparisonImpact[];
    tradeoffs: ComparisonImpact[];
    unknowns: string[];
    questions: ComparisonQuestion[];
  }[];
  differences: ComparisonDifference[];
  scenarios: ComparisonScenario[];
  evidence: CompanyComparisonEvidence[];
};

export type CompanyComparisonAnalysisError =
  | "local_only" | "invalid_selection" | "stale_revision" | "insufficient_evidence"
  | "codex_config" | "codex_login" | "codex_busy" | "codex_timeout" | "codex_unavailable";

export type CompanyComparisonModelInput = {
  companies: { id: string; facts: Pick<CompanyComparisonEvidence, "id" | "label" | "value" | "scope" | "asOf">[] }[];
  locale: "zh-CN" | "ja";
};

export function companyComparisonDeadlines(companyCount: number) {
  const generationMs = companyCount > 4 ? 190_000 : 145_000;
  // 桥接请求还要等本机登录检测，浏览器额外给资料投影读取留时间。
  return { generationMs, bridgeMs: generationMs + 20_000, browserMs: generationMs + 30_000 };
}
