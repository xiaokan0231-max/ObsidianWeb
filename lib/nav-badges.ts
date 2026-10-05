import { calendarProgress } from "./calendar-progress.ts";
import type { CalendarInterviewTarget } from "./calendar-interview.ts";
import { normalizeJobStatus, SELECTION_STATUSES } from "./job-status.ts";
import type { CalendarEvent } from "./memory-atlas-data.ts";
import { getString, getType, type Note } from "./notes.ts";
import type { UiLocale } from "./ui-locale.ts";
import type { VaultScope } from "./vault-scope.ts";
import { JOB_CASE_TYPE } from "./vault-boundary.mjs";

/*
 * 侧栏角标：日历＝今天（JST）已约定的面试・面谈场次，求职＝选考中的案件数，训练中心＝快练待复习数。
 *
 * 为什么抽成纯函数：角标是「一眼看到的数字」，口径一旦和日历、看板各算各的，
 * 侧栏写 2 场、点进日历只有 1 场，本人就不知道该信哪个。这里只复用两边已有的正本——
 * 日历的场次表（buildCalendarEvents，已排除准备任务・等待・跟进）与 normalizeJobStatus。
 */

/** 选考中＝书类已过、尚未出结果。内定已不在「选考」里，不算进角标。 */
const IN_SELECTION: readonly string[] = SELECTION_STATUSES.filter((status) => status !== "内定");

/*
 * 哪些 scope 到手后，角标的输入才是完整的（与 lib/vault-scope.ts 的 noteInVaultScope 对齐）。
 * 场次来自 job-case・todo・面试资料，jobs scope 不含 todo，所以日历角标不认它；
 * job-case 在除 training 之外的所有 scope 里都有。未就绪时不出角标，避免先闪 0 再跳成真数。
 */
const CALENDAR_READY_SCOPES: ReadonlySet<VaultScope> = new Set(["all", "overview", "actions", "interview"]);
const JOBS_READY_SCOPES: ReadonlySet<VaultScope> = new Set(["all", "overview", "actions", "interview", "jobs"]);

export function calendarBadgeReady(scopes: Iterable<VaultScope>) {
  for (const scope of scopes) if (CALENDAR_READY_SCOPES.has(scope)) return true;
  return false;
}

export function jobsBadgeReady(scopes: Iterable<VaultScope>) {
  for (const scope of scopes) if (JOBS_READY_SCOPES.has(scope)) return true;
  return false;
}

/**
 * 今天的场次数。today 是外壳给的 JST 日期，事件日期本身已按 JST 入库，这里不做任何时区换算。
 * 已记录结束（不採用・面谈已了结）的案件残留的旧预约不算：拒信之后那一格不会再去，
 * 与日历「未来 7 天」和撞期判断同一处理。
 */
export function todayAppointmentCount(
  events: readonly CalendarEvent[],
  today: string,
  isClosed: (event: CalendarEvent) => boolean = () => false,
) {
  let count = 0;
  for (const event of events) {
    if (event.kind !== "event" || event.date !== today) continue;
    if (isClosed(event)) continue;
    count += 1;
  }
  return count;
}

export function selectionCaseCount(notes: readonly Note[]) {
  let count = 0;
  for (const note of notes) {
    if (getType(note) !== JOB_CASE_TYPE) continue;
    const status = normalizeJobStatus(getString(note.frontmatter.status));
    if (status && IN_SELECTION.includes(status)) count += 1;
  }
  return count;
}

/**
 * 训练中心的「待复习」：直接用快练汇总的 due（今天到期、含已逾期），不在前端另算一遍。
 * 两个月零活动的训练中心缺的是「回来练」的理由，左栏能看到到期数是最小的一步。
 * 汇总还没到、课程未建立或数为 0 时返回 null，不出角标。
 */
export function quickDueBadgeCount(summary: { ready?: boolean; due?: number } | null | undefined): number | null {
  if (!summary || summary.ready === false) return null;
  const due = summary.due;
  return typeof due === "number" && Number.isFinite(due) && due > 0 ? Math.floor(due) : null;
}

export type NavBadgeKind = "today" | "selection" | "due";

export type NavBadge = {
  kind: NavBadgeKind;
  count: number;
  /** 读屏与悬停提示用的完整说法；折叠态只剩小圆点时，数字靠它保留。 */
  label: string;
};

const BADGE_LABEL: Record<UiLocale, Record<NavBadgeKind, (count: number) => string>> = {
  "zh-CN": {
    today: (count) => `今天 ${count} 场面试`,
    selection: (count) => `选考中 ${count} 件`,
    due: (count) => `待复习 ${count} 题`,
  },
  ja: {
    today: (count) => `今日の面接 ${count} 件`,
    selection: (count) => `選考中 ${count} 件`,
    due: (count) => `復習待ち ${count} 問`,
  },
};

export function navBadgeLabel(kind: NavBadgeKind, count: number, locale: UiLocale) {
  return BADGE_LABEL[locale][kind](count);
}

/** 键是左栏顶层导航的 id（app/navigation.ts）。数为 0 或数据未就绪时不给，调用方据此不画角标。 */
export type NavBadges = Partial<Record<"actions" | "career" | "training", NavBadge>>;

export function buildNavBadges({ events, notes, today, readyScopes, interviewTargets, locale, quickDue = null }: {
  events: readonly CalendarEvent[];
  notes: Note[];
  today: string;
  readyScopes: Iterable<VaultScope>;
  interviewTargets?: ReadonlyMap<string, CalendarInterviewTarget>;
  locale: UiLocale;
  /** 快练待复习数（quickDueBadgeCount 的结果）；它不来自 vault scope，未知时为 null。 */
  quickDue?: number | null;
}): NavBadges {
  const scopes = [...readyScopes];
  const badges: NavBadges = {};
  if (calendarBadgeReady(scopes)) {
    // 只给今天的场次算进展：calendarProgress 要回查案件，没必要对全年的日程都跑一遍。
    const count = todayAppointmentCount(events, today,
      (event) => calendarProgress(event, notes, interviewTargets?.get(event.id)).tone === "closed");
    if (count > 0) badges.actions = { kind: "today", count, label: navBadgeLabel("today", count, locale) };
  }
  if (jobsBadgeReady(scopes)) {
    const count = selectionCaseCount(notes);
    if (count > 0) badges.career = { kind: "selection", count, label: navBadgeLabel("selection", count, locale) };
  }
  if (quickDue !== null && quickDue > 0) {
    badges.training = { kind: "due", count: quickDue, label: navBadgeLabel("due", quickDue, locale) };
  }
  return badges;
}
