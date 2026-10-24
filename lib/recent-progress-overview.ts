import { queueCompanyKey } from "./job-queue.mjs";
import { SELECTION_STATUSES } from "./job-status.ts";
import type { RecentProgressEntry } from "./recent-progress.ts";
import { validActionDate } from "./todo-action-schema.ts";

export type RecentProgressOverviewRange = "7d" | "30d" | "all";
export type RecentProgressTone = "action" | "urgent" | "positive" | "info" | "neutral" | "muted";
export type RecentProgressCompanyGroup = { key: string; company: string; entries: RecentProgressEntry[] };
export type RecentProgressOverview = {
  start: string | null;
  end: string;
  entries: RecentProgressEntry[];
  current: RecentProgressEntry[];
  advancing: RecentProgressEntry[];
  rejected: RecentProgressCompanyGroup[];
  waiting: RecentProgressCompanyGroup[];
  work: RecentProgressEntry[];
};

const ADVANCING = new Set(SELECTION_STATUSES);

function occurred(entry: RecentProgressEntry, today: string) {
  return validActionDate(entry.date) && entry.date <= today;
}

function caseStatus(entry: RecentProgressEntry) {
  return entry.kind === "status" && entry.sourceType === "case" && entry.dateBasis === "event";
}

function currentAction(entry: RecentProgressEntry) {
  return entry.kind === "blocker" && entry.state === "required-action"
    && entry.sourceType === "user-action" && entry.dateBasis === "reviewed";
}

function recentFirst(left: RecentProgressEntry, right: RecentProgressEntry) {
  return right.date.localeCompare(left.date) || left.company.localeCompare(right.company) || left.id.localeCompare(right.id);
}

function confirmedDue(entry: RecentProgressEntry) {
  return entry.due && validActionDate(entry.due) ? entry.due : "";
}

function actionFirst(left: RecentProgressEntry, right: RecentProgressEntry) {
  const leftDue = confirmedDue(left);
  const rightDue = confirmedDue(right);
  if (leftDue && rightDue) return leftDue.localeCompare(rightDue) || recentFirst(left, right);
  if (leftDue || rightDue) return leftDue ? -1 : 1;
  return recentFirst(left, right);
}

function companies(entries: readonly RecentProgressEntry[]): RecentProgressCompanyGroup[] {
  const groups = new Map<string, RecentProgressCompanyGroup>();
  for (const entry of entries) {
    const company = entry.company.trim();
    const key = queueCompanyKey(company);
    // 无公司名的工作或旧记录仍在日期明细，不凭空计成一家「未知公司」。
    if (!company || !key) continue;
    const existing = groups.get(key);
    if (existing) existing.entries.push(entry);
    else groups.set(key, { key, company, entries: [entry] });
  }
  return [...groups.values()].sort((left, right) => recentFirst(left.entries[0], right.entries[0]) || left.key.localeCompare(right.key));
}

/** 日期已是 JST 的日历日；仅在 UTC 上做天数算术，避免设备时区和夏令时移动窗口。 */
function rangeStart(today: string, range: RecentProgressOverviewRange) {
  if (range === "all") return null;
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (range === "30d" ? 29 : 6));
  return date.toISOString().slice(0, 10);
}

/**
 * 当前本人动作不因选择短窗口而消失。其余分组只压缩显示方式，不合并不同岗位或事件；
 * 同公司可以出现在多个组，不能把各组公司数相加当作总数。
 */
export function buildRecentProgressOverview(
  entries: readonly RecentProgressEntry[], today: string, range: RecentProgressOverviewRange = "7d",
): RecentProgressOverview {
  if (!validActionDate(today)) return { start: null, end: "", entries: [], current: [], advancing: [], rejected: [], waiting: [], work: [] };
  const start = rangeStart(today, range);
  const unique = new Map<string, RecentProgressEntry>();
  for (const entry of entries) if (occurred(entry, today) && !unique.has(entry.id)) unique.set(entry.id, entry);
  const eligible = [...unique.values()].sort(recentFirst);
  const windowEntries = eligible.filter((entry) => !start || entry.date >= start);
  return {
    start, end: today, entries: windowEntries,
    current: eligible.filter(currentAction).sort(actionFirst),
    advancing: windowEntries.filter((entry) => caseStatus(entry) && ADVANCING.has(entry.state)),
    rejected: companies(windowEntries.filter((entry) => caseStatus(entry) && entry.state === "不採用")),
    waiting: companies(windowEntries.filter((entry) => (caseStatus(entry) && ["応募済", "保留"].includes(entry.state))
      || (entry.kind === "application" && entry.sourceType === "ai-application" && entry.dateBasis === "event" && entry.state === "application-submitted"))),
    work: windowEntries.filter((entry) => entry.kind === "work" || entry.kind === "draft"),
  };
}

/** 颜色依据明确事实，审核日、相对期限与建议办理日都不产生紧急标记。 */
export function progressTone(entry: RecentProgressEntry, today: string): RecentProgressTone {
  if (!validActionDate(today) || !occurred(entry, today)) return "neutral";
  if (currentAction(entry)) {
    const due = confirmedDue(entry);
    return due && due <= today ? "urgent" : "action";
  }
  if (caseStatus(entry) && ADVANCING.has(entry.state)) return "positive";
  if ((entry.kind === "draft" && entry.state === "sent") || (entry.kind === "work" && entry.state === "work-completed")) return "positive";
  if ((entry.kind === "work" || entry.kind === "draft") && ["work-in-progress", "prepared"].includes(entry.state)) return "info";
  if (caseStatus(entry) && entry.state === "不採用") return "muted";
  return "neutral";
}
