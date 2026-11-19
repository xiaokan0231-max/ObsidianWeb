export type ComparisonPoint = { text: string; evidenceIds: string[] };

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
    advantages: ComparisonPoint[];
    tradeoffs: ComparisonPoint[];
    unknowns: string[];
    questions: string[];
  }[];
  differences: ComparisonPoint[];
  evidence: CompanyComparisonEvidence[];
};

export type CompanyComparisonAnalysisError =
  | "local_only" | "invalid_selection" | "stale_revision" | "insufficient_evidence"
  | "openai_config" | "openai_credit" | "openai_busy" | "openai_timeout" | "openai_unavailable";
