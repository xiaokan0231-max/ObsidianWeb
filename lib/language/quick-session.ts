import type { LanguageTrainingStage } from "./types.ts";
import type {
  QuickAnswerInput,
  QuickAnswerResult,
  QuickCard,
  QuickCardType,
  QuickSelfRating,
  QuickSet,
} from "./quick-types.ts";
import { gradeQuickCard } from "./quick-cards.ts";
import { seededShuffle } from "./quick-text.ts";

/*
 * 客户端一组快练的会话状态：纯 reducer，不发请求、不读时间。
 *
 * - 首答定成败：本地判分只用于即时反馈，真正的 passed / first 由服务端按日志重算。
 * - 答错（含「不知道」、翻卡模糊/忘了）的卡隔至少 3 题再出一次：紧接着重出只是在看刚才的答案，
 *   隔几题才是一次真正的回想。剩余不足 3 题时排在末尾。重出不计成败、选项重排，重出再错不再追加。
 * - 「这题有问题」（suspend）随时可按：干扰项没有人工校验，必须有出口；它的重出也一并撤掉。
 *
 * eventId 默认按「setId.序号」生成：同一组里唯一，且重发时不变，服务端据此去重。
 */

export const QUICK_RETRY_GAP = 3;

export type QuickSessionEntry = {
  /** `${cardId}:${round}`：同一卡片首轮与重出各一条。 */
  key: string;
  /** 本轮显示用的卡片：重出时选项已重排。 */
  card: QuickCard;
  /** 0＝首轮；1＝重出（不计成败，只显示）。 */
  round: 0 | 1;
};

export type QuickSessionRecord = {
  key: string;
  cardId: string;
  itemId: string;
  type: QuickCardType;
  grading: QuickCard["grading"];
  round: 0 | 1;
  action: "answer" | "suspend";
  response: string;
  rating?: QuickSelfRating;
  gaveUp?: boolean;
  /** 本地判分（翻卡与 suspend 没有）。 */
  passed?: boolean;
  /** 要提交给服务端的一条。 */
  input: QuickAnswerInput;
};

export type QuickSessionPhase = "question" | "feedback" | "ended";

export type QuickSessionState = {
  setId: string;
  day: string;
  size: number;
  queue: QuickSessionEntry[];
  cursor: number;
  phase: QuickSessionPhase;
  /** 翻卡是否已揭晓背面（未揭晓时不收自评）。 */
  revealed: boolean;
  records: QuickSessionRecord[];
  /** 已经安排过重出的条目：每条最多重出一次。 */
  retried: string[];
  suspended: string[];
  /** 已分配的 eventId 序号。 */
  seq: number;
};

export type QuickSessionAction =
  | { type: "reveal" }
  | { type: "answer"; response?: string; rating?: QuickSelfRating; elapsedMs?: number; eventId?: string }
  | { type: "gaveUp"; elapsedMs?: number; eventId?: string }
  | { type: "suspend"; elapsedMs?: number; eventId?: string }
  | { type: "next" }
  | { type: "end" };

export function createQuickSession(set: Pick<QuickSet, "setId" | "day" | "size" | "cards">): QuickSessionState {
  return {
    setId: set.setId,
    day: set.day,
    size: set.size,
    queue: set.cards.map((card) => ({ key: `${card.cardId}:0`, card, round: 0 })),
    cursor: 0,
    phase: set.cards.length ? "question" : "ended",
    revealed: false,
    records: [],
    retried: [],
    suspended: [],
    seq: 0,
  };
}

export function currentQuickEntry(state: QuickSessionState): QuickSessionEntry | undefined {
  return state.phase === "ended" ? undefined : state.queue[state.cursor];
}

/** 全部要提交的作答（按作答顺序）。客户端按 eventId 记已发送，失败重发同一条即可。 */
export function quickSessionAnswers(state: QuickSessionState): QuickAnswerInput[] {
  return state.records.map((record) => record.input);
}

/** eventId 的字符集与服务端校验一致（字母数字开头，只含 . _ : -，≤128）。 */
function nextEventId(state: QuickSessionState, override?: string) {
  if (override) return override;
  const base = state.setId.replace(/[^A-Za-z0-9._:-]/gu, "_").replace(/^[^A-Za-z0-9]+/u, "").slice(0, 100) || "set";
  return `${base}.${state.seq + 1}`;
}

/** 重出时选项重排，且正确答案换个位置：同一位置再出一次，靠记位置也能答对。 */
function reshuffle(card: QuickCard): QuickCard {
  if (card.options.length < 2) return card;
  const identity = card.options.map((_, index) => index);
  let order = seededShuffle(identity, `${card.cardId}|retry`);
  const answerAt = card.options.findIndex((option) => option === card.answer);
  if (order.every((value, index) => value === index) || (answerAt >= 0 && order[answerAt] === answerAt)) {
    order = [...identity.slice(1), identity[0]];
  }
  return {
    ...card,
    options: order.map((position) => card.options[position]),
    ...(card.optionMarks ? { optionMarks: order.map((position) => card.optionMarks![position]) } : {}),
  };
}

function advance(state: QuickSessionState): QuickSessionState {
  const cursor = state.cursor + 1;
  return { ...state, cursor, phase: cursor >= state.queue.length ? "ended" : "question", revealed: false };
}

function record(
  state: QuickSessionState,
  entry: QuickSessionEntry,
  values: {
    action: "answer" | "suspend";
    response: string;
    rating?: QuickSelfRating;
    gaveUp?: boolean;
    passed?: boolean;
    elapsedMs?: number;
    eventId?: string;
  },
): QuickSessionState {
  const { card } = entry;
  const eventId = nextEventId(state, values.eventId);
  const input: QuickAnswerInput = {
    eventId,
    itemId: card.itemId,
    type: card.type,
    ...(values.response ? { response: values.response } : {}),
    ...(values.rating ? { rating: values.rating } : {}),
    ...(values.gaveUp ? { gaveUp: true } : {}),
    ...(values.action === "suspend" ? { suspend: true } : {}),
    ...(values.elapsedMs !== undefined ? { elapsedMs: values.elapsedMs } : {}),
  };
  const next: QuickSessionRecord = {
    key: entry.key,
    cardId: card.cardId,
    itemId: card.itemId,
    type: card.type,
    grading: card.grading,
    round: entry.round,
    action: values.action,
    response: values.response,
    ...(values.rating ? { rating: values.rating } : {}),
    ...(values.gaveUp ? { gaveUp: true } : {}),
    ...(values.passed !== undefined ? { passed: values.passed } : {}),
    input,
  };
  return { ...state, records: [...state.records, next], seq: state.seq + 1 };
}

function missed(passed: boolean | undefined, rating: QuickSelfRating | undefined) {
  return passed === false || rating === "fuzzy" || rating === "forgot";
}

/** 首轮答错就安排一次重出：插在当前位置之后第 QUICK_RETRY_GAP 题之后；剩余不够就排末尾。 */
function scheduleRetry(state: QuickSessionState, entry: QuickSessionEntry): QuickSessionState {
  const itemId = entry.card.itemId;
  if (entry.round !== 0 || state.retried.includes(itemId) || state.suspended.includes(itemId)) return state;
  const retry: QuickSessionEntry = { key: `${entry.card.cardId}:1`, card: reshuffle(entry.card), round: 1 };
  const queue = [...state.queue];
  const remaining = queue.length - state.cursor - 1;
  if (remaining < QUICK_RETRY_GAP) queue.push(retry);
  else queue.splice(state.cursor + 1 + QUICK_RETRY_GAP, 0, retry);
  return { ...state, queue, retried: [...state.retried, itemId] };
}

export function quickSessionReducer(state: QuickSessionState, action: QuickSessionAction): QuickSessionState {
  if (action.type === "end") return state.phase === "ended" ? state : { ...state, phase: "ended" };
  const entry = currentQuickEntry(state);
  if (!entry) return state;
  const { card } = entry;

  switch (action.type) {
    case "reveal":
      return state.phase === "question" && card.type === "flip" && !state.revealed ? { ...state, revealed: true } : state;

    case "answer": {
      if (state.phase !== "question") return state;
      if (card.type === "flip") {
        // 先回想、再揭晓、再自评：没揭晓就按数字键不算数。
        if (!state.revealed || !action.rating) return state;
        const next = record(state, entry, {
          action: "answer", response: "", rating: action.rating, elapsedMs: action.elapsedMs, eventId: action.eventId,
        });
        const shown = { ...next, phase: "feedback" as const };
        return missed(undefined, action.rating) ? scheduleRetry(shown, entry) : shown;
      }
      const response = (action.response ?? "").trim();
      if (!response) return state;
      const { passed } = gradeQuickCard(card, { response });
      const next = record(state, entry, {
        action: "answer", response, passed, elapsedMs: action.elapsedMs, eventId: action.eventId,
      });
      const shown = { ...next, phase: "feedback" as const, revealed: true };
      return missed(passed, undefined) ? scheduleRetry(shown, entry) : shown;
    }

    case "gaveUp": {
      if (state.phase !== "question") return state;
      // 「不知道」＝答错并显示答案。翻卡记成「忘了」，服务端才会记失败（无评分的翻卡按模糊处理）。
      const flip = card.type === "flip";
      const next = record(state, entry, {
        action: "answer",
        response: "",
        gaveUp: true,
        ...(flip ? { rating: "forgot" as const } : { passed: false }),
        elapsedMs: action.elapsedMs,
        eventId: action.eventId,
      });
      return scheduleRetry({ ...next, phase: "feedback", revealed: true }, entry);
    }

    case "suspend": {
      const itemId = card.itemId;
      const next = record(state, entry, {
        action: "suspend", response: "", elapsedMs: action.elapsedMs, eventId: action.eventId,
      });
      // 撤掉这条后面还没出的重出：已经说了「不再出」。
      const queue = next.queue.filter((candidate, index) => index <= next.cursor || candidate.card.itemId !== itemId);
      return advance({ ...next, queue, suspended: [...next.suspended, itemId] });
    }

    case "next":
      return state.phase === "feedback" ? advance(state) : state;
  }
}

// ── 小结 ────────────────────────────────────────────────────────

const STAGE_ORDER: readonly LanguageTrainingStage[] = [
  "unseen",
  "recognized",
  "correctable",
  "retrievable",
  "transferable",
  "stable",
];
const rank = (stage: LanguageTrainingStage) => STAGE_ORDER.indexOf(stage);

export type QuickStageChange = { itemId: string; before: LanguageTrainingStage; after: LanguageTrainingStage };

export type QuickMistake = {
  itemId: string;
  cardId: string;
  type: QuickCardType;
  stem: string;
  answer: string;
  response: string;
  gaveUp: boolean;
  /** 重出的结果：fixed 改对、wrong 仍错、none 没有重出（组提前结束或标了不再出）。 */
  retry: "fixed" | "wrong" | "none";
};

export type QuickSetSummaryData = {
  setId: string;
  day: string;
  size: number;
  /** 本组首轮卡片数。 */
  total: number;
  /** 首轮作答数（含自评与「不知道」，不含 suspend）。 */
  answered: number;
  /** 首答的自动判分题：正确率只算这一类。 */
  graded: { total: number; correct: number; accuracy: number | null };
  /** 翻卡自评另计，不画成对错。 */
  self: { total: number; remembered: number; fuzzy: number; forgot: number };
  gaveUp: number;
  retries: { total: number; fixed: number; stillWrong: number };
  suspended: number;
  /** 各题 elapsedMs 之和；一条都没有时为 null。 */
  elapsedMs: number | null;
  /**
   * 升阶/回落只来自服务端应答。还有没确认的作答时 known=false，
   * 界面应显示「—」而不是 0：没保存上的题可能正是升阶的那几条。
   */
  stages: {
    known: boolean;
    confirmed: number;
    pending: number;
    promoted: QuickStageChange[];
    demoted: QuickStageChange[];
  };
  mistakes: QuickMistake[];
};

export function summarizeQuickSet(
  state: QuickSessionState,
  serverResults?: readonly QuickAnswerResult[],
): QuickSetSummaryData {
  const firstRound = state.records.filter((entry) => entry.round === 0 && entry.action === "answer");
  const retries = state.records.filter((entry) => entry.round === 1 && entry.action === "answer");
  const graded = firstRound.filter((entry) => entry.grading === "auto");
  const correct = graded.filter((entry) => entry.passed === true).length;
  const selfRated = firstRound.filter((entry) => entry.grading === "self");
  const retryOutcome = new Map(retries.map((entry) => [entry.itemId, !missed(entry.passed, entry.rating)]));
  const cards = new Map(state.queue.map((entry) => [entry.key, entry.card]));

  const results = new Map((serverResults ?? []).map((result) => [result.eventId, result]));
  // 升降按条目算：首答与重出常在同一次提交里，两条应答的 before/after 相同，逐条计会把一项算成两项。
  // 取该条目最早一条的 before、最晚一条的 after。
  const changes = new Map<string, QuickStageChange>();
  let confirmed = 0;
  for (const entry of state.records) {
    const result = results.get(entry.input.eventId);
    if (!result) continue;
    confirmed += 1;
    if (result.status === "stale") continue;
    const known = changes.get(result.itemId);
    changes.set(result.itemId, {
      itemId: result.itemId,
      before: known?.before ?? result.stageBefore,
      after: result.stageAfter,
    });
  }
  const promoted = [...changes.values()].filter((change) => rank(change.after) > rank(change.before));
  const demoted = [...changes.values()].filter((change) => rank(change.after) < rank(change.before));
  const pending = state.records.length - confirmed;
  const elapsed = state.records
    .map((entry) => entry.input.elapsedMs)
    .filter((value): value is number => typeof value === "number");

  return {
    setId: state.setId,
    day: state.day,
    size: state.size,
    total: state.queue.filter((entry) => entry.round === 0).length,
    answered: firstRound.length,
    graded: { total: graded.length, correct, accuracy: graded.length ? correct / graded.length : null },
    self: {
      total: selfRated.length,
      remembered: selfRated.filter((entry) => entry.rating === "remembered").length,
      fuzzy: selfRated.filter((entry) => entry.rating === "fuzzy").length,
      forgot: selfRated.filter((entry) => entry.rating === "forgot").length,
    },
    gaveUp: firstRound.filter((entry) => entry.gaveUp).length,
    retries: {
      total: retries.length,
      fixed: retries.filter((entry) => !missed(entry.passed, entry.rating)).length,
      stillWrong: retries.filter((entry) => missed(entry.passed, entry.rating)).length,
    },
    suspended: state.suspended.length,
    elapsedMs: elapsed.length ? elapsed.reduce((sum, value) => sum + value, 0) : null,
    stages: { known: serverResults !== undefined && pending === 0, confirmed, pending, promoted, demoted },
    mistakes: firstRound
      .filter((entry) => missed(entry.passed, entry.rating))
      .map((entry) => {
        const card = cards.get(entry.key);
        const outcome = retryOutcome.get(entry.itemId);
        return {
          itemId: entry.itemId,
          cardId: entry.cardId,
          type: entry.type,
          stem: card?.stem ?? "",
          answer: card?.answer ?? "",
          response: entry.response,
          gaveUp: entry.gaveUp === true,
          retry: outcome === undefined ? "none" : outcome ? "fixed" : "wrong",
        };
      }),
  };
}
