import type { CompanyOverview } from "../lib/company-overview.ts";
import type { Note } from "../lib/notes.ts";
import {
  COMPANY_COMPARE_LIMIT,
  buildCompanyCompareCandidates,
  companyComparePreset,
  filterCompanyCompareCandidates,
} from "../lib/company-compare.ts";

/** 显式空选择也写进链接，避免清空后刷新又被默认组填回。 */
export function updateCompanyComparisonSearch(search: string, paths: string[]): URLSearchParams {
  const params = new URLSearchParams(search);
  params.delete("compare");
  const unique = [...new Set(paths.filter(Boolean))].slice(0, COMPANY_COMPARE_LIMIT);
  if (!unique.length) params.set("compare", "");
  else for (const path of unique) params.append("compare", path);
  return params;
}

/** 链接只携带正本路径；一次只带一家时保留本人选择，不擅自补另一家。 */
export function resolveCompanyComparisonSelection(contexts: CompanyOverview[], notes: Note[], today: string, search: string): string[] {
  const params = new URLSearchParams(search);
  if (params.has("compare")) {
    const valid = new Set(contexts.map((context) => context.note.path));
    return [...new Set(params.getAll("compare"))].filter((path) => valid.has(path)).slice(0, COMPANY_COMPARE_LIMIT);
  }
  const candidates = buildCompanyCompareCandidates(contexts, notes, today);
  for (const preset of ["upcoming", "recent", "openwork"] as const) {
    const paths = companyComparePreset(candidates, preset, 4);
    if (paths.length >= 2) return paths;
  }
  return filterCompanyCompareCandidates(candidates, "", "relevant", [], "relevance").slice(0, 2).map((item) => item.context.note.path);
}
