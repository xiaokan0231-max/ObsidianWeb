import type {
  LanguageBatchHistory,
  LanguageScanJudgment,
  LanguageTrainingStage,
} from "./types.ts";

/*
 * 快练（クイック練習）的共享契约：出卡、判分、进度回放、选题、接口、界面都只认这里的形状。
 *
 * 为什么另起一套而不复用集中训练的批次：批次是「200 项一批、三阶段、整篇覆盖写回」，
 * 快练是「一题一条不可变事件、随时可停」。两者共用的只有条目宇宙（课程 + 単語文法帳）
 * 和六个掌握阶段；旧批次的动作继续参与进度回放，但快练不往批次里写任何东西。
 *
 * 模块分工（值导入一律带 .ts 扩展名，node:test 直接 import）：
 * - quick-text.ts     归一化、语:: 切分与清洗、截取语境、差分、相似度、带种子的洗牌
 * - quick-items.ts    课程条目 / 単語文法帳 → QuickItem，组成 QuickPool
 * - quick-cards.ts    可用题型、按阶段选题型、生成卡片与干扰项、判分（服务端与客户端共用）
 * - quick-progress.ts 单条快练事件如何改变掌握阶段与到期日
 * - quick-log.ts      事件日志的路径、编解码、首答判定
 * - quick-select.ts   一组卡片的构成、汇总、历史合成
 * - quick-session.ts  客户端一组的会话状态（错题重出、小结）
 */

/** 条目分组：决定能出哪些题型、干扰项从哪一组取。単語文法帳按表分组。 */
export type QuickGroup =
  | "error_patch"
  | "interviewer_phrase"
  | "active_chunk"
  | "answer_strategy"
  | "nb_calque"   // 単語文法帳 A：中文式说法 → 自然日语
  | "nb_term"     // B-1 / B-2：中介与面试用语
  | "nb_katakana" // C：片假名与读音
  | "nb_keigo"    // D：商务敬语定型
  | "nb_verb"     // F：训读动词
  | "nb_pattern" // H：句型
  | "nb_number";  // G：实绩数字的读法。只考读音；数字本身是本人事实，只在本人页面显示，不进任何 fixture

export type QuickCardType =
  | "meaning_choice" // 看日语选中文意思（四选一）
  | "reading_choice" // 看表記选读音（四选一，干扰项由正确读音变异而来）
  | "word_choice"    // 看中文选日语（四选一）
  | "cloze_choice"   // 助词填空（四选一，含本人当时的错助词）
  | "natural_choice" // 哪个更自然（二选一：原错形 vs 修正）
  | "short_input"    // 短输入（≤6 字，假名即可）
  | "flip";          // 翻卡自评

/** 题型阶梯的三层：R 识别（unseen / recognized）、D 辨析（correctable）、P 提取（retrievable 及以上）。 */
export type QuickLayer = "R" | "D" | "P";

export type QuickSelfRating = "remembered" | "fuzzy" | "forgot";

/** 删除型助词修正的「不填」选项。 */
export const QUICK_EMPTY = "∅";

export const QUICK_SET_SIZES = [10, 20, 30] as const;
export type QuickSetSize = (typeof QUICK_SET_SIZES)[number];

export type QuickEvidence = {
  path: string;
  /** 给人看的出处：面试日期 · 场次 · 句子 ID，或「単語文法帳 · B-2」。 */
  label: string;
  sentenceId?: string;
  /** 截短后的原句（≤40 字）。运行时含真实内容，只在界面显示，不写进日志。 */
  excerpt: string;
};

/** 改错条目的最小差分：pre + wrongCore + post 是错形，pre + rightCores[i] + post 是修正。 */
export type QuickPatch = {
  wrong: string;
  fixes: string[];
  pre: string;
  post: string;
  wrongCore: string;
  rightCores: string[];
  /** 差分两侧都是助词（可为空）。 */
  particle: boolean;
  /** 原句（originalJa），截取语境用。 */
  context: string;
  /** 原句里能唯一定位到哪一侧。none 时不带语境。 */
  anchor: "wrong" | "fix" | "none";
};

export type QuickItem = {
  /** 课程条目沿用 li2_…；単語文法帳为 nb_ + stableHash(表|归一化键)。 */
  id: string;
  source: "curriculum" | "notebook";
  group: QuickGroup;
  /** 展示形。 */
  ja: string;
  /** 全部可接受形（含 ja）。 */
  jaAlts: string[];
  /** 完整读音；没有可靠的完整读音则为 ""。 */
  reading: string;
  /** 中文意思（error_patch 为 ""：课程里的 meaningZh 含答案，任何题面都不能用）。 */
  meaning: string;
  /** 解释：整理稿 型:: 括注、单語文法帳 ★ 备注、被清洗掉的释义后半等。 */
  note: string;
  /** ja 含 〜 或 …：只做识别类题型，不做打字。 */
  hasSlot: boolean;
  /** 错误型 slug 或表名。 */
  pattern: string;
  patch?: QuickPatch;
  priority: number;
  interviewCount: number;
  stars: 0 | 1 | 2;
  listeningMark?: "×" | "△";
  evidence: QuickEvidence[];
  /**
   * 単語文法帳 ★ 括注里本人记下的误读（「…✗」），已补成完整读音。读音题优先拿它们当干扰项：
   * 本人真实读错过的形比按规则变异出来的更值得辨。
   */
  misreadings?: string[];
};

export type QuickPool = {
  items: QuickItem[];
  /** 不出题的条目按原因计数（例如 technical_term、fact_anchor、ja_meaning、no_patch）。 */
  skipped: Record<string, number>;
  /** 释义是日语的面试官用语：第一版不出题，只在总览里显示数量。 */
  excludedJaMeaning: number;
  /** 単語文法帳解析出的条目数（用于发现表格改版导致的静默缺失）。 */
  notebookParsed: number;
  /** 靠中文释义表（material_kind: interviewer-phrase-gloss）补上中文意思才出得了题的面试官用语条数。 */
  glossed?: number;
};

export type QuickPromptKey =
  | "meaning" | "reading" | "word" | "cloze_particle" | "natural" | "natural_calque"
  | "input_particle" | "input_fix" | "input_word" | "input_reading"
  | "flip_meaning" | "flip_word" | "flip_fix" | "flip_pattern";

export type QuickCardReason = "due" | "lapsed" | "new" | "early";

export type QuickCard = {
  /** `${itemId}:${type}:${day}` */
  cardId: string;
  itemId: string;
  group: QuickGroup;
  type: QuickCardType;
  grading: "auto" | "self";
  reason: QuickCardReason;
  /** 出题时的掌握阶段（小结算升阶用）。 */
  stage: LanguageTrainingStage;
  layer: QuickLayer;
  /** 界面按 locale 映射成指令句。 */
  prompt: QuickPromptKey;
  stem: string;
  stemLang: "ja" | "zh";
  /** stem 里要高亮的区间 [start, end)（例如短输入改错题里的原错形）。 */
  mark?: [number, number];
  /** 选择题 2–4 项；其余为空数组。顺序已按种子打乱。 */
  options: string[];
  /**
   * 与 options 一一对应的高亮区间 [start, end)（目前只有「哪个更自然」给出：差异核在选项里的位置；
   * 删除型为空区间）。缺省＝不高亮。客户端重排选项时要和 options 一起重排。
   */
  optionMarks?: Array<[number, number]>;
  /** 展示用正确答案。 */
  answer: string;
  /** 可接受答案原文（判分时归一化）；翻卡为空。 */
  accepted: string[];
  reveal: {
    ja: string;
    reading: string;
    meaning: string;
    /** 本人当时的错形（改错类），否则 ""。 */
    wrong: string;
    explain: string;
    evidence: QuickEvidence[];
  };
};

export type QuickSet = {
  setId: string;
  day: string;
  size: QuickSetSize;
  cards: QuickCard[];
  composition: Record<QuickCardReason, number>;
  limits: { newToday: number; dailyNewLimit: number; newExhausted: boolean };
  /** 针对练习时的错误型（GET set?focus=）。 */
  focus?: string;
};

/** 客户端提交的一题。passed 由服务端算，客户端不传。 */
export type QuickAnswerInput = {
  eventId: string;
  itemId: string;
  type: QuickCardType;
  /** 所选选项文本或输入文本；翻卡与「不知道」为空。 */
  response?: string;
  rating?: QuickSelfRating;
  gaveUp?: boolean;
  /** 「这题有问题，不再出」。旧客户端只发这个布尔；新客户端发 action。 */
  suspend?: boolean;
  /** 缺省＝answer（suspend 为真时＝suspend）。 */
  action?: QuickAction;
  /** action=triage 时必填。 */
  judgment?: QuickTriageJudgment;
  elapsedMs?: number;
};

/**
 * - answer  正常作答（含「不知道」与翻卡自评）
 * - suspend 这题有问题，不再出（rejected=true）
 * - restore 撤销 suspend（rejected=false）；不计成败、不算作答
 * - easy    太简单：阶段至少 recognized，排到 30 天后验证一次；不产生成功日，算一次作答（不再是新题）。
 *           到期回来时第一张卡用 D 层题型验证，答对才开始记成功日——自报永远不直接进 stable
 * - triage  「一屏过一遍」的分流判断：只影响新题的出题先后（会→最后、不确定→靠前、不会→最前），
 *           不改阶段、不算作答；同一条目以最后一次判断为准，并覆盖旧批次的 scan 判断
 */
export type QuickAction = "answer" | "suspend" | "restore" | "easy" | "triage";

export type QuickTriageJudgment = "known" | "uncertain" | "unknown";

/** 日志里的一条事件：不可变。passed、first、at 只由服务端写。 */
export type QuickEvent = {
  eventId: string;
  setId: string;
  setSize: number;
  itemId: string;
  type: QuickCardType;
  action: QuickAction;
  response: string;
  rating?: QuickSelfRating;
  gaveUp?: boolean;
  /** 仅 action=triage。 */
  judgment?: QuickTriageJudgment;
  passed?: boolean;
  /** 当日（练习日，日本时间 04:00 起算）该条目的首次作答，且同一组里没有更早的作答或「太简单」。只有首答影响成败。 */
  first: boolean;
  at: string;
  elapsedMs?: number;
};

export type QuickAnswerStatus = "recorded" | "duplicate" | "stale";

export type QuickAnswerResult = {
  eventId: string;
  itemId: string;
  status: QuickAnswerStatus;
  passed?: boolean;
  first: boolean;
  stageBefore: LanguageTrainingStage;
  stageAfter: LanguageTrainingStage;
  nextDueAt?: string;
};

export type QuickTopIssue = {
  key: string;
  label: string;
  interviewCount: number;
  occurrenceCount: number;
  /** language＝语言错误型（可以针对练习）；strategy＝回答策略问题（快练里只有模板翻卡）。 */
  kind?: "language" | "strategy";
  /** 可传给 GET set?focus= 的错误型；没有可出题条目时不给。 */
  focus?: string;
  /** 该问题下可出题的条目数。 */
  itemCount?: number;
};

/** 列表里用的条目简表：分流屏、已排除清单。 */
export type QuickItemBrief = {
  itemId: string;
  group: QuickGroup;
  ja: string;
  reading: string;
  meaning: string;
  /** 改错条目：本人当时的错形 → 修正。 */
  wrong?: string;
};

/** 下一组的预计构成（与 GET set 同一套选题逻辑算出，无副作用）。 */
export type QuickNextSet = { total: number; due: number; lapsed: number; fresh: number; early: number };

export type QuickSummary = {
  ready: boolean;
  stale: boolean;
  day: string;
  due: number;
  /** 明天（练习日）到期的条目数：今天答错的、以及排期正好落在明天的。练完马上能看到「明天会回来几题」。 */
  dueTomorrow?: number;
  lapsedToday: number;
  newAvailable: number;
  newToday: number;
  dailyNewLimit: number;
  answeredToday: number;
  firstPassToday: number;
  /** 旧批次里标「不会 / 犹豫」、还没在快练里做过的条目数。 */
  seedRemaining: { unknown: number; uncertain: number };
  stageCounts: Record<LanguageTrainingStage, number>;
  drillable: number;
  excludedJaMeaning: number;
  notebookParsed: number;
  /** 快练按组合成的历史（形状沿用 LanguageBatchHistory，节奏带函数原样可用）。 */
  history: LanguageBatchHistory[];
  topIssues: QuickTopIssue[];
  curriculum?: { generatedAt: string; itemCount: number; sourceCount: number };
  /** 按当前设置再开一组会出什么。入口卡据此写「本组 N 题＝复习 a＋新题 b」，不再把每日额度当成本组新题数。 */
  nextSet?: QuickNextSet;
  /** 未来 7 天每天到期的条目数，[0]＝今天（含已逾期）。 */
  dueSoon?: number[];
  /** 被「不再出」排除的条目（最多 50 条，供恢复）；总数见 suspendedCount。 */
  suspended?: QuickItemBrief[];
  suspendedCount?: number;
  /** 还没练过、也没有任何分流判断的条目数（「一屏过一遍」还剩多少）。 */
  triageRemaining?: number;
  /** 日志里指向已不存在条目的事件数（课程重建或単語文法帳改表記后进度对不上的可见提示）。 */
  orphanEvents?: number;
  /** 用了本人维护的中文释义表才出得了题的面试官用语条数。 */
  glossed?: number;
};

/** autoAdvance：答对后约 1 秒自动进下一题；答错、翻卡、不知道仍停下等本人看解释。 */
export type QuickSettings = { size: QuickSetSize; typing: boolean; autoAdvance: boolean };

export const QUICK_TRIAGE_SIZE = 50;

/**
 * 「一天」的起点是日本时间 04:00，不是零点：深夜练习时 23:50 答错、0:05 再答对不该算两天。
 * 快练里所有按日的判断（首答、成功日、到期、每日新题额度、今天已练）都用这个「练习日」。
 */
export const QUICK_DAY_START_HOUR = 4;

/** 选题时需要的旧批次 scan 判断（只读，批次文件与签名不动）。 */
export type QuickLegacyJudgments = ReadonlyMap<string, LanguageScanJudgment>;
