import { queueCompanyKey } from "./job-queue.mjs";
import { SELECTION_STATUSES } from "./job-status.ts";
import type { RecentProgressEntry } from "./recent-progress.ts";
import type { RecentProgressOverview } from "./recent-progress-overview.ts";

export const PROGRESS_SEGMENTS = ["advancing", "applied", "held", "rejected"] as const;
export type ProgressSegment = typeof PROGRESS_SEGMENTS[number];
export type ProgressChartBucket = { date: string; end: string; companies: number; entries: RecentProgressEntry[] };

function companyEvent(entry: RecentProgressEntry) {
  return entry.dateBasis === "event" && Boolean(queueCompanyKey(entry.company)) &&
    ((entry.kind === "status" && entry.sourceType === "case") ||
      (entry.kind === "application" && entry.sourceType === "ai-application" && entry.state === "application-submitted"));
}

export function progressCompanyCount(entries: readonly RecentProgressEntry[]) {
  return new Set(entries.map((entry) => queueCompanyKey(entry.company)).filter(Boolean)).size;
}

function segment(entry: RecentProgressEntry): ProgressSegment | null {
  if (SELECTION_STATUSES.includes(entry.state)) return "advancing";
  if (["応募済", "application-submitted"].includes(entry.state)) return "applied";
  if (entry.state === "保留") return "held";
  if (entry.state === "不採用") return "rejected";
  return null;
}

/** 图只使用事件日；工作记录日与事项核实日不画成企业动向。 */
export function buildProgressDashboard(overview: RecentProgressOverview) {
  const events = overview.entries.filter(companyEvent);
  const monthly = overview.start === null;
  const start = overview.start ?? events.map((entry) => entry.date).sort()[0] ?? overview.end;
  const buckets: ProgressChartBucket[] = [];
  if (start && overview.end) {
    const cursor = new Date(`${monthly ? `${start.slice(0, 7)}-01` : start}T00:00:00Z`);
    while (cursor.toISOString().slice(0, 10) <= overview.end) {
      const date = cursor.toISOString().slice(0, 10);
      if (monthly) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      else cursor.setUTCDate(cursor.getUTCDate() + 1);
      const last = new Date(cursor.getTime() - 86400000).toISOString().slice(0, 10);
      const end = last > overview.end ? overview.end : last;
      const entries = events.filter((entry) => entry.date >= date && entry.date <= end);
      buckets.push({ date, end, companies: progressCompanyCount(entries), entries });
    }
  }

  // 同一案件的申请与后续状态只能占一块；同日明确状态优先于申请记录。
  // 不跨岗位合并，同公司可以有不同岗位及不同选考结果。
  const cases = new Map<string, RecentProgressEntry>();
  for (const entry of events) {
    const key = entry.caseId || entry.sourcePaths[0] || entry.id;
    const previous = cases.get(key);
    if (!previous || entry.date > previous.date ||
      (entry.date === previous.date && entry.kind === "status" && previous.kind !== "status")) cases.set(key, entry);
  }
  const segments = PROGRESS_SEGMENTS.map((key) => ({ key, entries: [...cases.values()].filter((entry) => segment(entry) === key) }));
  return {
    buckets, monthly, companies: progressCompanyCount(events),
    advancingCompanies: progressCompanyCount(segments.find((item) => item.key === "advancing")!.entries),
    waitingCompanies: progressCompanyCount(segments.filter((item) => item.key === "applied" || item.key === "held").flatMap((item) => item.entries)),
    rejectedCompanies: progressCompanyCount(segments.find((item) => item.key === "rejected")!.entries),
    segments, caseCount: segments.reduce((sum, item) => sum + item.entries.length, 0),
    peak: Math.max(1, ...buckets.map((bucket) => bucket.companies)),
  };
}
