import type {
  LanguageBatch,
  LanguageCurriculum,
  LanguageItemProgress,
  LanguageTrainingStage,
} from "../language/types";
import type {
  QuickAction,
  QuickAnswerInput,
  QuickAnswerResult,
  QuickCardType,
  QuickEvent,
  QuickItemBrief,
  QuickLegacyJudgments,
  QuickPool,
  QuickSelfRating,
  QuickSet,
  QuickSetSize,
  QuickSummary,
  QuickTopIssue,
  QuickTriageJudgment,
} from "../language/quick-types";
import { QUICK_SET_SIZES, QUICK_TRIAGE_SIZE } from "../language/quick-types.ts";
import type { QuickIndex } from "../language/quick-cards.ts";
import { availableCardTypes, gradeQuickAnswer } from "../language/quick-cards.ts";
import { collectTriageJudgments, isFirstAnswer, quickDay } from "../language/quick-log.ts";
import {
  mergeJudgments,
  quickFocusOptions,
  quickSummary,
  selectQuickSet,
  selectTriageItems,
} from "../language/quick-select.ts";
import { stableHash } from "../dojo/utils.ts";
import { STRATEGY_TREND_META } from "../interview-trends.mjs";
import { vaultSnapshotFingerprint } from "../vault-merge.ts";
import { badRequestError } from "./api.ts";
import {
  allBatches,
  deriveLanguageProgress,
  languageCurriculumStale,
  languageLegacyTargets,
  languageQuickInputs,
  latestLanguageCurriculumEntry,
  legacyScanJudgments,
} from "./language-v2.ts";
import type { ObsidianNote } from "./obsidian";

/*
 * 快练三条接口共用的组装层：只接 notes、只做计算，不读写 vault、不读当前时间（时间由调用方传入）。
 * 读写与写入队列留在 route 文件里经 @/lib/server/* 引入，路由测试的打桩才接得上。
 */

/** 与专项训练进度路由同一字符集：字母数字开头，只含 . _ : -，≤128。eventId、setId、itemId 都用它。 */
export const QUICK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export const QUICK_ANSWER_LIMIT = 30;
/** 短输入 ≤6 字、选项最长的是「哪个更自然」的截短句；64 字给足余量，又挡住整段粘贴。 */
export const QUICK_RESPONSE_MAX = 64;

const QUICK_CARD_TYPES: readonly QuickCardType[] = [
  "meaning_choice",
  "reading_choice",
  "word_choice",
  "cloze_choice",
  "natural_choice",
  "short_input",
  "flip",
];
const QUICK_RATINGS: readonly QuickSelfRating[] = ["remembered", "fuzzy", "forgot"];
const QUICK_ACTIONS: readonly QuickAction[] = ["answer", "suspend", "restore", "easy", "triage"];
const QUICK_JUDGMENTS: readonly QuickTriageJudgment[] = ["known", "uncertain", "unknown"];
/** 分流一屏的条数范围：少于 10 条不值得开一屏，多于 50 条一屏扫不完。 */
export const QUICK_TRIAGE_MIN = 10;
/** 错误型名的长度上限：整理稿里的 型:: 都是几个字，64 足够又挡住乱传。 */
export const QUICK_FOCUS_MAX = 64;

export type QuickContext = {
  /** 最新课程；没有时快练不开放（接口返回 ready:false / 409）。 */
  curriculum?: LanguageCurriculum;
  /** 课程落后于整理稿：仍可练，界面提示去更新训练画像。 */
  stale: boolean;
  pool: QuickPool;
  index: QuickIndex;
  events: readonly QuickEvent[];
  /** 旧批次的 scan 判断（不含分流）。写入分流后要和新事件重新合并，所以单独留着。 */
  scanJudgments: QuickLegacyJudgments;
  /** 选题与汇总用的判断：旧批次 scan 判断被分流判断覆盖后的结果（mergeJudgments）。 */
  legacy: QuickLegacyJudgments;
  binaryOnly: ReadonlySet<string>;
  /** 课程 profile 的问题，已补 kind 与中文标签（策略类）。 */
  topIssues: QuickTopIssue[];
  /** 问题 key → 课程里属于它的条目 id：给策略类问题数「可出题的条目」用。 */
  issueItemIds: ReadonlyMap<string, readonly string[]>;
  /** 课程条目 ∪ 単語文法帳条目的进度（回放旧批次动作 + 全部快练事件）。 */
  progress: ReadonlyMap<string, LanguageItemProgress>;
  /** 重放用的不变输入：作答后用「已有事件 + 新事件」再回放一次，得到写入后的阶段。 */
  replay: {
    curriculum: LanguageCurriculum;
    batches: LanguageBatch[];
    legacyTargets: Set<string>;
    extraItemIds: readonly string[];
  };
};

// 没有课程时仍要回放単語文法帳条目（summary 显示解析条数与阶段），用空课程占位。
const EMPTY_CURRICULUM: LanguageCurriculum = {
  version: 2,
  generatedAt: "",
  sourceFingerprint: "",
  sourceCount: 0,
  summaryZh: "",
  items: [],
  profile: {
    interviewCount: 0,
    learnerErrorCount: 0,
    reviewedBlockCount: 0,
    listeningGapCount: 0,
    staleReviewPaths: [],
    topIssues: [],
  },
};

export function replayQuickProgress(
  context: Pick<QuickContext, "replay" | "binaryOnly">,
  events: readonly QuickEvent[],
): Map<string, LanguageItemProgress> {
  const { curriculum, batches, legacyTargets, extraItemIds } = context.replay;
  const list = deriveLanguageProgress(curriculum, batches, legacyTargets, {
    events,
    extraItemIds,
    binaryOnly: context.binaryOnly,
  });
  return new Map(list.map((value) => [value.itemId, value]));
}

async function computeQuickContext(notes: ObsidianNote[]): Promise<QuickContext> {
  const curriculum = latestLanguageCurriculumEntry(notes)?.curriculum;
  const batches = allBatches(notes);
  const inputs = languageQuickInputs(notes, curriculum);
  // 旧瞬发训练的目标只影响课程条目的起步阶段；没有课程时不必去解析旧题库。
  const legacyTargets = curriculum ? await languageLegacyTargets(notes) : new Set<string>();
  const replay = {
    curriculum: curriculum ?? EMPTY_CURRICULUM,
    batches,
    legacyTargets,
    extraItemIds: inputs.extraItemIds,
  };
  const progress = replayQuickProgress({ replay, binaryOnly: inputs.binaryOnly }, inputs.events);
  const scanJudgments = legacyScanJudgments(batches);
  const issues = curriculum?.profile.topIssues ?? [];
  return {
    curriculum,
    // 与 /state 同一个判断：按当前笔记重建的内容指纹是否与现行课程不同。
    stale: languageCurriculumStale(notes, curriculum),
    pool: inputs.pool,
    index: inputs.index,
    events: inputs.events,
    scanJudgments,
    legacy: mergeJudgments(scanJudgments, collectTriageJudgments(inputs.events)),
    binaryOnly: inputs.binaryOnly,
    topIssues: issues.map(({ key, label, kind, interviewCount, occurrenceCount }) => {
      // 语言类保持型名（型名本身就是日语术语，翻成中文反而对不上整理稿）；策略类用复盘横断页的中文标签。
      const strategy = kind !== "error_patch";
      return {
        key,
        label: strategy ? STRATEGY_TREND_META[key]?.label ?? label : label,
        interviewCount,
        occurrenceCount,
        kind: strategy ? "strategy" as const : "language" as const,
      };
    }),
    issueItemIds: new Map(issues.map((issue) => [issue.key, issue.itemIds])),
    progress,
    replay,
  };
}

/** 写入分流事件之后，判断要按新的事件列表重新合并，否则应答里的「还剩多少没分流」不会变。 */
function judgmentsOf(context: QuickContext, events: readonly QuickEvent[]): QuickLegacyJudgments {
  return events === context.events ? context.legacy : mergeJudgments(context.scanJudgments, collectTriageJudgments(events));
}

/** 当前设置下能出题、没被排除的条目（与汇总里的「可练」同一口径）。 */
function drillable(
  context: Pick<QuickContext, "index">,
  progress: ReadonlyMap<string, LanguageItemProgress>,
  itemId: string,
  typing: boolean,
) {
  const item = context.index.byId.get(itemId);
  return Boolean(item && progress.get(itemId)?.rejected !== true && availableCardTypes(item, context.index, { typing }).length);
}

// 同 stateMemo：逐路径比较版本，单篇笔记更新也能识别；写入后快照变了自然重算（题库索引另有缓存）。
let contextMemo: { key: string; value: Promise<QuickContext> } | null = null;

export function buildQuickContext(notes: ObsidianNote[]): Promise<QuickContext> {
  const key = vaultSnapshotFingerprint(notes);
  if (contextMemo?.key === key) return contextMemo.value;
  const value = computeQuickContext(notes);
  contextMemo = { key, value };
  // 失败的计算不能被缓存住：下一次请求要重新算，而不是一直拿到同一个拒绝。
  value.catch(() => {
    if (contextMemo?.value === value) contextMemo = null;
  });
  return value;
}

function curriculumMeta(context: QuickContext): QuickSummary["curriculum"] {
  const { curriculum } = context;
  return curriculum
    ? { generatedAt: curriculum.generatedAt, itemCount: curriculum.items.length, sourceCount: curriculum.sourceCount }
    : undefined;
}

export function quickContextSummary(
  context: QuickContext,
  options: {
    day: string;
    size?: QuickSetSize;
    typing?: boolean;
    progress?: ReadonlyMap<string, LanguageItemProgress>;
    events?: readonly QuickEvent[];
  },
): QuickSummary {
  const progress = options.progress ?? context.progress;
  const events = options.events ?? context.events;
  const typing = options.typing ?? true;
  const summary = quickSummary({
    pool: context.pool,
    index: context.index,
    progress,
    events,
    legacy: judgmentsOf(context, events),
    day: options.day,
    size: options.size,
    typing,
    topIssues: context.topIssues,
    ready: Boolean(context.curriculum),
    stale: context.stale,
    curriculum: curriculumMeta(context),
  });
  // 能针对练习的语言类问题已由 quickSummary 按错误型数好；其余（策略类、没有可出题条目的型）按课程里归属它的条目数，
  // 界面才能如实写「这个问题快练里只有 1 张卡」，而不是空着。
  return {
    ...summary,
    topIssues: summary.topIssues.map((issue) => issue.itemCount !== undefined ? issue : {
      ...issue,
      itemCount: (context.issueItemIds.get(issue.key) ?? [])
        .filter((itemId) => drillable(context, progress, itemId, typing)).length,
    }),
  };
}

/**
 * 一组的 setId：同一份数据、同一设置得到同一个 setId（GET 无副作用、可重复）。
 * 只要落盘了任何一条快练事件，事件数与最后一条 eventId 就变了，下一组自然换 setId；
 * 会话默认的 eventId 是「setId.序号」，setId 重复就会撞号被当成重复丢掉。
 * 客户端在上一组答案还没提交完时就取下一组，要传 nonce 让 setId 不同。
 * 形如 q20261004-20-xxxx：带上练习日（日本时间 04:00 起算）与组大小，日志里的事件不靠别的字段也能看出属于哪天、多大的一组。
 */
export function quickSetId(
  context: Pick<QuickContext, "events" | "curriculum" | "pool">,
  options: { day: string; size: QuickSetSize; typing: boolean; extra: boolean; nonce?: string; focus?: string },
) {
  const last = context.events.at(-1)?.eventId ?? "";
  const digest = stableHash([
    options.day,
    options.size,
    options.typing ? 1 : 0,
    options.extra ? 1 : 0,
    context.curriculum?.contentFingerprint ?? context.curriculum?.sourceFingerprint ?? "-",
    context.pool.items.length,
    context.events.length,
    last,
    options.nonce ?? "",
    // 针对练习与普通组的卡不同，setId 也要不同：会话默认 eventId 是「setId.序号」，同号会被当成重复丢掉。
    ...(options.focus ? [`focus:${options.focus}`] : []),
  ].join("|"));
  return `q${options.day.replace(/-/gu, "")}-${options.size}-${digest}`;
}

export function quickContextSet(
  context: QuickContext,
  options: { day: string; size: QuickSetSize; typing: boolean; extra: boolean; nonce?: string; focus?: string },
): QuickSet {
  return selectQuickSet({
    pool: context.pool,
    index: context.index,
    progress: context.progress,
    events: context.events,
    legacy: context.legacy,
    day: options.day,
    size: options.size,
    typing: options.typing,
    extra: options.extra,
    setId: quickSetId(context, options),
    topIssues: context.topIssues,
    ...(options.focus ? { focus: options.focus } : {}),
  });
}

/**
 * 针对练习取不到卡时的原因（GET set?focus= 仍返回 200，界面按原因写提示）：
 * - unknown_focus：题库里没有这个错误型
 * - no_items：有这个型，但当前设置下没有能出题的条目（都被排除，或只剩短输入而打字关着）
 * - nothing_now：有可出题条目，但现在没有到期的、今天的新题额度也用完了
 */
export type QuickFocusEmptyReason = "unknown_focus" | "no_items" | "nothing_now";

const FOCUS_EMPTY_MESSAGES: Record<QuickFocusEmptyReason, string> = {
  unknown_focus: "题库里没有这个错误型。",
  no_items: "这个错误型现在没有能出题的条目。",
  nothing_now: "这个错误型现在没有到期的题，今天的新题额度也已用完。",
};

export function quickFocusEmpty(
  context: QuickContext,
  focus: string,
  typing: boolean,
): { emptyReason: QuickFocusEmptyReason; emptyMessage: string } {
  const known = context.pool.items.some((item) => item.group === "error_patch" && item.pattern === focus);
  const count = quickFocusOptions(context.pool, context.index, context.progress, typing, context.legacy).get(focus) ?? 0;
  const emptyReason: QuickFocusEmptyReason = !known ? "unknown_focus" : count ? "nothing_now" : "no_items";
  return { emptyReason, emptyMessage: FOCUS_EMPTY_MESSAGES[emptyReason] };
}

/** 「一屏过一遍」的下一批与剩余数。只读：分流判断由 POST answer 以 action=triage 落盘。 */
export function quickContextTriage(
  context: QuickContext,
  options: { size: number; typing: boolean },
): { ready: boolean; items: QuickItemBrief[]; remaining: number } {
  // 没有课程时 POST answer 回 409，判断存不下来，给了条目也只能白分。
  if (!context.curriculum) return { ready: false, items: [], remaining: 0 };
  const input = {
    pool: context.pool,
    index: context.index,
    progress: context.progress,
    legacy: context.legacy,
    typing: options.typing,
    topIssues: context.topIssues,
  };
  // remaining 与 summary.triageRemaining 同一口径：取全部候选再数，题库不过一千来条，不必另写一套计数。
  const all = selectTriageItems({ ...input, size: Number.MAX_SAFE_INTEGER });
  return { ready: Boolean(context.curriculum), items: all.slice(0, options.size), remaining: all.length };
}

// ── 查询参数 ────────────────────────────────────────────────────

function flag(value: string | null, name: string, fallback: boolean) {
  if (value === null || value === "") return fallback;
  if (value === "1") return true;
  if (value === "0") return false;
  throw badRequestError(`${name} 只能是 0 或 1。`);
}

export function parseQuickSetQuery(params: URLSearchParams) {
  const rawSize = params.get("size");
  const size = rawSize === null || rawSize === "" ? 20 : Number(rawSize);
  if (!QUICK_SET_SIZES.includes(size as QuickSetSize)) throw badRequestError("size 只能是 10、20 或 30。");
  const nonce = params.get("nonce") ?? "";
  if (nonce && !/^[A-Za-z0-9]{1,32}$/u.test(nonce)) throw badRequestError("nonce 格式不正确。");
  const focus = (params.get("focus") ?? "").trim();
  // 型名来自整理稿（日语、中文都有），不限字符集；只挡控制字符与过长的值。
  if (focus.length > QUICK_FOCUS_MAX || /[\u0000-\u001f\u007f]/u.test(focus)) throw badRequestError("focus 格式不正确。");
  return {
    size: size as QuickSetSize,
    typing: flag(params.get("typing"), "typing", true),
    extra: flag(params.get("extra"), "extra", false),
    ...(nonce ? { nonce } : {}),
    ...(focus ? { focus } : {}),
  };
}

/** GET triage：size 10–50，缺省 50（QUICK_TRIAGE_SIZE）；typing 与取题同义（打字关着时只靠短输入的条目不进分流）。 */
export function parseQuickTriageQuery(params: URLSearchParams) {
  const rawSize = params.get("size");
  const size = rawSize === null || rawSize === "" ? QUICK_TRIAGE_SIZE : Number(rawSize);
  if (!Number.isInteger(size) || size < QUICK_TRIAGE_MIN || size > QUICK_TRIAGE_SIZE) {
    throw badRequestError(`size 只能是 ${QUICK_TRIAGE_MIN}–${QUICK_TRIAGE_SIZE} 的整数。`);
  }
  return { size, typing: flag(params.get("typing"), "typing", true) };
}

// ── 作答 ────────────────────────────────────────────────────────

export type QuickAnswerBody = {
  setId: string;
  setSize: QuickSetSize;
  answers: QuickAnswerInput[];
};

/** setId 是服务端生成的（q日期-大小-摘要），客户端没传 setSize 时从里面读；都读不到按默认 20。 */
function setSizeOf(setId: string, raw: unknown): QuickSetSize {
  if (raw !== undefined && raw !== null) {
    if (!QUICK_SET_SIZES.includes(raw as QuickSetSize)) throw badRequestError("setSize 只能是 10、20 或 30。");
    return raw as QuickSetSize;
  }
  const parsed = Number(/^q\d{8}-(\d+)-/u.exec(setId)?.[1]);
  return QUICK_SET_SIZES.includes(parsed as QuickSetSize) ? parsed as QuickSetSize : 20;
}

function parseAnswer(raw: unknown, index: number): QuickAnswerInput {
  const where = `answers[${index}]`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequestError(`${where} 必须是对象。`);
  const value = raw as Record<string, unknown>;
  if (typeof value.eventId !== "string" || !QUICK_ID_PATTERN.test(value.eventId)) {
    throw badRequestError(`${where}.eventId 格式不正确。`);
  }
  if (typeof value.itemId !== "string" || !QUICK_ID_PATTERN.test(value.itemId)) {
    throw badRequestError(`${where}.itemId 格式不正确。`);
  }
  if (!QUICK_CARD_TYPES.includes(value.type as QuickCardType)) throw badRequestError(`${where}.type 不受支持。`);
  if (value.response !== undefined && typeof value.response !== "string") throw badRequestError(`${where}.response 必须是文本。`);
  const response = typeof value.response === "string" ? value.response.trim() : "";
  if (response.length > QUICK_RESPONSE_MAX) throw badRequestError(`${where}.response 不能超过 ${QUICK_RESPONSE_MAX} 字。`);
  if (value.rating !== undefined && !QUICK_RATINGS.includes(value.rating as QuickSelfRating)) {
    throw badRequestError(`${where}.rating 不受支持。`);
  }
  for (const key of ["gaveUp", "suspend"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") throw badRequestError(`${where}.${key} 必须是布尔值。`);
  }
  if (value.elapsedMs !== undefined && (typeof value.elapsedMs !== "number" || !Number.isFinite(value.elapsedMs))) {
    throw badRequestError(`${where}.elapsedMs 必须是数字。`);
  }
  if (value.action !== undefined && !QUICK_ACTIONS.includes(value.action as QuickAction)) {
    throw badRequestError(`${where}.action 不受支持。`);
  }
  // 旧客户端只发 suspend 布尔；新客户端发 action。两者矛盾（suspend 为真却说是别的动作）时拒收，免得记错。
  if (value.suspend === true && value.action !== undefined && value.action !== "suspend") {
    throw badRequestError(`${where}.suspend 与 action 矛盾。`);
  }
  const action: QuickAction = (value.action as QuickAction | undefined) ?? (value.suspend === true ? "suspend" : "answer");
  if (action === "triage" && !QUICK_JUDGMENTS.includes(value.judgment as QuickTriageJudgment)) {
    throw badRequestError(`${where} 是分流判断，judgment 只能是 known、uncertain 或 unknown。`);
  }
  const type = value.type as QuickCardType;
  const answer = action === "answer";
  const gaveUp = value.gaveUp === true;
  // 「不知道」的翻卡按「忘了」记：无评分的翻卡在回放里按模糊处理，不算失败（会话 reducer 也是这么发的）。
  const rating = type === "flip" && answer
    ? (value.rating as QuickSelfRating | undefined) ?? (gaveUp ? "forgot" : undefined)
    : undefined;
  if (type === "flip" && answer && !rating) throw badRequestError(`${where} 是翻卡作答，需要 rating。`);
  // 客户端的 passed 一概不读：只取契约里的键，判分由服务端按题库重算。
  // 只有作答带 response / rating / gaveUp；别的动作即使带了也丢掉，不让它们流进日志被当成作答。
  return {
    eventId: value.eventId,
    itemId: value.itemId,
    type,
    ...(response && answer ? { response } : {}),
    ...(rating ? { rating } : {}),
    ...(gaveUp && answer ? { gaveUp: true } : {}),
    ...(action === "suspend" ? { suspend: true } : {}),
    ...(action !== "answer" ? { action } : {}),
    ...(action === "triage" ? { judgment: value.judgment as QuickTriageJudgment } : {}),
    ...(value.elapsedMs !== undefined
      ? { elapsedMs: Math.min(86_400_000, Math.max(0, Math.round(value.elapsedMs as number))) }
      : {}),
  };
}

function actionOf(input: QuickAnswerInput): QuickAction {
  return input.action ?? (input.suspend ? "suspend" : "answer");
}

/** 校验请求体（在进写入队列之前，不合法的请求不读 vault）。 */
export function parseQuickAnswerBody(raw: unknown): QuickAnswerBody {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequestError("请求体必须是 JSON 对象。");
  const body = raw as Record<string, unknown>;
  if (typeof body.setId !== "string" || !QUICK_ID_PATTERN.test(body.setId)) throw badRequestError("setId 格式不正确。");
  if (!Array.isArray(body.answers) || body.answers.length < 1 || body.answers.length > QUICK_ANSWER_LIMIT) {
    throw badRequestError(`answers 必须是 1–${QUICK_ANSWER_LIMIT} 条。`);
  }
  return {
    setId: body.setId,
    setSize: setSizeOf(body.setId, body.setSize),
    answers: body.answers.map(parseAnswer),
  };
}

type PlannedAnswer =
  | { status: "duplicate"; input: QuickAnswerInput; event: QuickEvent }
  | { status: "stale"; input: QuickAnswerInput }
  | { status: "recorded"; input: QuickAnswerInput; event: QuickEvent };

export type QuickAnswerPlan = {
  day: string;
  setSize: QuickSetSize;
  entries: PlannedAnswer[];
  /** 要追加的新事件（按请求数组顺序）。 */
  events: QuickEvent[];
};

/**
 * 把一次提交转成要写的事件。按数组顺序逐条：
 * 全库已有同 eventId → duplicate；条目不在题库 → stale（不写）；
 * 作答、「不再出」、「太简单」、分流时条目已出不了任何题型 → stale（撤销排除不要求：被排除的条目也要能放回来）；
 * 作答与「不再出」的题型不在该条目的可用题型里 → 整个请求 400（客户端拿到的卡和题库对不上，写进去会污染回放）。
 * 撤销排除、「太简单」、分流不针对某张卡，type 只是客户端带的占位值，照存不校验。
 * 判分只用题库重算、只给作答；first 也只给作答，并把同一请求里前面刚算好的事件也算进去，组内重出才不会被当成首答。
 * 被「不再出」排除的条目照常记录：同一张卡先作答再按 X 时两条要一起落盘。
 */
export function planQuickAnswers(context: QuickContext, body: QuickAnswerBody, at: string): QuickAnswerPlan {
  const day = quickDay(at);
  if (!day) throw new Error(`无法确定作答日期：${at}`);
  const known = new Map(context.events.map((event) => [event.eventId, event]));
  const history: QuickEvent[] = [...context.events];
  const entries: PlannedAnswer[] = [];
  const events: QuickEvent[] = [];
  for (const input of body.answers) {
    const existing = known.get(input.eventId);
    if (existing) {
      entries.push({ status: "duplicate", input, event: existing });
      continue;
    }
    const action = actionOf(input);
    const item = context.index.byId.get(input.itemId);
    const available = item ? availableCardTypes(item, context.index, { typing: true }) : [];
    if (!item || (action !== "restore" && !available.length)) {
      entries.push({ status: "stale", input });
      continue;
    }
    if ((action === "answer" || action === "suspend") && !available.includes(input.type)) {
      throw badRequestError(`条目 ${input.itemId} 不能出「${input.type}」题型。`);
    }
    const answer = action === "answer";
    const { passed } = answer
      ? gradeQuickAnswer(item, input.type, { response: input.response, rating: input.rating, gaveUp: input.gaveUp })
      : { passed: undefined };
    const event: QuickEvent = {
      eventId: input.eventId,
      setId: body.setId,
      setSize: body.setSize,
      itemId: input.itemId,
      type: input.type,
      action,
      response: answer ? input.response ?? "" : "",
      ...(answer && input.rating ? { rating: input.rating } : {}),
      ...(answer && input.gaveUp ? { gaveUp: true } : {}),
      ...(action === "triage" && input.judgment ? { judgment: input.judgment } : {}),
      ...(passed !== undefined ? { passed } : {}),
      // 只有作答占首答：「不再出」「撤销排除」「分流」都不是作答；「太简单」虽算一次见过，
      // 但它不判分，首答与否由回放与 isFirstAnswer 另行处理（当天按过「太简单」的条目再作答不算首答）。
      first: answer ? isFirstAnswer(history, { itemId: input.itemId, day, setId: body.setId }) : false,
      at,
      ...(input.elapsedMs !== undefined ? { elapsedMs: input.elapsedMs } : {}),
    };
    known.set(event.eventId, event);
    history.push(event);
    events.push(event);
    entries.push({ status: "recorded", input, event });
  }
  return { day, setSize: body.setSize, entries, events };
}

function stageOf(progress: ReadonlyMap<string, LanguageItemProgress>, itemId: string): LanguageTrainingStage {
  return progress.get(itemId)?.stage ?? "unseen";
}

/**
 * 写入之后的应答。written 是实际落盘的事件（写入前在笔记里再查一次 eventId，被别处先写的会少掉）；
 * 计划里有、实际没写的按 duplicate 报。stageBefore / stageAfter 是写入前后各回放一次的结果。
 */
export function settleQuickAnswers(
  context: QuickContext,
  plan: QuickAnswerPlan,
  written: readonly QuickEvent[],
): { results: QuickAnswerResult[]; summary: QuickSummary } {
  const writtenIds = new Set(written.map((event) => event.eventId));
  const events = written.length ? [...context.events, ...written] : context.events;
  const after = written.length ? replayQuickProgress(context, events) : context.progress;
  const results = plan.entries.map((entry): QuickAnswerResult => {
    const { itemId, eventId } = entry.input;
    const stageBefore = stageOf(context.progress, itemId);
    if (entry.status === "stale") {
      return { eventId, itemId, status: "stale", first: false, stageBefore, stageAfter: stageBefore };
    }
    const recorded = entry.status === "recorded" && writtenIds.has(eventId);
    const next = after.get(itemId);
    return {
      eventId,
      itemId,
      status: recorded ? "recorded" : "duplicate",
      ...(entry.event.passed !== undefined ? { passed: entry.event.passed } : {}),
      first: entry.event.first,
      stageBefore,
      stageAfter: next?.stage ?? stageBefore,
      ...(next?.nextDueAt ? { nextDueAt: next.nextDueAt } : {}),
    };
  });
  return {
    results,
    summary: quickContextSummary(context, { day: plan.day, size: plan.setSize, progress: after, events }),
  };
}
