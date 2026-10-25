import { buildCompanyOverviews, resolveCompanyOverviewFrom, type CompanyOverview } from "./company-overview.ts";
import { companyIdentity, getString, type Note } from "./notes.ts";

export type ReviewCompanyMatch = { status: "ready" | "missing" | "ambiguous" | "invalid"; context: CompanyOverview | null };

/** 复盘只读取已有卷宗；显式关联坏掉时不能用同名公司掩盖错误。 */
export function reviewCompanyMatch(notes: Note[], source: Note, company: string, contexts = buildCompanyOverviews(notes)): ReviewCompanyMatch {
  const linked = ["case", "meeting"].filter((key) => Boolean(getString(source.frontmatter[key]).trim()));
  let matches: CompanyOverview[];
  if (linked.length) {
    const context = resolveCompanyOverviewFrom(contexts, notes, source);
    if (!context) return { status: linked.length > 1 ? "ambiguous" : "invalid", context: null };
    matches = [context];
  } else if (getString(source.frontmatter.case_id).trim()) {
    matches = contexts.filter((context) => context.kind === "case" && context.caseId === getString(source.frontmatter.case_id).trim());
    if (!matches.length) return { status: "invalid", context: null };
  } else {
    const identity = companyIdentity(company);
    matches = identity ? contexts.filter((context) => companyIdentity(context.company) === identity) : [];
  }
  if (matches.length > 1) return { status: "ambiguous", context: null };
  const context = matches[0];
  if (!context) return { status: "missing", context: null };
  if (!context.dossier && !context.summary && !context.assessment) return { status: "missing", context: null };
  return { status: "ready", context };
}

export const REVIEW_COMPANY_PARAM = "companyAnalysis";

/** 页内分析独占自己的 URL 键，避免外壳把后退误判成换场并重建复盘。 */
export function reviewCompanyHref(href: string, contextPath: string | null, filters?: { filter: string; pattern: string | null }) {
  const url = new URL(href, "http://localhost");
  if (filters) {
    if (filters.filter === "all") url.searchParams.delete("filter");
    else url.searchParams.set("filter", filters.filter);
    if (filters.pattern) url.searchParams.set("pattern", filters.pattern);
    else url.searchParams.delete("pattern");
  }
  if (contextPath) url.searchParams.set(REVIEW_COMPANY_PARAM, contextPath);
  else url.searchParams.delete(REVIEW_COMPANY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}
