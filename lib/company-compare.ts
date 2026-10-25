import { resolveCompanyOverviewFrom, type CompanyOverview, type CompanyReview } from "./company-overview.ts";
import { buildCalendarEvents, type CalendarEvent } from "./memory-atlas-data.ts";
import { buildCalendarEventOrigins, calendarOriginLabel, type CalendarOriginKind } from "./calendar-event-origin.ts";
import { resolveInterviewOwner } from "./calendar-interview.ts";
import { getString, type Note } from "./notes.ts";
import { normalizeJobStatus } from "./job-status.ts";

export const COMPANY_COMPARE_LIMIT = 8;
export type CompanyComparePlatform = "OpenWork" | "転職会議";
export type CompanyCompareFilter = "all" | "relevant" | "upcoming" | "recent" | "rated" | "selected";
export type CompanyCompareSort = "relevance" | "openwork" | "jobtalk" | "recent";
export type CompanyComparePreset = "upcoming" | "recent" | "openwork" | "jobtalk";
export type CompanyCompareReview = {
  platform: CompanyComparePlatform;
  score: number;
  scale: 5;
  sampleCount: number | null;
  sampleUnit: string;
  readOn: string;
  url: string;
  status: "available" | "restricted";
  coverage: string;
  limitations: string;
  commentPeriod: string;
};
export type CompanyCompareCandidate = {
  context: CompanyOverview;
  shortName: string;
  displayRole: string;
  status: string;
  channel: string;
  originKind: CalendarOriginKind;
  originLabel: string;
  eventAt: string;
  lastInterviewAt: string;
  dateLabel: string;
  hasInterview: boolean;
  readinessLabel: string;
  reviews: CompanyCompareReview[];
  haystack: string;
};

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").trim();
}

function platformOf(value: string): CompanyComparePlatform | null {
  const key = normalized(value).replace(/\s/g, "");
  return key === "openwork" ? "OpenWork" : ["転職会議", "jobtalk", "tenshokukaigi"].includes(key) ? "転職会議" : null;
}

function shortCompany(value: string) {
  const name = value.trim();
  return name.replace(/^(株式会社|有限会社|合同会社)\s*|\s*(株式会社|有限会社|合同会社)$/gu, "").trim() || name;
}

/** 两站各取自己的最新快照，不拿缺失、冲突或不同量尺的值参与高分排序。 */
export function companyCompareRatings(context: CompanyOverview): CompanyCompareReview[] {
  const reviews = context.profile?.reviews ?? [];
  return (["OpenWork", "転職会議"] as const).flatMap((platform) => {
    const snapshots = reviews.filter((review) => platformOf(review.platform) === platform)
      .sort((a, b) => b.readOn.localeCompare(a.readOn));
    const latest = snapshots[0];
    if (!latest || !validRating(latest)) return [];
    if (snapshots.some((review) => review.readOn === latest.readOn &&
      (review.score !== latest.score || review.scale !== latest.scale || review.status !== latest.status || review.url !== latest.url))) return [];
    return [{ platform, score: latest.score, scale: 5 as const, sampleCount: latest.sampleCount,
      sampleUnit: latest.sampleUnit, readOn: latest.readOn, url: latest.url, status: latest.status,
      coverage: latest.coverage, limitations: latest.limitations, commentPeriod: latest.commentPeriod }];
  });
}

function validRating(review: CompanyReview): review is CompanyReview & { score: number; scale: 5; status: "available" | "restricted" } {
  return (review.status === "available" || review.status === "restricted") && review.scale === 5 &&
    typeof review.score === "number" && Number.isFinite(review.score) && review.score >= 0 && review.score <= 5;
}

function readiness(context: CompanyOverview) {
  if (context.profile && context.assessment) return "公司资料 · 契合已评估";
  if (context.profile) return "公司资料已整理";
  if (context.assessment) return "已有契合评价";
  return "资料待补 · 仍可对比";
}

const at = (event: CalendarEvent) => `${event.date}${event.time ? ` ${event.time}` : ""}`;
const collator = new Intl.Collator("ja");
const byName = (a: CompanyCompareCandidate, b: CompanyCompareCandidate) =>
  collator.compare(a.shortName, b.shortName) || collator.compare(a.context.title, b.context.title) ||
  a.context.note.path.localeCompare(b.context.note.path);

/** 旧稿没有 assessment 也保留；真实日程与外部资料比字母顺序更能说明此刻该看谁。 */
export function buildCompanyCompareCandidates(contexts: CompanyOverview[], notes: Note[], today: string): CompanyCompareCandidate[] {
  const byPath = new Map(notes.map((note) => [note.path, note]));
  // 日程沿用日历正本的投影规则；准备制作日、due 与 profile 更新时间都不能充作面谈日。
  const events = buildCalendarEvents(notes, new Date(`${today}T12:00:00`));
  const origins = buildCalendarEventOrigins(events, notes);
  const related = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (origins.get(event.id)?.evidence === "owner-conflict") continue;
    const prep = byPath.get(event.prepPath);
    const sources = prep ? [event.note, prep] : [event.note];
    const matches = new Map<string, CompanyOverview>();
    for (const source of sources) {
      const owner = resolveInterviewOwner(source, notes, event.caseId);
      const context = resolveCompanyOverviewFrom(contexts, notes, owner ?? source);
      if (context) matches.set(context.key, context);
    }
    // 不按显示名找另一岗位；冲突引用不能用日期近或同名来抵消。
    if (matches.size !== 1) continue;
    const context = [...matches.values()][0];
    related.set(context.key, [...(related.get(context.key) ?? []), event]);
  }
  const candidates = contexts.map((context): CompanyCompareCandidate => {
    const dates = (related.get(context.key) ?? []).sort((a, b) => at(a).localeCompare(at(b)));
    const next = dates.find((event) => event.date >= today);
    const previous = dates.filter((event) => event.date < today).at(-1);
    const eventAt = next ? at(next) : "";
    const lastInterviewAt = previous ? at(previous) : "";
    const source = next ?? previous;
    const origin = source ? origins.get(source.id) : null;
    const originKind = origin?.kind ?? "unknown";
    const rawStatus = getString(context.note.frontmatter.status);
    const status = context.kind === "case" ? (normalizeJobStatus(rawStatus) ?? rawStatus) || "状态待确认" :
      /完了|完成|done|cancelled|中止|取消/i.test(rawStatus) ? "面谈已结束" : next ? "面谈已安排" : previous ? "已面谈" : "面谈";
    const channel = origin?.channel || getString(context.note.frontmatter.channel);
    const dateLabel = eventAt ? `下次 ${eventAt}` : lastInterviewAt ? `面过 ${lastInterviewAt}` : "面谈日期未记录";
    const reviews = companyCompareRatings(context);
    const legalName = getString(context.dossier?.frontmatter.company) || context.company;
    const shortName = shortCompany(legalName);
    // 独立面谈正本可能以待办命名，优先采用明确关联到本场的岗位事实。
    const displayRole = context.kind === "meeting" ? context.assessment?.contextFacts.find((fact) => fact.id === "role")?.value ||
      getString(context.note.frontmatter.meeting_topic) || context.title : context.title;
    const originLabel = calendarOriginLabel(originKind);
    const readinessLabel = readiness(context);
    return { context, shortName, displayRole, status, channel, originKind, originLabel, eventAt, lastInterviewAt, dateLabel,
      hasInterview: dates.length > 0, readinessLabel, reviews,
      haystack: normalized([context.company, legalName, shortName, displayRole, context.title, context.caseId, status, channel,
        originLabel, dateLabel, readinessLabel, ...reviews.map((review) => review.platform),
        ...(context.profile?.facts.filter((fact) => fact.id === "business").map((fact) => fact.value) ?? [])].join(" ")) };
  });
  return candidates.sort(byRelevance);
}

function byRelevance(a: CompanyCompareCandidate, b: CompanyCompareCandidate) {
  const rank = (item: CompanyCompareCandidate) => item.eventAt ? 0 : item.lastInterviewAt ? 1 :
    item.context.profile || item.context.assessment ? 2 : 3;
  const difference = rank(a) - rank(b);
  if (difference) return difference;
  if (a.eventAt && b.eventAt) return a.eventAt.localeCompare(b.eventAt) || byName(a, b);
  if (a.lastInterviewAt && b.lastInterviewAt) return b.lastInterviewAt.localeCompare(a.lastInterviewAt) || byName(a, b);
  return byName(a, b);
}

function platformScore(item: CompanyCompareCandidate, platform: CompanyComparePlatform) {
  return item.reviews.find((review) => review.platform === platform)?.score ?? null;
}

function sortCandidates(items: CompanyCompareCandidate[], sort: CompanyCompareSort) {
  return [...items].sort((a, b) => {
    if (sort === "recent") return b.lastInterviewAt.localeCompare(a.lastInterviewAt) || byRelevance(a, b);
    if (sort === "openwork" || sort === "jobtalk") {
      const platform = sort === "openwork" ? "OpenWork" : "転職会議";
      const left = platformScore(a, platform), right = platformScore(b, platform);
      if (left === null && right !== null) return 1;
      if (left !== null && right === null) return -1;
      if (left !== null && right !== null && left !== right) return right - left;
    }
    return byRelevance(a, b);
  });
}

export function filterCompanyCompareCandidates(items: CompanyCompareCandidate[], query: string,
  filter: CompanyCompareFilter, selectedPaths: string[], sort: CompanyCompareSort): CompanyCompareCandidate[] {
  const tokens = normalized(query).split(/\s+/).filter(Boolean);
  const selected = new Set(selectedPaths);
  const visible = items.filter((item) => {
    if (!tokens.every((token) => item.haystack.includes(token))) return false;
    if (filter === "selected") return selected.has(item.context.note.path);
    if (filter === "upcoming") return Boolean(item.eventAt);
    if (filter === "recent") return Boolean(item.lastInterviewAt);
    if (filter === "rated") return item.reviews.length > 0;
    if (filter === "relevant") return Boolean(item.context.profile || item.context.assessment || item.hasInterview || selected.has(item.context.note.path));
    return true;
  });
  return sortCandidates(visible, sort);
}

/** 快选只以明确卷宗去重法人；没有卷宗时保留岗位，不靠名字合并同名法人。 */
export function companyComparePreset(items: CompanyCompareCandidate[], preset: CompanyComparePreset, limit = 4): string[] {
  const ordered = preset === "upcoming" ? sortCandidates(items.filter((item) => item.eventAt), "relevance") :
    preset === "recent" ? sortCandidates(items.filter((item) => item.lastInterviewAt), "recent") :
      sortCandidates(items.filter((item) => platformScore(item, preset === "openwork" ? "OpenWork" : "転職会議") !== null), preset);
  const maximum = Number.isFinite(limit) ? Math.max(0, Math.min(COMPANY_COMPARE_LIMIT, Math.floor(limit))) : 4;
  const companies = new Set<string>();
  const paths: string[] = [];
  for (const item of ordered) {
    if (paths.length >= maximum) break;
    const identity = item.context.dossier?.path || item.context.note.path;
    if (companies.has(identity)) continue;
    companies.add(identity);
    paths.push(item.context.note.path);
  }
  return paths;
}
