import type { LanguageItemProgress, LanguageTrainingStage } from "./types.ts";
import { QUICK_DAY_START_HOUR, type QuickEvent } from "./quick-types.ts";

/*
 * 单条快练事件如何改变一个条目的掌握阶段与到期日。进度回放（服务端）逐条调用，事件按时间顺序给。
 *
 * 规则只看「首答」：同一天同一条目只有第一次作答算成败（first 由服务端写进事件），
 * 所以当天答错后再答对拿不到成功日——旧模式「改对覆盖失败」的问题在这里堵上。
 * 「一天」是练习日：日本时间 04:00 起算（QUICK_DAY_START_HOUR）。深夜 23:50 答错、0:05 再答对仍是同一天，
 * 不会因为跨过零点就「到期」并拿到成功日。到期日写成到期那个练习日的起点（JST 04:00）。
 */

export const QUICK_INTERVALS = { firstSuccess: 3, retrievable: 7, stable: 30, failure: 1 } as const;

/** 「太简单」之后多久回来验证一次：和 stable 同一个间隔，自报的「会」只是把验证推迟，不是免检。 */
export const QUICK_EASY_INTERVAL = QUICK_INTERVALS.stable;

/** 翻卡连续「记得」第 1、2、3+ 次的间隔。 */
const SELF_INTERVALS = [QUICK_INTERVALS.firstSuccess, QUICK_INTERVALS.retrievable, QUICK_INTERVALS.stable] as const;

const STAGE_ORDER: readonly LanguageTrainingStage[] = [
  "unseen",
  "recognized",
  "correctable",
  "retrievable",
  "transferable",
  "stable",
];

const rank = (stage: LanguageTrainingStage) => STAGE_ORDER.indexOf(stage);
const higher = (left: LanguageTrainingStage, right: LanguageTrainingStage) =>
  rank(left) >= rank(right) ? left : right;

const HOUR_MS = 3_600_000;
const JST_OFFSET_MS = 9 * HOUR_MS;
/** 练习日相对 UTC 的偏移：JST 时刻减去起点小时数后的日历日就是练习日。 */
const QUICK_DAY_OFFSET_MS = JST_OFFSET_MS - QUICK_DAY_START_HOUR * HOUR_MS;

function dayNumber(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, (month || 1) - 1, date || 1) / 86_400_000;
}

/** ISO 时刻 → 练习日（YYYY-MM-DD，日本时间 04:00 起算）。只做算术、不读当前时间；解析失败返回 ""。 */
export function quickDay(at: string) {
  const time = Date.parse(at);
  return Number.isFinite(time) ? new Date(time + QUICK_DAY_OFFSET_MS).toISOString().slice(0, 10) : "";
}

/** 某练习日加 offset 天后的起点（日本时间 04:00）的 UTC ISO。到期日、「今天结束」都用它。 */
export function quickDayStartIso(day: string, offset = 0) {
  const time = (dayNumber(day) + offset) * 86_400_000 - QUICK_DAY_OFFSET_MS;
  return new Date(time).toISOString();
}

/**
 * 某 JST 日加 offset 天后的日本时间 0 点（UTC ISO）。不读当前时间，只做日历运算。
 * 快练内部已不用它定到期（改用 quickDayStartIso）；保留导出给旧批次的降级排期等别处调用。
 */
export function jstMidnightIso(day: string, offset = 0) {
  // JST 0 点 = 前一天 UTC 15:00。
  const time = (dayNumber(day) + offset) * 86_400_000 - JST_OFFSET_MS;
  return new Date(time).toISOString();
}

function spanDays(days: readonly string[]) {
  if (days.length < 2) return 0;
  const numbers = days.map(dayNumber);
  return Math.max(...numbers) - Math.min(...numbers);
}

/**
 * 成功日 → 阶段。1 日 correctable、2 日 retrievable、3 日且跨 ≥7 天 stable。
 * 只有二选一可判分的条目猜对率 50%，要 4 日且跨 ≥14 天才 stable，否则掌握阶段会被瞎猜推高。
 */
function stageFromSuccessDays(days: readonly string[], binaryOnly: boolean): LanguageTrainingStage {
  const span = spanDays(days);
  const stable = binaryOnly ? days.length >= 4 && span >= 14 : days.length >= 3 && span >= 7;
  if (stable) return "stable";
  if (days.length >= 2) return "retrievable";
  return days.length === 1 ? "correctable" : "unseen";
}

/**
 * 应用一条快练事件，返回新的进度（不改入参）。
 * - triage：分流判断只影响新题先后，进度什么都不改（不算见过）。
 * - restore：撤销「不再出」，rejected 置回 false；不算见过、不计成败。
 * - 其余事件：seenCount +1、lastSeenAt 更新。
 * - suspend：标记 rejected 后返回，不计成败。
 * - easy（太简单）：算一次作答，阶段至少 recognized，30 天后回来验证；不产生成功日、不记失败。
 * - 非首答：只算见过。
 * - 翻卡自评：记得 → 阶段最高到 recognized、按 3/7/30 天排；模糊 → 明天再来、不记失败；忘了 → 记失败、明天再来。
 *   自评永远不产生成功日（看着答案自报的「记得」不能把条目推到 stable）。
 * - 自动判分：答对记一个成功日并按成功日数升阶；答错记失败、stable/transferable 退回 retrievable、明天再来，
 *   且成功日只留最近 1 个（上一次自动判分首答也错则清空）——答错要重新攒成功日，间隔回到 3 → 7 → 30。
 * transferable 不由快练产生（第一版没有迁移类题型）。
 *
 * 练习日从 event.at 算（quickDay）：ctx.day 只在 at 解析不了时兜底，调用方传日历日也不会把规则带偏。
 */
export function applyQuickEvent(
  state: LanguageItemProgress,
  event: QuickEvent,
  ctx: { binaryOnly: boolean; day?: string },
): LanguageItemProgress {
  if (event.action === "triage") return { ...state, successDates: [...state.successDates] };
  if (event.action === "restore") return { ...state, successDates: [...state.successDates], rejected: false };

  const day = quickDay(event.at) || ctx.day || "";
  const next: LanguageItemProgress = {
    ...state,
    successDates: [...state.successDates],
    seenCount: state.seenCount + 1,
    lastSeenAt: event.at,
  };
  if (event.action === "suspend") {
    next.rejected = true;
    return next;
  }
  if (event.action === "easy") {
    next.attemptCount = (state.attemptCount ?? 0) + 1;
    next.stage = higher(state.stage, "recognized");
    next.lastOutcome = "easy";
    next.nextDueAt = quickDayStartIso(day, QUICK_EASY_INTERVAL);
    return next;
  }
  if (!event.first) return next;
  next.attemptCount = (state.attemptCount ?? 0) + 1;

  if (event.type === "flip" || (event.passed === undefined && event.rating)) {
    next.lastOutcome = "self";
    if (event.rating === "remembered") {
      next.stage = higher(state.stage, "recognized");
      next.selfStreak = (state.selfStreak ?? 0) + 1;
      const interval = SELF_INTERVALS[Math.min(next.selfStreak, SELF_INTERVALS.length) - 1];
      next.nextDueAt = quickDayStartIso(day, interval);
    } else if (event.rating === "forgot") {
      next.selfStreak = 0;
      next.failureCount = state.failureCount + 1;
      if (state.stage === "stable" || state.stage === "transferable") next.stage = "retrievable";
      next.nextDueAt = quickDayStartIso(day, QUICK_INTERVALS.failure);
    } else {
      // 模糊（或缺评分）：明天再看，不算失败，也不延长间隔。
      next.selfStreak = 0;
      next.nextDueAt = quickDayStartIso(day, QUICK_INTERVALS.failure);
    }
    return next;
  }

  next.lastGradedDay = day;
  if (event.passed) {
    next.lastOutcome = "pass";
    next.successCount = state.successCount + 1;
    next.firstSuccessAt = state.firstSuccessAt ?? event.at;
    if (!next.successDates.includes(day)) next.successDates.push(day);
    next.successDates.sort();
    next.stage = higher(state.stage, stageFromSuccessDays(next.successDates, ctx.binaryOnly));
    const interval = next.stage === "stable"
      ? QUICK_INTERVALS.stable
      : next.successDates.length >= 2
        ? QUICK_INTERVALS.retrievable
        : QUICK_INTERVALS.firstSuccess;
    next.nextDueAt = quickDayStartIso(day, interval);
    return next;
  }
  next.lastOutcome = "fail";
  next.failureCount = state.failureCount + 1;
  // 失误要有代价：只留最近一个成功日，stable 必须在这次失败之后再攒 2 个成功日（跨 ≥7 天）。
  // 连续两次首答都错说明那个成功日也不可信，清空后从 3 天间隔重新爬。
  next.successDates = state.lastOutcome === "fail" ? [] : next.successDates.sort().slice(-1);
  if (state.stage === "stable" || state.stage === "transferable") next.stage = "retrievable";
  next.nextDueAt = quickDayStartIso(day, QUICK_INTERVALS.failure);
  return next;
}
