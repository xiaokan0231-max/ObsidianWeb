import {
  buildCompanyOverviews,
  resolveCompanyOverviewFrom,
  resolveCompanyReference,
  type CompanyOverview,
  type CompanyReview,
} from "./company-overview.ts";
import { interviewContext, resolveInterviewOwner, type CalendarInterviewTarget } from "./calendar-interview.ts";
import type { CalendarEvent } from "./memory-atlas-data.ts";
import { getString, getType, type Note } from "./notes.ts";

export type CalendarCompanyRating = {
  platform: string;
  score: number;
  scale: number;
  sampleCount: number | null;
  sampleUnit: string;
  readOn: string;
  limitations: string;
  url: string;
  status: "available" | "restricted";
  coverage: string;
  commentPeriod: string;
};

function eligibleReview(review: CompanyReview): review is CompanyReview & {
  score: number; scale: number; status: CalendarCompanyRating["status"];
} {
  return ["available", "restricted"].includes(review.status) &&
    typeof review.score === "number" && Number.isFinite(review.score) && review.score >= 0 &&
    typeof review.scale === "number" && Number.isFinite(review.scale) && review.scale > 0 &&
    review.score <= review.scale;
}

function selectRating(context: CompanyOverview): CalendarCompanyRating | null {
  const reviews = context.profile?.reviews.filter(eligibleReview) ?? [];
  const openWork = reviews.filter((review) => review.platform.replace(/\s/g, "").toLowerCase() === "openwork");
  // 同一平台有历史快照时取最近阅读日；不同平台保留正本顺序，绝不平均或换算量尺。
  const platform = openWork[0]?.platform ?? reviews[0]?.platform;
  const candidates = (openWork.length ? openWork : reviews.filter((review) => review.platform === platform))
    .sort((a, b) => b.readOn.localeCompare(a.readOn));
  const latest = candidates[0];
  if (!latest) return null;
  if (candidates.some((review) => review.readOn === latest.readOn &&
    (review.score !== latest.score || review.scale !== latest.scale || review.url !== latest.url))) return null;
  return {
    platform: latest.platform, score: latest.score, scale: latest.scale,
    sampleCount: latest.sampleCount, sampleUnit: latest.sampleUnit, readOn: latest.readOn,
    limitations: latest.limitations, url: latest.url, status: latest.status,
    coverage: latest.coverage, commentPeriod: latest.commentPeriod,
  };
}

/**
 * 日历只投影同一明确案件／面谈所引用的公司口碑。公司显示名、面试表现分和岗位契合分
 * 都不能用来补一个缺失的外部分数；总结与契合报告未加载也不影响已校验的平台统计。
 */
export function buildCalendarCompanyRatings(
  events: CalendarEvent[],
  notes: Note[],
  interviewTargets?: ReadonlyMap<string, CalendarInterviewTarget>,
  contexts: CompanyOverview[] = buildCompanyOverviews(notes),
): Map<string, CalendarCompanyRating> {
  const ratings = new Map<string, CalendarCompanyRating>();
  for (const event of events) {
    const target = interviewTargets?.get(event.id);
    const caseIds = [event.caseId, target?.caseId].filter((id): id is string => Boolean(id));
    if (new Set(caseIds).size > 1) continue;
    const anchors = new Map<string, Note>([[event.note.path, event.note]]);
    let invalid = false;
    for (const path of [event.prepPath, target?.sourcePath, target?.path]) {
      if (!path) continue;
      const source = resolveCompanyReference(notes, path) ?? (path === event.note.path ? event.note : null);
      if (source) anchors.set(source.path, source);
      else invalid = true;
    }
    for (const caseId of new Set(caseIds)) {
      const owners = notes.filter((note) => getType(note) === "job-case" && getString(note.frontmatter.case_id) === caseId);
      if (owners.length === 1) anchors.set(owners[0].path, owners[0]);
      else invalid = true;
    }
    const linked = new Map<string, CompanyOverview>();
    const explicitDossiers = new Set<string>();
    for (const source of anchors.values()) {
      if (["case", "meeting"].filter((field) => source.frontmatter[field] !== undefined).length > 1) {
        invalid = true; continue;
      }
      const identity = interviewContext(source, notes, true);
      if (identity.invalid) { invalid = true; continue; }
      const context = resolveCompanyOverviewFrom(contexts, notes, source) ?? (() => {
        const owner = resolveInterviewOwner(source, notes);
        return owner ? resolveCompanyOverviewFrom(contexts, notes, owner) : null;
      })();
      if (context) linked.set(context.key, context);
      // 明确写下的关联断裂时不从另一份准备稿借分；无关联的旧逐字稿允许由已知案件补足。
      else if (identity.caseId || source.frontmatter.case !== undefined || source.frontmatter.meeting !== undefined ||
        getType(source) === "job-case") invalid = true;
      if (source.frontmatter.company_dossier !== undefined) {
        const reference = getString(source.frontmatter.company_dossier).trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
        const dossier = /^\[\[[^\]]+\]\]$/.test(reference) ? resolveCompanyReference(notes, reference) : null;
        if (!dossier || getType(dossier) !== "company") invalid = true;
        else explicitDossiers.add(dossier.path);
      }
    }
    // 同名法人、同公司其他岗位和互相冲突的旧准备稿都不能靠显示名消歧。
    if (invalid || linked.size !== 1 || explicitDossiers.size > 1) continue;
    const context = [...linked.values()][0];
    if (caseIds.some((caseId) => context.caseId && context.caseId !== caseId) ||
      [...explicitDossiers].some((path) => context.dossier?.path !== path)) continue;
    const rating = selectRating(context);
    if (rating) ratings.set(event.id, rating);
  }
  return ratings;
}
