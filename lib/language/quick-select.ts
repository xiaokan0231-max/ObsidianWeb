import type {
  LanguageBatchHistory,
  LanguageItemProgress,
  LanguageTrainingStage,
} from "./types.ts";
import type {
  QuickCard,
  QuickCardReason,
  QuickEvent,
  QuickGroup,
  QuickItem,
  QuickLegacyJudgments,
  QuickPool,
  QuickSet,
  QuickSetSize,
  QuickSummary,
  QuickTopIssue,
} from "./quick-types.ts";
import type { QuickIndex } from "./quick-cards.ts";
import { availableCardTypes, buildQuickCard, chooseCardType } from "./quick-cards.ts";
import { jstMidnightIso } from "./quick-progress.ts";
import { quickDay } from "./quick-log.ts";
import { isKanjiOnly, seededShuffle, stableSeed } from "./quick-text.ts";

/*
 * 一组快练卡片的构成、总览数字与历史合成。服务端取题与汇总都只调这里。
 *
 * 一组 N 题的顺序是「先还账，再学新」：
 * ① 到期（到期日 ≤ 今天、今天还没答过）：到期早、失败多、优先级高的在前；同一错误型软上限 4，
 *    否则助词类一次到期几十条时整组都是助词。到期很多（> 2N）时进入追赶模式，本组不放新题。
 * ② 今天答错、还没答对的：≤ round(N×0.2)。今天再答不计成败（首答已定），只为当天多见一次。
 * ③ 新题：≤ round(N×0.3)，且受每日新题额度 2N 约束（extra 时本组再放宽 N）。
 * ④ 仍不满：先放回被软上限挡下的到期题，再补明天到期的，最后补新题（仍受每日额度约束）。
 * 每日额度的理由：新题第 3 天集中到期。一天做 5 组、每组都补满新题，第 4 天会到期上百条。
 *
 * 时间一律由参数 day（JST）给出，不读当前时间：同一输入永远得到同一组。
 */

export const QUICK_SELECT_RULES = {
  newShare: 0.3,
  lapsedShare: 0.2,
  typedShare: 0.2,
  dailyNewFactor: 2,
  /** 到期题同一错误型的软上限（挡下的题在第 ④ 步还会放回）。 */
  duePatternCap: 4,
  /** 新题同一错误型的上限。 */
  newPatternCap: 2,
  /** 非追赶模式下，到期再多也给新题留的位子。 */
  keepNew: 2,
  /** 到期数超过 N 的这个倍数就进入追赶模式。 */
  catchUpFactor: 2,
  /** 改错型在题库里至少这么多条才算高频（助詞一类上百条，单条的冷门型不算）。 */
  frequentPatternSize: 5,
  /** topIssues 里跨至少这么多场面试的错误型算高频。 */
  frequentIssueInterviews: 3,
} as const;

export type QuickSource = "patch" | "phrase" | "notebook" | "pattern";

/** 新题的来源配额：本人的改错最重要，其次是面试官原话，再是単語文法帳，句型定型只翻卡、少放。 */
export const QUICK_SOURCE_QUOTA: Readonly<Record<QuickSource, number>> = {
  patch: 0.4,
  phrase: 0.3,
  notebook: 0.2,
  pattern: 0.1,
};
const SOURCE_ORDER: readonly QuickSource[] = ["patch", "phrase", "notebook", "pattern"];

export function quickSourceOf(group: QuickGroup): QuickSource {
  if (group === "error_patch") return "patch";
  if (group === "interviewer_phrase") return "phrase";
  if (group === "answer_strategy" || group === "active_chunk" || group === "nb_pattern") return "pattern";
  return "notebook";
}

export type QuickSelectInput = {
  pool: QuickPool;
  index: QuickIndex;
  progress: ReadonlyMap<string, LanguageItemProgress>;
  /** 全部快练事件，按时间顺序（collectQuickEvents 的输出）。 */
  events: readonly QuickEvent[];
  legacy: QuickLegacyJudgments;
  /** JST 日。 */
  day: string;
  size: QuickSetSize;
  typing: boolean;
  extra: boolean;
  setId: string;
  /** 课程 profile 的高频问题；用来判定新题里的「高频错误型」。 */
  topIssues?: readonly QuickTopIssue[];
};

// ── 当日事件 ────────────────────────────────────────────────────

type TodayContext = {
  /** 今天作答过的条目（任何一次 answer，含重出）。 */
  answered: Set<string>;
  /** 今天最后一次作答仍未答对的条目 → 那次作答时刻。 */
  lapsed: Map<string, string>;
  /** 第一次首答发生在今天的条目：今天引入的新题，计入每日额度。 */
  introduced: Set<string>;
  firstPasses: number;
};

function failed(event: QuickEvent) {
  if (event.type === "flip") return event.rating !== "remembered";
  return event.passed === false || event.gaveUp === true;
}

function todayContext(events: readonly QuickEvent[], day: string): TodayContext {
  const context: TodayContext = { answered: new Set(), lapsed: new Map(), introduced: new Set(), firstPasses: 0 };
  const everFirst = new Set<string>();
  for (const event of events) {
    if (event.action !== "answer") continue;
    const today = quickDay(event.at) === day;
    if (event.first && !everFirst.has(event.itemId)) {
      everFirst.add(event.itemId);
      if (today) context.introduced.add(event.itemId);
    }
    if (!today) continue;
    context.answered.add(event.itemId);
    if (event.first && event.passed === true) context.firstPasses += 1;
    if (failed(event)) context.lapsed.set(event.itemId, event.at);
    else context.lapsed.delete(event.itemId);
  }
  return context;
}

// ── 候选与排序 ──────────────────────────────────────────────────

function dueTime(entry: LanguageItemProgress | undefined) {
  const time = entry?.nextDueAt ? Date.parse(entry.nextDueAt) : Number.NaN;
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function isNew(entry: LanguageItemProgress | undefined) {
  return !entry || !(entry.attemptCount ?? 0);
}

function excluded(item: QuickItem, progress: QuickSelectInput["progress"], legacy: QuickLegacyJudgments) {
  return progress.get(item.id)?.rejected === true || legacy.get(item.id) === "reject";
}

/** 到期排序：到期日早 → 失败多 → 优先级高 → 按日期加盐的哈希（同分的条目每天轮换，不总是同几条垫底）。 */
function compareDue(
  progress: QuickSelectInput["progress"],
  day: string,
) {
  return (left: QuickItem, right: QuickItem) => {
    const a = progress.get(left.id);
    const b = progress.get(right.id);
    return dueTime(a) - dueTime(b)
      || (b?.failureCount ?? 0) - (a?.failureCount ?? 0)
      || right.priority - left.priority
      || stableSeed(`${day}|${left.id}`) - stableSeed(`${day}|${right.id}`)
      || left.id.localeCompare(right.id);
  };
}

function frequentPatterns(items: readonly QuickItem[], topIssues: readonly QuickTopIssue[] = []) {
  const sizes = new Map<string, number>();
  for (const item of items) {
    if (item.group === "error_patch" && item.pattern) sizes.set(item.pattern, (sizes.get(item.pattern) ?? 0) + 1);
  }
  const frequent = new Set(
    [...sizes].filter(([, count]) => count >= QUICK_SELECT_RULES.frequentPatternSize).map(([pattern]) => pattern),
  );
  for (const issue of topIssues) {
    if (issue.interviewCount < QUICK_SELECT_RULES.frequentIssueInterviews) continue;
    frequent.add(issue.key);
    frequent.add(issue.label);
  }
  return frequent;
}

/**
 * 新题的先后（首个命中即定）：
 * 0 旧批次自报「不会」→ 1「犹豫」→ 2 听解标记 → 3 単語文法帳 ★★ 或跨 ≥2 场面试 → 4 ★ 或高频错误型 → 5 其余。
 * 纯汉字的面试官短语排到 6：它只能出看中文选日语，对中文母语者几乎是送分题，价值最低。
 * 前三档是本人明确标过的，不受这条降级影响。
 */
export function quickNewTier(item: QuickItem, legacy: QuickLegacyJudgments, frequent: ReadonlySet<string>) {
  const judgment = legacy.get(item.id);
  if (judgment === "unknown") return 0;
  if (judgment === "uncertain") return 1;
  if (item.listeningMark) return 2;
  if (item.group === "interviewer_phrase" && isKanjiOnly(item.ja)) return 6;
  if (item.stars === 2 || item.interviewCount >= 2) return 3;
  if (item.stars === 1 || (item.group === "error_patch" && frequent.has(item.pattern))) return 4;
  return 5;
}

/** 最大余数法分配名额：先按份额取整，余下的按小数部分大小给。 */
function apportion(count: number, available: Readonly<Record<QuickSource, number>>) {
  const result: Record<QuickSource, number> = { patch: 0, phrase: 0, notebook: 0, pattern: 0 };
  const sources = SOURCE_ORDER.filter((source) => available[source] > 0);
  const total = sources.reduce((sum, source) => sum + QUICK_SOURCE_QUOTA[source], 0);
  if (!count || !total) return result;
  const exact = sources.map((source) => ({ source, value: (count * QUICK_SOURCE_QUOTA[source]) / total }));
  let left = count;
  for (const entry of exact) {
    result[entry.source] = Math.floor(entry.value);
    left -= result[entry.source];
  }
  exact
    .sort((a, b) => (b.value - Math.floor(b.value)) - (a.value - Math.floor(a.value))
      || SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source))
    .slice(0, left)
    .forEach((entry) => { result[entry.source] += 1; });
  return result;
}

// ── 组内顺序 ────────────────────────────────────────────────────

function clash(left: QuickCard | undefined, right: QuickCard) {
  if (!left) return false;
  return left.group === right.group || (left.type === "short_input" && right.type === "short_input");
}

/** 先按 day|setId 洗牌，再贪心挑「和上一张不同组、打字题不连排」的下一张；挑不到才允许相邻。 */
function spread(cards: readonly QuickCard[], seed: string) {
  const remaining = seededShuffle(cards, seed);
  const output: QuickCard[] = [];
  while (remaining.length) {
    const last = output.at(-1);
    const index = Math.max(0, remaining.findIndex((card) => !clash(last, card)));
    output.push(remaining.splice(index, 1)[0]);
  }
  return output;
}

// ── 选题 ────────────────────────────────────────────────────────

export function selectQuickSet(input: QuickSelectInput): QuickSet {
  const { pool, index, progress, events, legacy, day, size, typing, extra, setId } = input;
  const rules = QUICK_SELECT_RULES;
  const newCap = Math.round(size * rules.newShare);
  const lapsedCap = Math.round(size * rules.lapsedShare);
  let typedLeft = Math.round(size * rules.typedShare);
  const dailyNewLimit = rules.dailyNewFactor * size + (extra ? size : 0);

  const today = todayContext(events, day);
  const endOfToday = Date.parse(jstMidnightIso(day, 1));
  const endOfTomorrow = Date.parse(jstMidnightIso(day, 2));
  const items = pool.items.filter((item) => !excluded(item, progress, legacy));
  const byDue = compareDue(progress, day);

  const due = items
    .filter((item) => !today.answered.has(item.id) && dueTime(progress.get(item.id)) < endOfToday)
    .sort(byDue);
  const catchUp = due.length > rules.catchUpFactor * size;
  const frequent = frequentPatterns(pool.items, input.topIssues);
  const newQueue = items
    .filter((item) => isNew(progress.get(item.id)) && !today.answered.has(item.id))
    .map((item) => ({ item, tier: quickNewTier(item, legacy, frequent) }))
    .sort((a, b) => a.tier - b.tier
      || b.item.priority - a.item.priority
      || stableSeed(a.item.id) - stableSeed(b.item.id)
      || a.item.id.localeCompare(b.item.id))
    .map((entry) => entry.item);
  const newQuota = Math.max(0, dailyNewLimit - today.introduced.size);

  const cards: QuickCard[] = [];
  const picked = new Set<string>();
  const tried = new Set<string>();
  const patternCount = new Map<string, number>();
  const newPatternCount = new Map<string, number>();
  let newPicked = 0;

  const room = () => size - cards.length;
  const patternOf = (item: QuickItem) => (item.group === "error_patch" && item.pattern ? item.pattern : "");

  /** 出一张卡；出不了（无可用题型或不变式不过）就记下并跳过，由下一个候选补位。 */
  const take = (item: QuickItem, reason: QuickCardReason) => {
    if (picked.has(item.id) || tried.has(item.id)) return false;
    tried.add(item.id);
    const stage: LanguageTrainingStage = progress.get(item.id)?.stage ?? "unseen";
    const type = chooseCardType(item, stage, { index, typing, day, typedLeft });
    let card = type ? buildQuickCard(item, type, { index, day, reason, stage }) : null;
    if (!card && type === "short_input") {
      const fallback = chooseCardType(item, stage, { index, typing, day, typedLeft: 0 });
      card = fallback ? buildQuickCard(item, fallback, { index, day, reason, stage }) : null;
    }
    if (!card) return false;
    if (card.type === "short_input") typedLeft -= 1;
    cards.push(card);
    picked.add(item.id);
    const pattern = patternOf(item);
    if (pattern) patternCount.set(pattern, (patternCount.get(pattern) ?? 0) + 1);
    return true;
  };

  // ① 到期
  const keepNew = catchUp || !newQuota || !newQueue.length ? 0 : Math.min(rules.keepNew, newCap);
  const overflow: QuickItem[] = [];
  for (const item of due) {
    if (cards.length >= size - keepNew) break;
    const pattern = patternOf(item);
    if (pattern && (patternCount.get(pattern) ?? 0) >= rules.duePatternCap) {
      overflow.push(item);
      continue;
    }
    take(item, "due");
  }

  // ② 今天答错、还没答对的（今天答过，所以不在到期队列里）
  const lapsed = items
    .filter((item) => today.lapsed.has(item.id))
    .sort((a, b) => today.lapsed.get(a.id)!.localeCompare(today.lapsed.get(b.id)!) || a.id.localeCompare(b.id));
  let lapsedTaken = 0;
  for (const item of lapsed) {
    // 和到期题一样不占给新题留的位子：今天错过的题已经在当天多见过一次了。
    if (lapsedTaken >= lapsedCap || cards.length >= size - keepNew) break;
    if (take(item, "lapsed")) lapsedTaken += 1;
  }

  // ③ 新题（来源配额 + 同型上限），名额用不完的按先后顺序让给别家
  const pickNew = (count: number) => {
    const target = Math.min(count, room(), newQuota - newPicked);
    if (target <= 0) return;
    const fits = (item: QuickItem) => {
      const pattern = patternOf(item);
      if (!pattern) return true;
      return (newPatternCount.get(pattern) ?? 0) < rules.newPatternCap
        && (patternCount.get(pattern) ?? 0) < rules.duePatternCap;
    };
    const takeNew = (item: QuickItem) => {
      if (!fits(item) || !take(item, "new")) return false;
      newPicked += 1;
      const pattern = patternOf(item);
      if (pattern) newPatternCount.set(pattern, (newPatternCount.get(pattern) ?? 0) + 1);
      return true;
    };
    const remaining = newQueue.filter((item) => !picked.has(item.id) && !tried.has(item.id));
    const available = { patch: 0, phrase: 0, notebook: 0, pattern: 0 };
    for (const item of remaining) available[quickSourceOf(item.group)] += 1;
    const quota = apportion(target, available);
    let taken = 0;
    for (const source of SOURCE_ORDER) {
      let share = 0;
      for (const item of remaining) {
        if (share >= quota[source]) break;
        if (quickSourceOf(item.group) !== source) continue;
        if (takeNew(item)) share += 1;
      }
      taken += share;
    }
    for (const item of remaining) {
      if (taken >= target) break;
      if (takeNew(item)) taken += 1;
    }
  };
  if (!catchUp) pickNew(newCap);

  // ④ 仍不满：被软上限挡下的到期题 → 明天到期 → 更多新题
  for (const item of overflow) {
    if (!room()) break;
    take(item, "due");
  }
  if (room()) {
    const tomorrow = items
      .filter((item) => {
        if (today.answered.has(item.id)) return false;
        const time = dueTime(progress.get(item.id));
        return time >= endOfToday && time < endOfTomorrow;
      })
      .sort(byDue);
    for (const item of tomorrow) {
      if (!room()) break;
      take(item, "early");
    }
  }
  if (!catchUp && room()) pickNew(room());

  const composition: Record<QuickCardReason, number> = { due: 0, lapsed: 0, new: 0, early: 0 };
  for (const card of cards) composition[card.reason] += 1;
  const newLeft = newQueue.some((item) => !picked.has(item.id) && !tried.has(item.id));
  return {
    setId,
    day,
    size,
    cards: spread(cards, `${day}|${setId}`),
    composition,
    limits: {
      newToday: today.introduced.size,
      dailyNewLimit,
      // 额度用完而题库里还有新题：界面据此提示「今天新题额度已用完」并给「再加一组新题」。
      newExhausted: !catchUp && newQuota - newPicked <= 0 && newLeft,
    },
  };
}

// ── 历史与汇总 ──────────────────────────────────────────────────

/** 一组至少这么多道首答才算一次练习：只点开看两题不该让节奏带的连续天数 +1。 */
export const QUICK_HISTORY_MIN_FIRST = 5;

/**
 * 按 setId 把事件合成 LanguageBatchHistory（新 → 旧），lib/training-rhythm.ts 的连续天数与热度原样可用。
 * completedCount 是首答条目数，successCount 是首答答对数（自评不算答对）；重出与当天再答都不计。
 */
export function quickHistory(events: readonly QuickEvent[]): LanguageBatchHistory[] {
  const sets = new Map<string, QuickEvent[]>();
  for (const event of events) {
    const list = sets.get(event.setId) ?? [];
    list.push(event);
    sets.set(event.setId, list);
  }
  const history: LanguageBatchHistory[] = [];
  for (const [setId, list] of sets) {
    const ordered = [...list].sort((a, b) => a.at.localeCompare(b.at));
    const firsts = new Map<string, QuickEvent>();
    for (const event of ordered) {
      if (event.action === "answer" && event.first && !firsts.has(event.itemId)) firsts.set(event.itemId, event);
    }
    if (firsts.size < QUICK_HISTORY_MIN_FIRST) continue;
    history.push({
      id: setId,
      date: quickDay(ordered[0].at),
      targetSize: ordered[0].setSize,
      completedCount: firsts.size,
      successCount: [...firsts.values()].filter((event) => event.passed === true).length,
      completedAt: ordered.at(-1)!.at,
    });
  }
  return history.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || a.id.localeCompare(b.id));
}

export type QuickSummaryInput = {
  pool: QuickPool;
  index: QuickIndex;
  progress: ReadonlyMap<string, LanguageItemProgress>;
  events: readonly QuickEvent[];
  legacy: QuickLegacyJudgments;
  day: string;
  /** 用来算每日新题额度（2N）；缺省 20。 */
  size?: QuickSetSize;
  typing?: boolean;
  topIssues?: readonly QuickTopIssue[];
  /** 由服务端判定（有无课程、课程是否过期）；缺省时 ready＝有可出题条目。 */
  ready?: boolean;
  stale?: boolean;
  curriculum?: QuickSummary["curriculum"];
};

const STAGES: readonly LanguageTrainingStage[] = ["unseen", "recognized", "correctable", "retrievable", "transferable", "stable"];

export function quickSummary(input: QuickSummaryInput): QuickSummary {
  const { pool, index, progress, events, legacy, day } = input;
  const size = input.size ?? 20;
  const typing = input.typing ?? true;
  const today = todayContext(events, day);
  const endOfToday = Date.parse(jstMidnightIso(day, 1));
  const endOfTomorrow = Date.parse(jstMidnightIso(day, 2));
  // 只数可出题、没被排除的条目：阶段分布与「新题 N 条」都要和练习里实际能见到的一致。
  const active = pool.items.filter((item) =>
    !excluded(item, progress, legacy) && availableCardTypes(item, index, { typing }).length > 0
  );
  const stageCounts = Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<LanguageTrainingStage, number>;
  let due = 0;
  let dueTomorrow = 0;
  let lapsedToday = 0;
  let newAvailable = 0;
  const seedRemaining = { unknown: 0, uncertain: 0 };
  for (const item of active) {
    const entry = progress.get(item.id);
    stageCounts[entry?.stage ?? "unseen"] += 1;
    const dueAt = dueTime(entry);
    if (!today.answered.has(item.id) && dueAt < endOfToday) due += 1;
    // 不排除今天答过的：今天答错的题正是明天要回来的那批。
    if (dueAt >= endOfToday && dueAt < endOfTomorrow) dueTomorrow += 1;
    if (today.lapsed.has(item.id)) lapsedToday += 1;
    if (isNew(entry) && !today.answered.has(item.id)) {
      newAvailable += 1;
      const judgment = legacy.get(item.id);
      if (judgment === "unknown" || judgment === "uncertain") seedRemaining[judgment] += 1;
    }
  }
  return {
    ready: input.ready ?? active.length > 0,
    stale: input.stale ?? false,
    day,
    due,
    dueTomorrow,
    lapsedToday,
    newAvailable,
    newToday: today.introduced.size,
    dailyNewLimit: QUICK_SELECT_RULES.dailyNewFactor * size,
    answeredToday: today.answered.size,
    firstPassToday: today.firstPasses,
    seedRemaining,
    stageCounts,
    drillable: active.length,
    excludedJaMeaning: pool.excludedJaMeaning,
    notebookParsed: pool.notebookParsed,
    history: quickHistory(events),
    topIssues: (input.topIssues ?? []).slice(0, 8),
    ...(input.curriculum ? { curriculum: input.curriculum } : {}),
  };
}
