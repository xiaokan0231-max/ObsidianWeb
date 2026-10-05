import type {
  LanguageBatchHistory,
  LanguageItemProgress,
  LanguageScanJudgment,
  LanguageTrainingStage,
} from "./types.ts";
import type {
  QuickCard,
  QuickCardReason,
  QuickEvent,
  QuickGroup,
  QuickItem,
  QuickItemBrief,
  QuickLegacyJudgments,
  QuickNextSet,
  QuickPool,
  QuickSet,
  QuickSetSize,
  QuickSummary,
  QuickTopIssue,
  QuickTriageJudgment,
} from "./quick-types.ts";
import type { QuickIndex } from "./quick-cards.ts";
import { availableCardTypes, buildQuickCard, chooseCardType } from "./quick-cards.ts";
import { isCognateItem } from "./quick-items.ts";
import { quickDay, quickDayStartIso } from "./quick-progress.ts";
import { isKanjiOnly, seededShuffle, stableSeed } from "./quick-text.ts";

/*
 * 一组快练卡片的构成、总览数字与历史合成。服务端取题与汇总都只调这里。
 *
 * 一组 N 题的顺序是「先还账，再学新」：
 * ① 到期（到期日 ≤ 今天、今天还没答过）：到期早、失败多、优先级高的在前；同一错误型软上限 4，
 *    否则助词类一次到期几十条时整组都是助词。到期很多（> 2N）时进入追赶模式，本组不放新题。
 * ② 今天答错、还没答对的：≤ round(N×0.2)。今天再答不计成败（首答已定），只为当天多见一次。
 * ③ 新题：≤ round(N×0.3)，且受每日新题额度 2N 约束（extra 时本组再放宽 N）。
 *    本人标过「不会 / 犹豫」与听解标记的种子先取、不受来源配额限制，其余再按来源配额分。
 * ④ 仍不满：先放回被软上限挡下的到期题，再补新题（仍受每日额度约束），最后才补明天到期的（≤ round(N×0.3)）。
 *    一天做多组时，后几组若先补明天到期，七成会是提前复习、间隔被整体压短，新题额度却用不完。
 * 每组「哪个更自然」二选一 ≤ round(N×0.4)：猜对率 50%，多了整组像在抛硬币；超出的条目换别的补。
 * 每日额度的理由：新题第 3 天集中到期。一天做 5 组、每组都补满新题，第 4 天会到期上百条。
 *
 * 「今天」一律是练习日（日本时间 04:00 起算，见 quick-progress.ts），由参数 day 给出，不读当前时间：
 * 同一输入永远得到同一组。
 */

export const QUICK_SELECT_RULES = {
  newShare: 0.3,
  lapsedShare: 0.2,
  typedShare: 0.2,
  /** 不满时补「明天到期提前出」的上限。 */
  earlyShare: 0.3,
  /** 「哪个更自然」二选一的上限。 */
  naturalShare: 0.4,
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

/** 新题档位里「本人明确标过」的种子（不会 / 犹豫 / 听解标记）：先取，不受来源配额限制。 */
export const QUICK_SEED_MAX_TIER = 2;
/** 自报「会」（旧批次或分流）的档位：排在所有新题之后，出题时直接用辨析层验证。 */
export const QUICK_KNOWN_TIER = 7;

/** 每日新题额度：summary 与 GET set 同一口径。 */
export function quickDailyNewLimit(size: QuickSetSize, extra = false) {
  return QUICK_SELECT_RULES.dailyNewFactor * size + (extra ? size : 0);
}

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

/**
 * 旧批次 scan 判断与分流判断合并成选题用的一张表：分流是更新的本人判断，同一条目以它为准。
 * 旧批次的 reject 只在分流没有给出新判断时保留。
 */
export function mergeJudgments(
  legacy: QuickLegacyJudgments,
  triage: ReadonlyMap<string, QuickTriageJudgment>,
): Map<string, LanguageScanJudgment> {
  const merged = new Map<string, LanguageScanJudgment>(legacy);
  for (const [itemId, judgment] of triage) merged.set(itemId, judgment);
  return merged;
}

export type QuickSelectInput = {
  pool: QuickPool;
  index: QuickIndex;
  progress: ReadonlyMap<string, LanguageItemProgress>;
  /** 全部快练事件，按时间顺序（collectQuickEvents 的输出）。 */
  events: readonly QuickEvent[];
  /** 选题用的判断：服务端传 mergeJudgments(旧批次, 分流) 的结果。 */
  legacy: QuickLegacyJudgments;
  /** 练习日。 */
  day: string;
  size: QuickSetSize;
  typing: boolean;
  extra: boolean;
  setId: string;
  /** 课程 profile 的高频问题；用来判定新题里的「高频错误型」。 */
  topIssues?: readonly QuickTopIssue[];
  /** 针对练习：只在 group=error_patch 且 pattern=focus 的条目里出题。 */
  focus?: string;
};

// ── 当日事件 ────────────────────────────────────────────────────

type TodayContext = {
  /** 今天作答过的条目（任何一次 answer 或「太简单」，含重出）。 */
  answered: Set<string>;
  /** 今天最后一次作答仍未答对的条目 → 那次作答时刻。 */
  lapsed: Map<string, string>;
  /** 第一次首答（或「太简单」）发生在今天的条目：今天引入的新题，计入每日额度。 */
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
    const easy = event.action === "easy";
    if (event.action !== "answer" && !easy) continue;
    const today = quickDay(event.at) === day;
    // 新题上按「太简单」也用掉了一个新题名额：它从此不再是新题。
    if ((event.first || easy) && !everFirst.has(event.itemId)) {
      everFirst.add(event.itemId);
      if (today) context.introduced.add(event.itemId);
    }
    if (!today) continue;
    context.answered.add(event.itemId);
    if (easy) {
      context.lapsed.delete(event.itemId);
      continue;
    }
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

/**
 * 有进度时只看回放结果：旧批次的 reject 在回放里已经写成 rejected，之后的「撤销排除」能把它置回。
 * 没有进度条目时（测试、回放前）才退回读旧批次的 reject。
 */
function excluded(item: QuickItem, progress: QuickSelectInput["progress"], legacy: QuickLegacyJudgments) {
  const entry = progress.get(item.id);
  return entry ? entry.rejected === true : legacy.get(item.id) === "reject";
}

/** 自报「会」的新题与「太简单」回来的条目：第一张卡用辨析层验证，不信任自报。 */
function needsVerify(item: QuickItem, entry: LanguageItemProgress | undefined, legacy: QuickLegacyJudgments) {
  return entry?.lastOutcome === "easy" || (isNew(entry) && legacy.get(item.id) === "known");
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
 * 0 自报「不会」→ 1「犹豫」→ 7 自报「会」→ 2 听解标记 → 6 送分题 → 3 単語文法帳 ★★ 或跨 ≥2 场面试
 * → 4 ★ 或高频错误型 → 5 其余。判断来自旧批次 scan 或分流（分流覆盖旧批次）。
 * 送分题＝同形短语（isCognateItem）与纯汉字面试官短语：对中文母语者看字就懂，价值最低。
 * 「会」排在所有新题之后：本人说会的不必抢没见过的条目的位置，但也不免检——出题时直接用辨析层验证。
 * 判断先于听解标记：这是本人对这一条的直接回答，比表格里的标记更新。
 */
export function quickNewTier(item: QuickItem, legacy: QuickLegacyJudgments, frequent: ReadonlySet<string>) {
  const judgment = legacy.get(item.id);
  if (judgment === "unknown") return 0;
  if (judgment === "uncertain") return 1;
  if (judgment === "known") return QUICK_KNOWN_TIER;
  if (item.listeningMark) return 2;
  if (isCognateItem(item) || (item.group === "interviewer_phrase" && isKanjiOnly(item.ja))) return 6;
  if (item.stars === 2 || item.interviewCount >= 2) return 3;
  if (item.stars === 1 || (item.group === "error_patch" && frequent.has(item.pattern))) return 4;
  return 5;
}

type Ranked = { item: QuickItem; tier: number };

/** 新题队列的顺序：档位 → 优先级 → 固定哈希。分流屏与 GET set 共用，「一屏过一遍」看到的正是接下来要出的。 */
function rankNew(items: readonly QuickItem[], legacy: QuickLegacyJudgments, frequent: ReadonlySet<string>): Ranked[] {
  return items
    .map((item) => ({ item, tier: quickNewTier(item, legacy, frequent) }))
    .sort((a, b) => a.tier - b.tier
      || b.item.priority - a.item.priority
      || stableSeed(a.item.id) - stableSeed(b.item.id)
      || a.item.id.localeCompare(b.item.id));
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

type QuickPlan = Pick<QuickSet, "composition" | "limits"> & { cards: QuickCard[] };

/** 选题本体（不排组内顺序）。selectQuickSet 与 summary 的 nextSet 共用，两边的构成数字因此一定一致。 */
function planQuickSet(input: Omit<QuickSelectInput, "setId">): QuickPlan {
  const { pool, index, progress, events, legacy, day, size, typing, extra } = input;
  const focus = input.focus || undefined;
  const rules = QUICK_SELECT_RULES;
  const newCap = Math.round(size * rules.newShare);
  const lapsedCap = Math.round(size * rules.lapsedShare);
  const earlyCap = Math.round(size * rules.earlyShare);
  const naturalCap = Math.round(size * rules.naturalShare);
  let typedLeft = Math.round(size * rules.typedShare);
  const dailyNewLimit = quickDailyNewLimit(size, extra);

  const today = todayContext(events, day);
  const endOfToday = Date.parse(quickDayStartIso(day, 1));
  const endOfTomorrow = Date.parse(quickDayStartIso(day, 2));
  const items = pool.items.filter((item) =>
    !excluded(item, progress, legacy)
    && (!focus || (item.group === "error_patch" && item.pattern === focus))
  );
  const byDue = compareDue(progress, day);

  const due = items
    .filter((item) => !today.answered.has(item.id) && dueTime(progress.get(item.id)) < endOfToday)
    .sort(byDue);
  // 针对练习是本人点名要练这一型：不进追赶模式，到期与新题都在这一型里取。
  const catchUp = !focus && due.length > rules.catchUpFactor * size;
  const frequent = frequentPatterns(pool.items, input.topIssues);
  const ranked = rankNew(items.filter((item) => isNew(progress.get(item.id)) && !today.answered.has(item.id)), legacy, frequent);
  const tierOf = new Map(ranked.map((entry) => [entry.item.id, entry.tier]));
  const newQueue = ranked.map((entry) => entry.item);
  const newQuota = Math.max(0, dailyNewLimit - today.introduced.size);

  const cards: QuickCard[] = [];
  const picked = new Set<string>();
  const tried = new Set<string>();
  const patternCount = new Map<string, number>();
  const newPatternCount = new Map<string, number>();
  let newPicked = 0;
  let naturalTaken = 0;

  const room = () => size - cards.length;
  const patternOf = (item: QuickItem) => (item.group === "error_patch" && item.pattern ? item.pattern : "");

  /** 出一张卡；出不了（无可用题型、不变式不过、二选一已满）就记下并跳过，由下一个候选补位。 */
  const take = (item: QuickItem, reason: QuickCardReason) => {
    if (picked.has(item.id) || tried.has(item.id)) return false;
    tried.add(item.id);
    const entry = progress.get(item.id);
    const stage: LanguageTrainingStage = entry?.stage ?? "unseen";
    const verify = needsVerify(item, entry, legacy);
    const type = chooseCardType(item, stage, { index, typing, day, typedLeft, verify });
    let card = type ? buildQuickCard(item, type, { index, day, reason, stage }) : null;
    if (!card && type === "short_input") {
      const fallback = chooseCardType(item, stage, { index, typing, day, typedLeft: 0, verify });
      card = fallback ? buildQuickCard(item, fallback, { index, day, reason, stage }) : null;
    }
    if (!card) return false;
    // 针对练习只有这一型，很多型的条目只有二选一；套上限会让一组只剩几题。
    if (card.type === "natural_choice" && !focus) {
      if (naturalTaken >= naturalCap) return false;
      naturalTaken += 1;
    }
    if (card.type === "short_input") typedLeft -= 1;
    cards.push(card);
    picked.add(item.id);
    const pattern = patternOf(item);
    if (pattern) patternCount.set(pattern, (patternCount.get(pattern) ?? 0) + 1);
    return true;
  };

  const lapsed = items
    .filter((item) => today.lapsed.has(item.id))
    .sort((a, b) => today.lapsed.get(a.id)!.localeCompare(today.lapsed.get(b.id)!) || a.id.localeCompare(b.id));
  const newLeft = () => newQueue.some((item) => !picked.has(item.id) && !tried.has(item.id));
  const finish = (): QuickPlan => {
    const composition: Record<QuickCardReason, number> = { due: 0, lapsed: 0, new: 0, early: 0 };
    for (const card of cards) composition[card.reason] += 1;
    return {
      cards,
      composition,
      limits: {
        newToday: today.introduced.size,
        dailyNewLimit,
        // 额度用完而题库里还有新题：界面据此提示「今天新题额度已用完」并给「再加一组新题」。
        newExhausted: !catchUp && newQuota - newPicked <= 0 && newLeft(),
      },
    };
  };

  if (focus) {
    // 同一套 到期 → 今日答错 → 新题，只是候选限定在这一型，同型上限与来源配额都不适用；新题仍计入每日额度。
    for (const item of due) {
      if (!room()) break;
      take(item, "due");
    }
    let lapsedTaken = 0;
    for (const item of lapsed) {
      if (lapsedTaken >= lapsedCap || !room()) break;
      if (take(item, "lapsed")) lapsedTaken += 1;
    }
    for (const item of newQueue) {
      if (!room() || newPicked >= newQuota) break;
      if (take(item, "new")) newPicked += 1;
    }
    return finish();
  }

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
  let lapsedTaken = 0;
  for (const item of lapsed) {
    // 和到期题一样不占给新题留的位子：今天错过的题已经在当天多见过一次了。
    if (lapsedTaken >= lapsedCap || cards.length >= size - keepNew) break;
    if (take(item, "lapsed")) lapsedTaken += 1;
  }

  // ③ 新题：种子先取，其余按来源配额 + 同型上限，名额用不完的按先后顺序让给别家
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
    let taken = 0;
    // 本人标过「不会 / 犹豫」或听解标记的条目：按配额分会让它们排一个多月，所以先取，只保留同型上限。
    for (const item of newQueue) {
      if (taken >= target || (tierOf.get(item.id) ?? 0) > QUICK_SEED_MAX_TIER) break;
      if (picked.has(item.id) || tried.has(item.id)) continue;
      if (takeNew(item)) taken += 1;
    }
    const remaining = newQueue.filter((item) => !picked.has(item.id) && !tried.has(item.id));
    // 自报「会」的不参与来源配额：否则某个来源的普通新题出完后，配额会把它的「会」提前拉出来，排最后就落空了。
    // 它们只在下面「让给别家」的补位里按先后出现，也就是所有别的新题都出不了时。
    const ordinary = remaining.filter((item) => (tierOf.get(item.id) ?? 0) < QUICK_KNOWN_TIER);
    const available = { patch: 0, phrase: 0, notebook: 0, pattern: 0 };
    for (const item of ordinary) available[quickSourceOf(item.group)] += 1;
    const quota = apportion(target - taken, available);
    for (const source of SOURCE_ORDER) {
      let share = 0;
      for (const item of ordinary) {
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

  // ④ 仍不满：被软上限挡下的到期题 → 更多新题 → 明天到期（≤ round(N×0.3)）
  for (const item of overflow) {
    if (!room()) break;
    take(item, "due");
  }
  if (!catchUp && room()) pickNew(room());
  if (room()) {
    const tomorrow = items
      .filter((item) => {
        if (today.answered.has(item.id)) return false;
        const time = dueTime(progress.get(item.id));
        return time >= endOfToday && time < endOfTomorrow;
      })
      .sort(byDue);
    let earlyTaken = 0;
    for (const item of tomorrow) {
      if (!room() || earlyTaken >= earlyCap) break;
      if (take(item, "early")) earlyTaken += 1;
    }
  }
  return finish();
}

export function selectQuickSet(input: QuickSelectInput): QuickSet {
  const { day, size, setId } = input;
  const plan = planQuickSet(input);
  return {
    setId,
    day,
    size,
    cards: spread(plan.cards, `${day}|${setId}`),
    composition: plan.composition,
    limits: plan.limits,
    ...(input.focus ? { focus: input.focus } : {}),
  };
}

/** 下一组的预计构成：与 selectQuickSet 同一套选题（不带 extra、不针对某型），无副作用。 */
export function quickNextSet(input: Omit<QuickSelectInput, "setId" | "extra" | "focus">): QuickNextSet {
  const { cards, composition } = planQuickSet({ ...input, extra: false });
  return {
    total: cards.length,
    due: composition.due,
    lapsed: composition.lapsed,
    fresh: composition.new,
    early: composition.early,
  };
}

// ── 针对练习与分流 ──────────────────────────────────────────────

/**
 * 每个改错型可出题的条目数（未排除、当前设置下有可用题型）。服务端据此给 topIssues 填 focus / itemCount：
 * 没有可出题条目的型不给「练这个」。
 */
export function quickFocusOptions(
  pool: QuickPool,
  index: QuickIndex,
  progress: ReadonlyMap<string, LanguageItemProgress>,
  typing: boolean,
  legacy: QuickLegacyJudgments = new Map(),
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of pool.items) {
    if (item.group !== "error_patch" || !item.pattern) continue;
    if (excluded(item, progress, legacy) || !availableCardTypes(item, index, { typing }).length) continue;
    counts.set(item.pattern, (counts.get(item.pattern) ?? 0) + 1);
  }
  return counts;
}

/**
 * 给 topIssues 填上 focus 与 itemCount：问题的 key 或 label 正是某个有可出题条目的改错型时才可以针对练习。
 * kind 已由调用方给出时不动；没给且能针对练习时记为 language。
 */
export function annotateQuickTopIssues(
  issues: readonly QuickTopIssue[],
  options: ReadonlyMap<string, number>,
): QuickTopIssue[] {
  return issues.map((issue) => {
    const focus = [issue.key, issue.label].find((pattern) => (options.get(pattern) ?? 0) > 0);
    if (!focus) return { ...issue };
    return { ...issue, kind: issue.kind ?? "language", focus, itemCount: options.get(focus)! };
  });
}

export function quickItemBrief(item: QuickItem): QuickItemBrief {
  return {
    itemId: item.id,
    group: item.group,
    ja: item.ja,
    reading: item.reading,
    meaning: item.meaning,
    ...(item.patch ? { wrong: item.patch.wrong } : {}),
  };
}

export type QuickTriageInput = {
  pool: QuickPool;
  index: QuickIndex;
  progress: ReadonlyMap<string, LanguageItemProgress>;
  /** 合并后的判断（mergeJudgments）：已有任何判断的条目不再进分流。 */
  legacy: QuickLegacyJudgments;
  typing: boolean;
  size: number;
  topIssues?: readonly QuickTopIssue[];
};

/** 分流候选：没作答过、没有任何判断、未被排除、当前设置下可出题，按新题队列的顺序。 */
function triageCandidates(input: Omit<QuickTriageInput, "size">) {
  const { pool, index, progress, legacy, typing } = input;
  const items = pool.items.filter((item) =>
    isNew(progress.get(item.id))
    && !legacy.has(item.id)
    && !excluded(item, progress, legacy)
    && availableCardTypes(item, index, { typing }).length > 0
  );
  return rankNew(items, legacy, frequentPatterns(pool.items, input.topIssues)).map((entry) => entry.item);
}

/**
 * 「一屏过一遍」的下一批：取新题队列最前面、还没分流过的 size 条。
 * 用同一顺序是为了先分流马上就要出的题——排在几百条之后的，分不分流这几周都碰不到。
 */
export function selectTriageItems(input: QuickTriageInput): QuickItemBrief[] {
  return triageCandidates(input).slice(0, Math.max(0, input.size)).map(quickItemBrief);
}

// ── 历史与汇总 ──────────────────────────────────────────────────

/** 一组至少这么多道首答才算一次练习：只点开看两题不该让节奏带的连续天数 +1。 */
export const QUICK_HISTORY_MIN_FIRST = 5;

/**
 * 按 setId 把事件合成 LanguageBatchHistory（新 → 旧），lib/training-rhythm.ts 的连续天数与热度原样可用。
 * completedCount 是首答条目数，successCount 是首答答对数（自评不算答对），gradedCount 是自动判分的首答数
 * （「答对 7 / 9」的分母，和小结屏一致）；重出与当天再答都不计。date 是第一条事件的练习日。
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
    const answers = [...firsts.values()];
    history.push({
      id: setId,
      date: quickDay(ordered[0].at),
      targetSize: ordered[0].setSize,
      completedCount: firsts.size,
      successCount: answers.filter((event) => event.passed === true).length,
      gradedCount: answers.filter((event) => event.passed !== undefined).length,
      completedAt: ordered.at(-1)!.at,
    });
  }
  return history.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "") || a.id.localeCompare(b.id));
}

export type QuickSummaryInput = {
  pool: QuickPool;
  index: QuickIndex;
  progress: ReadonlyMap<string, LanguageItemProgress>;
  /** 全部快练事件（含指向已不存在条目的，orphanEvents 要数它们）。 */
  events: readonly QuickEvent[];
  /** 合并后的判断（mergeJudgments），与 GET set 传的同一份。 */
  legacy: QuickLegacyJudgments;
  day: string;
  /** 本人设置的组大小：算每日新题额度（2N）与 nextSet；缺省 20。 */
  size?: QuickSetSize;
  typing?: boolean;
  topIssues?: readonly QuickTopIssue[];
  /** 由服务端判定（有无课程、课程是否过期）；缺省时 ready＝有可出题条目。 */
  ready?: boolean;
  stale?: boolean;
  curriculum?: QuickSummary["curriculum"];
};

const STAGES: readonly LanguageTrainingStage[] = ["unseen", "recognized", "correctable", "retrievable", "transferable", "stable"];

/** 已排除清单最多带这么多条（供恢复）；总数另给。 */
export const QUICK_SUSPENDED_LIST_LIMIT = 50;
/** dueSoon 的天数：[0]＝今天（含已逾期）。 */
export const QUICK_DUE_SOON_DAYS = 7;

export function quickSummary(input: QuickSummaryInput): QuickSummary {
  const { pool, index, progress, events, legacy, day } = input;
  const size = input.size ?? 20;
  const typing = input.typing ?? true;
  const today = todayContext(events, day);
  const dayEnds = Array.from({ length: QUICK_DUE_SOON_DAYS }, (_, offset) => Date.parse(quickDayStartIso(day, offset + 1)));
  // 只数可出题、没被排除的条目：阶段分布与「新题 N 条」都要和练习里实际能见到的一致。
  const active = pool.items.filter((item) =>
    !excluded(item, progress, legacy) && availableCardTypes(item, index, { typing }).length > 0
  );
  const stageCounts = Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<LanguageTrainingStage, number>;
  const dueSoon = dayEnds.map(() => 0);
  let lapsedToday = 0;
  let newAvailable = 0;
  const seedRemaining = { unknown: 0, uncertain: 0 };
  for (const item of active) {
    const entry = progress.get(item.id);
    stageCounts[entry?.stage ?? "unseen"] += 1;
    const dueAt = dueTime(entry);
    if (dueAt < dayEnds[0]) {
      if (!today.answered.has(item.id)) dueSoon[0] += 1;
    } else {
      // 不排除今天答过的：今天答错的题正是明天要回来的那批。
      const offset = dayEnds.findIndex((end) => dueAt < end);
      if (offset > 0) dueSoon[offset] += 1;
    }
    if (today.lapsed.has(item.id)) lapsedToday += 1;
    if (isNew(entry) && !today.answered.has(item.id)) {
      newAvailable += 1;
      const judgment = legacy.get(item.id);
      if (judgment === "unknown" || judgment === "uncertain") seedRemaining[judgment] += 1;
    }
  }
  const suspendedItems = pool.items
    .filter((item) => excluded(item, progress, legacy))
    .sort((a, b) => (progress.get(b.id)?.lastSeenAt ?? "").localeCompare(progress.get(a.id)?.lastSeenAt ?? "")
      || a.id.localeCompare(b.id));
  const poolIds = new Set(pool.items.map((item) => item.id));
  const focusOptions = quickFocusOptions(pool, index, progress, typing, legacy);
  return {
    ready: input.ready ?? active.length > 0,
    stale: input.stale ?? false,
    day,
    due: dueSoon[0],
    dueTomorrow: dueSoon[1],
    lapsedToday,
    newAvailable,
    newToday: today.introduced.size,
    dailyNewLimit: quickDailyNewLimit(size),
    answeredToday: today.answered.size,
    firstPassToday: today.firstPasses,
    seedRemaining,
    stageCounts,
    drillable: active.length,
    excludedJaMeaning: pool.excludedJaMeaning,
    notebookParsed: pool.notebookParsed,
    history: quickHistory(events),
    topIssues: annotateQuickTopIssues((input.topIssues ?? []).slice(0, 8), focusOptions),
    ...(input.curriculum ? { curriculum: input.curriculum } : {}),
    nextSet: quickNextSet({ pool, index, progress, events, legacy, day, size, typing, topIssues: input.topIssues }),
    dueSoon,
    suspended: suspendedItems.slice(0, QUICK_SUSPENDED_LIST_LIMIT).map(quickItemBrief),
    suspendedCount: suspendedItems.length,
    triageRemaining: triageCandidates({ pool, index, progress, legacy, typing, topIssues: input.topIssues }).length,
    orphanEvents: events.filter((event) => !poolIds.has(event.itemId)).length,
    glossed: pool.glossed ?? 0,
  };
}
