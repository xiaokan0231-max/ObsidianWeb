"use client";

import { useCallback, useSyncExternalStore } from "react";
import type {
  QuickAnswerInput,
  QuickAnswerResult,
  QuickCardReason,
  QuickCardType,
  QuickGroup,
  QuickPromptKey,
  QuickSelfRating,
  QuickSetSize,
  QuickSettings,
  QuickSummary,
} from "@/lib/language/quick-types";
import { QUICK_SET_SIZES } from "@/lib/language/quick-types";
import { useUiLocale } from "./ui-locale";

/*
 * 快练前端的「非界面」部分：接口路径、答案队列、设置存取、中日文案。
 * 路径集中在这里，服务端改名只改一处；队列与设置不碰 React 树，组件只订阅结果。
 */

export const QUICK_ENDPOINTS = {
  set: "/api/language/v2/quick/set",
  answer: "/api/language/v2/quick/answer",
  summary: "/api/language/v2/quick/summary",
  triage: "/api/language/v2/quick/triage",
  state: "/api/language/v2/state",
  rebuild: "/api/language/v2/rebuild",
} as const;

// ── 节奏常量 ─────────────────────────────────────────────────────

/** 答对后自动进下一题的等待：够看一眼对勾和读音，又不至于让答对的题也要按一次 Enter。 */
export const QUICK_AUTO_ADVANCE_MS = 1_000;
/** 单题用时前端封顶：中途离开座位，这一题不该被记成几分钟，污染日后按用时的分析。 */
export const QUICK_ELAPSED_CAP_MS = 120_000;
/** 小结挂载后这段时间内「再来一组」不响应：最后一题习惯性多按的 Enter 不能把小结直接跳过去。 */
export const QUICK_AGAIN_LOCK_MS = 600;
/** 只答了不到一半就按 Esc：要在这段时间内再按一次才结束，手滑关掉一组的代价太大。 */
export const QUICK_END_CONFIRM_MS = 2_000;

/**
 * 分流（triage）与总览里的「恢复」不在任何一组里：服务端契约仍要一个合法题型字段，
 * 这两种动作不判分、不看题型，按契约固定填 flip（服务端只对 action=answer 的翻卡要求自评）。
 */
export const QUICK_META_TYPE: QuickCardType = "flip";

/** 不属于任何一组的动作（分流、总览恢复）的 setId：字符集与服务端校验一致，带随机串避免撞号。 */
export function quickLooseSetId(kind: "triage" | "restore", nonce: string) {
  const safe = nonce.replace(/[^A-Za-z0-9]/gu, "").slice(0, 24) || "x";
  return `${kind}.${safe}`;
}

// ── 专注计时 ─────────────────────────────────────────────────────

/**
 * 练习屏顶栏与小结「本次专注」共用的一只表：页面隐藏时暂停。
 * 两处各算各的（墙钟 vs 各题用时之和）会差出一分钟，本人会以为计时坏了。
 * 时间从参数传入，测试不必读时钟。
 */
export type QuickFocusClock = {
  start: (now: number) => void;
  pause: (now: number) => void;
  resume: (now: number) => void;
  /** 停表并返回累计毫秒；之后 read 一直返回这个数。 */
  stop: (now: number) => number;
  read: (now: number) => number;
};

export function createQuickFocusClock(): QuickFocusClock {
  let total = 0;
  let since: number | null = null;
  let state: "idle" | "running" | "paused" | "stopped" = "idle";
  const read = (now: number) => total + (since === null ? 0 : Math.max(0, now - since));
  return {
    start(now) {
      total = 0;
      since = now;
      state = "running";
    },
    pause(now) {
      if (state !== "running") return;
      total = read(now);
      since = null;
      state = "paused";
    },
    resume(now) {
      if (state !== "paused") return;
      since = now;
      state = "running";
    },
    stop(now) {
      if (state === "running") total = read(now);
      since = null;
      if (state !== "idle") state = "stopped";
      return total;
    },
    read,
  };
}

/** 未来 7 天内（不含今天）到期的条目数：[0] 是今天，顶部「待复习」的主数字已经算过。 */
export function quickDueSoonTotal(summary: Pick<QuickSummary, "dueSoon">) {
  return (summary.dueSoon ?? []).slice(1).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

type ApiError = { error?: string };

export class QuickHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "QuickHttpError";
  }
}

export async function quickApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    // 读取黙り込み时「正在读取…」会永远挂着；20 秒放弃并说出理由。
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  });
  let body = {} as T & ApiError;
  try {
    body = await response.json() as T & ApiError;
  } catch {
    // 代理断开时可能返回空体或 HTML；状态码已足够说明问题。
  }
  if (!response.ok) throw new QuickHttpError(response.status, body.error || `请求失败 (${response.status})`);
  return body;
}

// ── 接口形状（只按契约取字段，服务端多给的不读） ─────────────────────

/** setSize 可省（服务端能从 setId 读出），带上是为了不依赖 setId 的格式。 */
export type QuickAnswerBody = { setId: string; setSize?: number; answers: QuickAnswerInput[] };
export type QuickAnswerResponse = { results?: QuickAnswerResult[]; summary?: QuickSummary };

/** 服务端一次最多收 30 条（契约）。 */
export const QUICK_ANSWER_BATCH = 30;

// ── 答案队列 ─────────────────────────────────────────────────────

export type QuickSaveStatus = {
  /** 还没被服务端确认的题数（含在途）。 */
  pending: number;
  saving: boolean;
  /** 最近一次发送失败，正在等退避重试。 */
  failed: boolean;
  /** 被服务端明确拒收（4xx）而放弃的题数：再发也不会成功，不能无限重试。 */
  rejected: number;
  error: string;
};

export const IDLE_SAVE_STATUS: QuickSaveStatus = { pending: 0, saving: false, failed: false, rejected: 0, error: "" };

/** 退避：2s / 5s / 15s，之后一直 15s。本机服务断开时不该每秒打一次。 */
export const QUICK_RETRY_DELAYS = [2_000, 5_000, 15_000] as const;

/** solo：整批被拒收后拆开逐条重发的条目，一次只带它自己。 */
type QueueEntry = { setId: string; setSize?: number; input: QuickAnswerInput; solo?: boolean };

export type QuickAnswerQueue = {
  enqueue: (setId: string, inputs: readonly QuickAnswerInput[], setSize?: number) => void;
  /** 立刻重试（online、页面重新可见时）。 */
  retryNow: () => void;
  /** 卸载与 beforeunload：用 keepalive 把剩下的补发一次；eventId 去重保证不重复计数。 */
  flushKeepalive: () => void;
  status: () => QuickSaveStatus;
  /**
   * 等到队列清空（或正在退避、或超时）再返回。「再来一组」先等上一组落盘：
   * GET set 按服务端已有记录选题，没落盘的刚答过的题会被当成新题或到期题再出一遍。
   */
  drained: (timeoutMs: number) => Promise<void>;
  dispose: () => void;
};

export type QuickAnswerQueueOptions = {
  post?: (body: QuickAnswerBody) => Promise<QuickAnswerResponse>;
  keepalive?: (body: QuickAnswerBody) => void;
  onResults?: (results: QuickAnswerResult[], summary?: QuickSummary) => void;
  onStatus?: (status: QuickSaveStatus) => void;
  delays?: readonly number[];
  schedule?: (run: () => void, ms: number) => () => void;
};

async function postAnswers(body: QuickAnswerBody): Promise<QuickAnswerResponse> {
  return quickApi<QuickAnswerResponse>(QUICK_ENDPOINTS.answer, { method: "POST", body: JSON.stringify(body) });
}

function keepaliveAnswers(body: QuickAnswerBody) {
  // readJson 要求 JSON Content-Type；sendBeacon 发不了这个头，所以用 fetch keepalive。
  void fetch(QUICK_ENDPOINTS.answer, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined);
}

function answerBody(setId: string, setSize: number | undefined, answers: QuickAnswerInput[]): QuickAnswerBody {
  return setSize ? { setId, setSize, answers } : { setId, answers };
}

function permanent(error: unknown) {
  // 408 / 429 是「稍后再来」；其余 4xx 是请求本身不被接受，重发同一份只会一直失败。
  return error instanceof QuickHttpError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

/**
 * 串行发送：同一时刻只有一个请求在途，发出时把同一组的全部待发（≤30）一次带上。
 * 只有服务端应答之后才出队；失败按退避重试。第一版不做 localStorage 镜像（方案已列为不做）。
 */
export function createQuickAnswerQueue(options: QuickAnswerQueueOptions = {}): QuickAnswerQueue {
  const post = options.post ?? postAnswers;
  const sendKeepalive = options.keepalive ?? keepaliveAnswers;
  const delays = options.delays ?? QUICK_RETRY_DELAYS;
  const schedule = options.schedule ?? ((run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  });
  let pending: QueueEntry[] = [];
  let inFlight: QueueEntry[] = [];
  let attempt = 0;
  let cancelTimer: (() => void) | null = null;
  let failed = false;
  let rejected = 0;
  let error = "";
  let disposed = false;
  let waiters: Array<() => void> = [];

  const status = (): QuickSaveStatus => ({
    pending: pending.length + inFlight.length,
    saving: inFlight.length > 0,
    failed,
    rejected,
    error,
  });
  const settleWaiters = () => {
    // 发送失败在退避时不再等：断网时「再来一组」不能被卡住。
    if (!waiters.length || (pending.length + inFlight.length > 0 && !failed)) return;
    const done = waiters;
    waiters = [];
    for (const resolve of done) resolve();
  };
  const report = () => {
    settleWaiters();
    if (!disposed) options.onStatus?.(status());
  };
  const known = (eventId: string) =>
    pending.some((entry) => entry.input.eventId === eventId) || inFlight.some((entry) => entry.input.eventId === eventId);

  const pump = () => {
    if (disposed || inFlight.length || cancelTimer || !pending.length) return;
    const { setId, setSize } = pending[0];
    inFlight = pending[0].solo
      ? [pending[0]]
      : pending.filter((entry) => entry.setId === setId && !entry.solo).slice(0, QUICK_ANSWER_BATCH);
    const sent = new Set(inFlight.map((entry) => entry.input.eventId));
    pending = pending.filter((entry) => !sent.has(entry.input.eventId));
    report();
    void post(answerBody(setId, setSize, inFlight.map((entry) => entry.input))).then(
      (response) => {
        inFlight = [];
        attempt = 0;
        failed = false;
        error = "";
        if (!disposed) options.onResults?.(response.results ?? [], response.summary);
        report();
        pump();
      },
      (reason: unknown) => {
        const batch = inFlight;
        inFlight = [];
        const message = reason instanceof Error ? reason.message : "保存失败";
        if (permanent(reason) && batch.length > 1) {
          // 服务端按整份请求校验，一条不合法（例如课程中途重建、题型对不上）就整批 400。
          // 拆开逐条重发，只放弃真正被拒的那几条，同批里合法的作答不跟着丢。
          pending = [...batch.map((entry) => ({ ...entry, solo: true })), ...pending];
          report();
          pump();
          return;
        }
        if (permanent(reason)) {
          rejected += batch.length;
          error = message;
          report();
          pump();
          return;
        }
        // 放回队首，保持作答顺序：服务端按数组顺序算「首答」。
        pending = [...batch, ...pending];
        failed = true;
        error = message;
        const delay = delays[Math.min(attempt, delays.length - 1)] ?? 15_000;
        attempt += 1;
        cancelTimer = schedule(() => {
          cancelTimer = null;
          pump();
        }, delay);
        report();
      },
    );
  };

  return {
    enqueue(setId, inputs, setSize) {
      const fresh = inputs.filter((input) => !known(input.eventId));
      if (!fresh.length || disposed) return;
      pending = [...pending, ...fresh.map((input) => ({ setId, ...(setSize ? { setSize } : {}), input }))];
      report();
      pump();
    },
    retryNow() {
      if (!cancelTimer) return;
      cancelTimer();
      cancelTimer = null;
      pump();
    },
    flushKeepalive() {
      const all = [...inFlight, ...pending];
      const groups = new Map<string, QueueEntry[]>();
      for (const entry of all) groups.set(entry.setId, [...(groups.get(entry.setId) ?? []), entry]);
      for (const [setId, entries] of groups) {
        for (let start = 0; start < entries.length; start += QUICK_ANSWER_BATCH) {
          const chunk = entries.slice(start, start + QUICK_ANSWER_BATCH);
          sendKeepalive(answerBody(setId, chunk[0].setSize, chunk.map((entry) => entry.input)));
        }
      }
    },
    status,
    drained(timeoutMs) {
      if (disposed || failed || (!pending.length && !inFlight.length)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        let cancel = () => {};
        const finish = () => {
          cancel();
          resolve();
        };
        waiters.push(finish);
        cancel = schedule(() => {
          waiters = waiters.filter((waiter) => waiter !== finish);
          resolve();
        }, timeoutMs);
      });
    },
    dispose() {
      disposed = true;
      const done = waiters;
      waiters = [];
      for (const resolve of done) resolve();
      cancelTimer?.();
      cancelTimer = null;
    },
  };
}

// ── 设置 ────────────────────────────────────────────────────────

export const QUICK_SETTINGS_KEY = "echo:language-quick-settings:v1";
// autoAdvance 默认开（本人 2026-10-05 拍板）：一组里大半是答对的题，每题多按一次 Enter 没有学习价值。
// 旧版本存下的设置没有这个键，按默认值补上，不当成坏数据。
export const DEFAULT_QUICK_SETTINGS: QuickSettings = Object.freeze({ size: 20, typing: true, autoAdvance: true });

export function parseQuickSettings(raw: string | null | undefined): QuickSettings {
  if (!raw) return DEFAULT_QUICK_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<QuickSettings>;
    const size = QUICK_SET_SIZES.includes(parsed.size as QuickSetSize) ? parsed.size as QuickSetSize : DEFAULT_QUICK_SETTINGS.size;
    const typing = typeof parsed.typing === "boolean" ? parsed.typing : DEFAULT_QUICK_SETTINGS.typing;
    const autoAdvance = typeof parsed.autoAdvance === "boolean" ? parsed.autoAdvance : DEFAULT_QUICK_SETTINGS.autoAdvance;
    const same = size === DEFAULT_QUICK_SETTINGS.size && typing === DEFAULT_QUICK_SETTINGS.typing
      && autoAdvance === DEFAULT_QUICK_SETTINGS.autoAdvance;
    return same ? DEFAULT_QUICK_SETTINGS : { size, typing, autoAdvance };
  } catch {
    return DEFAULT_QUICK_SETTINGS;
  }
}

// 设置的出处是 localStorage：当外部存储订阅，服务端与水合首帧都给默认值，挂载后再换成本机值。
const settingsListeners = new Set<() => void>();
let settingsSnapshot: QuickSettings | null = null;

function readStoredSettings() {
  try {
    return parseQuickSettings(window.localStorage.getItem(QUICK_SETTINGS_KEY));
  } catch {
    return DEFAULT_QUICK_SETTINGS;
  }
}

function onSettingsStorage(event: StorageEvent) {
  if (event.key !== QUICK_SETTINGS_KEY) return;
  settingsSnapshot = parseQuickSettings(event.newValue);
  for (const listener of settingsListeners) listener();
}

function subscribeSettings(listener: () => void) {
  settingsListeners.add(listener);
  if (settingsSnapshot === null) settingsSnapshot = readStoredSettings();
  if (settingsListeners.size === 1) window.addEventListener("storage", onSettingsStorage);
  return () => {
    settingsListeners.delete(listener);
    if (!settingsListeners.size) window.removeEventListener("storage", onSettingsStorage);
  };
}

const getSettingsSnapshot = () => settingsSnapshot ?? DEFAULT_QUICK_SETTINGS;
const getServerSettingsSnapshot = () => DEFAULT_QUICK_SETTINGS;

export function useQuickSettings(): [QuickSettings, (patch: Partial<QuickSettings>) => void] {
  const settings = useSyncExternalStore(subscribeSettings, getSettingsSnapshot, getServerSettingsSnapshot);
  const update = useCallback((patch: Partial<QuickSettings>) => {
    settingsSnapshot = { ...(settingsSnapshot ?? DEFAULT_QUICK_SETTINGS), ...patch };
    try {
      window.localStorage.setItem(QUICK_SETTINGS_KEY, JSON.stringify(settingsSnapshot));
    } catch {
      // 隐私模式或存储被禁用：本次打开仍按新设置出题。
    }
    for (const listener of settingsListeners) listener();
  }, []);
  return [settings, update];
}

/** 预计用时：一题约 15 秒。 */
export function quickMinutes(size: number) {
  return Math.max(1, Math.round(size * 15 / 60));
}

/** 今天还能引入的新题：每日额度剩余与题库剩余取小。 */
export function quickFreshLeft(summary: Pick<QuickSummary, "newAvailable" | "newToday" | "dailyNewLimit">) {
  return Math.max(0, Math.min(summary.newAvailable, summary.dailyNewLimit - summary.newToday));
}

// ── 文案 ────────────────────────────────────────────────────────

// 题面、选项、课程素材保留原文，只切换指令、按钮、状态与分类标签。
export const QUICK_COPY = {
  // 外壳与标签
  "今日训练": ["今日训练", "今日の練習"],
  "能力画像": ["能力画像", "能力プロフィール"],
  "问题地图": ["问题地图", "課題マップ"],
  "训练语料": ["训练语料", "練習素材"],
  "日语训练": ["日语训练", "日本語トレーニング"],
  "日语训练摘要": ["日语训练摘要", "日本語トレーニングの概要"],
  "今天到期": ["今天到期", "今日の復習"],
  "今天已练": ["今天已练", "今日の練習"],
  "答对 {count}": ["答对 {count}", "正解 {count}"],
  "已学会": ["已学会", "覚えた"],
  "至少有一天首答答对的条目": ["至少有一天首答答对的条目", "少なくとも1日、初回で正解した項目"],
  "待复习": ["待复习", "復習待ち"],
  "明天 {count}": ["明天 {count}", "明日 {count}"],
  "7 天内 {count}": ["7 天内 {count}", "7日以内 {count}"],
  "未来 7 天到期": ["今天之后 7 天内会到期的条目", "今日以降7日以内に復習期限が来る項目"],
  "阶段条件说明": [
    "能修正＝有 1 天首答答对 · 能主动提取＝不同 2 天答对 · 训练稳定＝3 天答对且跨 7 天以上（只有二选一的题要 4 天且跨 14 天）",
    "修正できる＝1日初回正解・自分で言える＝別の2日に正解・定着＝3日正解かつ7日以上の間隔（二択のみの項目は4日・14日以上）",
  ],
  "未练新题": ["未练新题", "未学習の新規"],
  "能主动提取": ["能主动提取", "自分で言える"],
  "训练稳定": ["训练稳定", "定着"],
  "建立训练画像": ["建立训练画像", "練習プロフィールを作成"],
  "更新训练画像": ["更新训练画像", "練習プロフィールを更新"],
  "从已有面试复盘建立第一份课程": ["从已有面试复盘建立第一份课程", "面接の振り返りから最初のコースを作成"],
  "建立说明": [
    "核心抽取不调用 Codex，不会用通用JLPT内容凑数量，也不会修改任何逐字稿或复盘事实。",
    "抽出に Codex は使わず、汎用の JLPT 教材で数を埋めることも、文字起こしや振り返りの事実を書き換えることもありません。",
  ],
  "面试或岗位资料已经更新": ["面试或岗位资料已经更新", "面接・求人の資料が更新されました"],
  "更新后新证据才会出题": ["重建后，新证据才会进入快练。", "再作成すると新しい根拠がクイック練習に入ります。"],
  "正在读取快练": ["正在读取快练…", "クイック練習を読み込み中…"],
  "正在读取训练画像": ["正在读取训练画像…", "練習プロフィールを読み込み中…"],
  "重试": ["重试", "再試行"],
  "正在取题": ["正在取题", "問題を準備中"],
  "无法读取快练": ["无法读取快练", "クイック練習を読み込めません"],
  "正在重建面试证据课程": ["正在重建面试证据课程", "面接根拠のコースを再作成中"],
  "训练课程已写入 {path}": ["训练课程已写入 {path}", "コースを {path} に書き込みました"],
  "训练课程已是最新 {path}": ["训练课程没有变化，沿用 {path}", "コースに変更はありません（{path}）"],
  // 取组 20 秒、完整状态 45 秒、重建 120 秒各有各的上限，文案不写死秒数。
  "读取超时": ["请求超时，本机服务可能还在忙，稍后再试。", "タイムアウトしました。ローカルのサーバーが処理中かもしれません。少し待って再試行してください。"],
  // 入口卡
  "快练": ["快练", "クイック練習"],
  "开始快练": ["开始快练", "クイック練習を始める"],
  "到期 {due} · 新题 {fresh} · 约 {minutes} 分钟": ["今天到期 {due} · 新题 {fresh} · 约 {minutes} 分钟", "今日の復習 {due}・新規 {fresh}・約 {minutes} 分"],
  "每组": ["每组", "1セット"],
  "{count} 题": ["{count} 题", "{count} 問"],
  "开始 {count} 题": ["开始 {count} 题", "{count} 問を始める"],
  "再加一组新题": ["再加一组新题", "新規をもう1セット"],
  "设置": ["设置", "設定"],
  "打字题": ["打字题", "入力問題"],
  "打字题说明": ["偶尔出 ≤6 字的短输入，假名即可", "6 字以内の短い入力をときどき出題（かなで可）"],
  "首批优先": ["首批优先", "優先して出題"],
  "首批优先剩余": ["旧批次标「不会 / 犹豫」的还剩 {total} 条（不会 {unknown} · 犹豫 {uncertain}）", "以前「分からない／あいまい」とした項目が残り {total} 件（分からない {unknown}・あいまい {uncertain}）"],
  "首批优先已做完": ["旧批次标「不会 / 犹豫」的条目都已进入快练", "以前「分からない／あいまい」とした項目はすべて出題済み"],
  // 入口卡写「这一组」会出什么；每日额度退成小字。原来把额度当成本组新题数，点开却只来两道新题。
  "本组 {total} 题＝复习 {review}＋新题 {fresh} · 约 {minutes} 分钟": [
    "本组 {total} 题＝复习 {review}＋新题 {fresh} · 约 {minutes} 分钟",
    "このセット {total} 問＝復習 {review}＋新規 {fresh}・約 {minutes} 分",
  ],
  "今天还可学新题 {count}": ["今天还可学新题 {count}", "今日あと新規 {count} 問まで"],
  "本组不满：额度": ["今天剩下的新题额度不够，本组只有 {count} 题。", "今日の新規枠が足りないため、このセットは {count} 問だけです。"],
  "本组不满：没有更多": ["没有更多到期题，能出的新题也只剩这些，本组只有 {count} 题。", "復習も出題できる新規もこれ以上ないため、このセットは {count} 問だけです。"],
  "快速过一遍（还剩 {count} 条）": ["快速过一遍（还剩 {count} 条）", "ざっと仕分け（残り {count} 件）"],
  "快速过一遍说明": ["一屏一条，只决定新题先后，不算成绩", "1画面1件。新規の出題順だけを決め、成績には入りません"],
  "答对自动下一题": ["答对自动下一题", "正解なら自動で次へ"],
  "答对自动下一题说明": ["答对约 1 秒后进下一题；答错、不知道、翻卡仍停下", "正解なら約1秒で次へ。不正解・分からない・フリップでは止まります"],
  "已排除 {count} 条": ["已排除 {count} 条", "除外済み {count} 件"],
  "已排除说明": ["按 X「不再出」排除的条目；恢复后照常出题。", "X（今後出さない）で除外した項目。戻すと通常どおり出題されます。"],
  "只列最近 {count} 条": ["只列最近 {count} 条", "最新 {count} 件のみ表示"],
  "恢复": ["恢复", "戻す"],
  "已恢复": ["已恢复", "戻しました"],
  "暂不出题": ["暂不出题", "未出題"],
  "待补中文释义 {count} 条": ["待补中文释义 {count} 条（释义是日语的面试官用语，中文释义表里没有的暂不出题）", "中国語訳の未整備 {count} 件（訳が日本語の面接官表現のうち、中国語訳の表にないものは出題しません）"],
  "中文释义表补上 {count} 条": ["中文释义表补上了 {count} 条面试官用语", "中国語訳の表で面接官表現 {count} 件を補いました"],
  "単語文法帳 {count} 条": ["単語文法帳已解析 {count} 条", "単語文法帳から {count} 件を読み込み"],
  "{count} 条练习记录对不上": ["有 {count} 条练习记录找不到对应条目（课程重建或改了表記之后）", "練習記録 {count} 件に対応する項目が見つかりません（コース再作成や表記の変更後）"],
  "今天没有可出的题": ["现在没有到期题，题库里也没有新题了。", "いまは復習も新規もありません。"],
  "今天新题额度已用完，可再加": ["今天的新题额度已用完；想多练可以再加一组新题。", "今日の新規枠を使い切りました。続けるなら新規をもう1セット追加できます。"],
  "这一类现在没有可出的题": ["这一类现在没有可出的题。", "この課題はいま出題できる問題がありません。"],
  // 针对练习取不到卡的三种原因（服务端 emptyReason）；服务端的 emptyMessage 只有中文，界面自己写两份。
  "针对练习：没有这一类": ["这一类问题已不在当前课程里（课程可能刚重建），请回到总览重新选。", "この課題は現在のコースにありません（コースが再作成された可能性があります）。概要から選び直してください。"],
  "针对练习：没有可出题": ["这一类目前没有能出题的条目（可能都已排除或只有模板）。", "この課題にはいま出題できる項目がありません（すべて除外済みか、型カードのみです）。"],
  "针对练习：现在没题": ["这一类今天能出的题都练过了：没有到期题，今天的新题额度也已用完。", "この課題で今日出せる問題は終わりました（復習期限のものがなく、今日の新規枠も使い切りました）。"],
  "现在最值得修": ["现在最值得修", "いま直したい課題"],
  "{interviews} 场 · {count} 次证据": ["{interviews} 场 · {count} 次证据", "{interviews} 回・根拠 {count} 件"],
  // 回答结构类的证据次数在课程里被截在 12 条，写出来反而误导；只写场数。
  "{interviews} 场": ["{interviews} 场", "{interviews} 回"],
  "可练 {count} 条": ["可练 {count} 条", "練習できる {count} 件"],
  "练这个": ["练这个", "これを練習"],
  "练这个：{label}": ["针对「{label}」练一组", "「{label}」を集中して1セット"],
  "策略类说明": ["回答结构类问题在快练里只有模板卡；整段回答去「回答重练」练。", "回答の構成に関する課題はクイック練習では型カードだけです。回答全体は「回答の練り直し」で練習してください。"],
  "针对练习 · {focus}": ["针对练习 · {focus}", "集中練習・{focus}"],
  "最近练习": ["最近练习", "最近の練習"],
  "完成第一组后": ["完成第一组（≥5 题）后，这里会显示每组的答对数。", "最初のセット（5 問以上）を終えると、ここにセットごとの正答数が出ます。"],
  // 分母是自动判分的首答数（翻卡自评不算），与小结的「答对 7 / 判分 9」同一口径。
  "{time} · {count} 题 · 答对 {correct} / {graded}": ["{time} · {count} 题 · 答对 {correct} / {graded}", "{time}・{count} 問・正解 {correct} / {graded}"],
  "{time} · {count} 题 · 答对 {correct}": ["{time} · {count} 题 · 答对 {correct}", "{time}・{count} 問・正解 {correct}"],
  "到期 {due} · 新题 {fresh}": ["到期 {due} · 新题 {fresh}", "復習 {due}・新規 {fresh}"],
  // 练习屏
  "已保存": ["已保存", "保存済み"],
  "保存中": ["保存中", "保存中"],
  "{count} 题待保存": ["{count} 题待保存", "未保存 {count} 問"],
  "保存失败，稍后重试": ["保存失败，稍后重试", "保存に失敗・再試行します"],
  "{count} 题未能保存": ["{count} 题未能保存（服务端拒收）", "{count} 問は保存できませんでした（サーバーが拒否）"],
  "本组进度": ["本组进度", "セットの進み具合"],
  "本次用时": ["本次用时", "今回の経過"],
  "结束本组": ["结束本组", "セットを終える"],
  "重出": ["重出", "再出題"],
  "不知道": ["不知道", "分からない"],
  "这题有问题": ["这题有问题，不再出", "この問題は不適切・今後出さない"],
  "揭晓": ["揭晓", "答えを見る"],
  "记得": ["记得", "覚えていた"],
  "模糊": ["模糊", "あいまい"],
  "忘了": ["忘了", "忘れた"],
  "确定": ["确定", "決定"],
  "输入提示": ["用日语输入法，假名即可 · 设置里可关闭打字题", "日本語入力で（かなで可）・設定で入力問題をオフにできます"],
  "下一题": ["下一题", "次へ"],
  "不填": ["不填", "入れない"],
  "答对了": ["答对了", "正解"],
  "这次没对": ["这次没对", "不正解"],
  "已显示答案": ["已显示答案", "答えを表示"],
  "自评": ["自评", "自己評価"],
  "自评：{rating}": ["自评：{rating}", "自己評価：{rating}"],
  "日语": ["日语", "日本語"],
  "正确答案": ["正确答案", "正解"],
  "你的回答": ["你的回答", "あなたの回答"],
  "你当时说": ["你当时说", "当時の言い方"],
  "读音": ["读音", "読み"],
  "出处": ["出处", "出典"],
  "服务端判为正确": ["保存时服务端判为正确，以服务端为准。", "保存時にサーバーが正解と判定しました（サーバーを優先）。"],
  "服务端判为错误": ["保存时服务端判为错误，以服务端为准。", "保存時にサーバーが不正解と判定しました（サーバーを優先）。"],
  "反馈占位": ["答完这里显示对错、正确答案、读音与出处", "回答後にここへ正誤・正解・読み・出典が出ます"],
  "按键": ["按键", "キー操作"],
  "选择": ["选择", "選ぶ"],
  "答对 {pass} · 答错 {fail}": ["答对 {pass} · 答错 {fail}", "正解 {pass}・不正解 {fail}"],
  "第 {index} 题": ["第 {index} 题", "{index} 問目"],
  "太简单": ["太简单", "簡単すぎ"],
  "太简单说明": ["太简单：30 天后用辨析题验证一次，不算答对", "簡単すぎ：30日後に識別問題で一度確認（正解には数えません）"],
  "标了太简单": ["标了太简单：30 天后用辨析题验证一次", "簡単すぎ：30日後に識別問題で一度確認します"],
  "已标记不再出": ["已标记不再出", "今後出さないに設定"],
  "已不再出这题": ["已不再出这题", "この問題は今後出しません"],
  "撤销": ["撤销", "取り消す"],
  "回看": ["回看上一题", "前の問題を見る"],
  "回看中": ["回看中 · 只读，不能改答案", "振り返り中・読み取り専用（回答は変えられません）"],
  "往后看": ["往后看", "次を見る"],
  "回到当前题": ["回到当前题", "現在の問題へ"],
  "自动下一题提示": ["答对了 · 约 1 秒后下一题，按任意键或点击停留", "正解・約1秒で次へ（キーかクリックで止まります）"],
  "再按一次结束": ["再按一次结束", "もう一度押して終了"],
  "再按一次 Esc 结束": ["才答了 {done} / {total} 题，2 秒内再按一次 Esc 结束", "{done} / {total} 問しか答えていません。2秒以内にもう一度 Esc で終了"],
  // 小结
  "本组小结": ["本组小结", "セットの結果"],
  "{count} 题快练": ["{count} 题快练", "{count} 問のクイック練習"],
  "本次专注 {time}": ["本次专注 {time}", "今回の集中 {time}"],
  "正确率": ["正确率", "正答率"],
  "答对 {correct} / 判分 {total}": ["答对 {correct} / 判分 {total}", "正解 {correct} / 採点 {total}"],
  "只算首答的判分题": ["只算每题第一次作答的判分题，自评另计", "各問の初回回答（自動採点）のみ。自己評価は別集計"],
  "本组": ["本组", "このセット"],
  "自评 {count} 题另计": ["自评 {count} 题另计：记得 {remembered} · 模糊 {fuzzy} · 忘了 {forgot}", "自己評価 {count} 問は別集計：覚えていた {remembered}・あいまい {fuzzy}・忘れた {forgot}"],
  "重出 {count} 题：改对 {fixed}": ["重出 {count} 题：改对 {fixed}", "再出題 {count} 問：正解に {fixed}"],
  "不知道 {count} 题": ["不知道 {count} 题", "分からない {count} 問"],
  "不再出 {count} 题": ["标记不再出 {count} 题", "今後出さない {count} 問"],
  "太简单 {count} 题": ["太简单 {count} 题（30 天后验证，不计正确率）", "簡単すぎ {count} 問（30日後に確認・正答率には含めない）"],
  "下次复习": ["下次复习", "次の復習"],
  "今天 {count} 题": ["今天 {count} 题", "今日 {count} 問"],
  "明天 {count} 题": ["明天 {count} 题", "明日 {count} 問"],
  "{days} 天后 {count} 题": ["{days} 天后 {count} 题", "{days} 日後 {count} 問"],
  "保存完后显示": ["保存完后显示", "保存後に表示"],
  "本组排除的条目": ["本组排除的条目", "このセットで除外した項目"],
  "展开升阶条目": ["展开升阶条目", "上がった項目を表示"],
  "本组升阶": ["本组升阶", "ステージが上がった項目"],
  "项": ["项", "項目"],
  "回落 {count} 项": ["回落 {count} 项", "{count} 項目が後退"],
  "{count} 题尚未保存": ["{count} 题尚未保存，保存后才能确认升阶", "{count} 問が未保存のため、確定後に表示します"],
  "按服务端应答": ["按服务端保存应答统计", "サーバーの保存応答から集計"],
  "错题回看": ["错题回看", "間違えた問題"],
  "你选了": ["你选了", "あなたの回答"],
  "需要复习": ["自评：需要复习", "自己評価：要復習"],
  "重出后答对": ["重出后答对", "再出題で正解"],
  "重出仍错": ["重出仍错", "再出題も不正解"],
  "全部答对": ["这一组没有错题。", "このセットは全問正解です。"],
  "本组没有作答": ["这一组还没有作答。", "このセットはまだ回答がありません。"],
  "今天还剩": ["今天还剩", "今日の残り"],
  "再来一组": ["再来一组", "もう1セット"],
  "回到总览": ["回到总览", "概要に戻る"],
  // 节奏带：快练叫「组／题／答对」，旧集中训练的「批／项／命中」已不在界面上出现。
  "连续训练": ["连续训练", "連続練習"],
  "天": ["天", "日"],
  "{day} · {sets} 组 · {items} 题": ["{day} · {sets} 组 · {items} 题", "{day}・{sets} セット・{items} 問"],
  "今天已完成": ["今天已完成", "今日は完了"],
  "保持中 · 今天还没练": ["保持中 · 今天还没练", "継続中 · 今日はまだ"],
  // 少于 5 题的组不进历史（QUICK_HISTORY_MIN_FIRST）：写进提示，免得做了 4 题就退出的人奇怪为什么没计数。
  "完成一组后开始计数": ["完成一组（≥5 题）后开始计数", "1セット（5問以上）で開始"],
  "近 14 天": ["近 14 天", "直近 14 日"],
  "近 7 天 {week} 天 · 近 14 天 {fortnight} 天": ["近 7 天 {week} 天 · 近 14 天 {fortnight} 天", "直近7日 {week} 日・14日 {fortnight} 日"],
  "掌握阶段分布": ["掌握阶段分布", "習得ステージの分布"],
  "未见过": ["未见过", "未学習"],
  "能识别": ["能识别", "認識できる"],
  "能修正": ["能修正", "修正できる"],
  "能迁移使用": ["能迁移使用", "応用できる"],
  // 能力画像：阶段格与今日训练同一来源（summary.stageCounts），说明按快练的规则写。
  "能力画像范围": [
    "统计范围：快练可出题的 {drillable} 条（含単語文法帳 {notebook} 条），与今日训练同一口径",
    "集計範囲：クイック練習で出題できる {drillable} 件（単語文法帳 {notebook} 件を含む）。今日の練習と同じ基準",
  ],
  "未见过说明": ["还没在快练里作答过", "クイック練習でまだ回答していない"],
  "能识别说明": ["翻卡自评、「太简单」与旧扫描自报最多到这里", "フリップの自己評価・「簡単すぎ」・旧スキャンの自己申告はここまで"],
  "能修正说明": ["有 1 天首答答对", "1日、初回で正解"],
  "能主动提取说明": ["不同 2 天首答答对", "別の2日に初回で正解"],
  "能迁移使用说明": ["快练暂不判定这一级", "クイック練習ではこの段階を判定しません"],
  "训练稳定说明": ["3 天答对且跨 7 天以上", "3日正解かつ7日以上の間隔"],
  "结构化面试": ["结构化面试", "構造化した面接"],
  "已确认本人错误": ["已确认本人错误", "確認済みの本人の誤り"],
  "回答复盘块": ["回答复盘块", "回答の振り返りブロック"],
  "本人标记听解缺口": ["本人标记听解缺口", "本人が付けた聞き取りの穴"],
  "听解说明": [
    "当前没有本人标记的“△推测／×没听懂”，因此系统只训练面试官表达识别，不把它描述成听力缺陷。",
    "本人による「△推測／×聞き取れず」の印がまだないため、面接官表現の認識だけを練習し、聞き取りの弱点とは扱いません。",
  ],
  "深度复盘晚于本人反馈": ["以下深度复盘晚于本人反馈，需要先重建：", "以下の詳細な振り返りは本人のフィードバックより新しいため、先に再作成が必要です："],
  "跨面试复发模式": ["跨面试复发模式", "面接をまたいで繰り返す課題"],
  "{interviews} 场 / {count} 次": ["{interviews} 场 / {count} 次", "{interviews} 回 / {count} 件"],
  "来源": ["来源", "出典"],
  "个人词汇、语法和面试表达": ["个人词汇、语法和面试表达", "個人の語彙・文法・面接表現"],
  "类型": ["类型", "種類"],
  "中文功能": ["中文功能", "中国語での機能"],
  "状态": ["状态", "状態"],
  // 分流屏（一屏过一遍）
  "快速过一遍": ["快速过一遍", "ざっと仕分け"],
  "分流说明": [
    "一屏一条：会按 1、不确定按 2、不会按 3。不算成绩，只决定新题的出题先后；标「会」的以后会抽查验证。",
    "1画面に1件：分かる 1・あいまい 2・分からない 3。成績には入らず、新規の出題順だけが変わります。「分かる」とした項目も後で確認の出題があります。",
  ],
  "会": ["会", "分かる"],
  "不确定": ["不确定", "あいまい"],
  "不会": ["不会", "分からない"],
  "上一条": ["上一条（改判）", "前の項目（判定し直す）"],
  "下一条": ["下一条", "次の項目"],
  "结束": ["结束", "終える"],
  "分流进度": ["分流进度", "仕分けの進み具合"],
  "正在取条目": ["正在取条目…", "項目を準備中…"],
  "没有要过的条目": ["没有还没过的新条目了。", "仕分けが必要な新しい項目はありません。"],
  "这一轮过完了": ["这一轮过完了", "この回の仕分けが終わりました"],
  "会 {known} · 不确定 {uncertain} · 不会 {unknown}": ["会 {known} · 不确定 {uncertain} · 不会 {unknown}", "分かる {known}・あいまい {uncertain}・分からない {unknown}"],
  "已判：{judgment}": ["已判：{judgment}", "判定：{judgment}"],
  "意思": ["意思", "意味"],
  // 洞察标签与训练语料
  "主动词块": ["主动词块", "表現の想起"],
  "错误修正": ["错误修正", "誤りの修正"],
  "面试官表达": ["面试官表达", "面接官の表現"],
  "回答结构": ["回答结构", "回答の構成"],
  "岗位技术": ["岗位技术", "職種の技術用語"],
  "事实口径": ["事实口径", "事実の表現"],
  "全部": ["全部", "すべて"],
} as const satisfies Record<string, readonly [string, string]>;

export type QuickCopyKey = keyof typeof QUICK_COPY;

export const QUICK_PROMPT_COPY: Record<QuickPromptKey, readonly [string, string]> = {
  meaning: ["选出这句日语的意思", "意味を選んでください"],
  reading: ["选出正确的读音", "正しい読み方を選んでください"],
  word: ["选出对应的日语", "当てはまる日本語を選んでください"],
  cloze_particle: ["选出空格里的助词", "空欄に入る助詞を選んでください"],
  natural: ["哪个说法更自然？", "より自然な言い方はどちら？"],
  natural_calque: ["哪个是自然的日语？", "自然な日本語はどちら？"],
  input_particle: ["输入空格里的助词", "空欄の助詞を入力"],
  input_fix: ["把高亮的部分改成正确的说法", "ハイライト部分を正しく直して入力"],
  input_word: ["输入对应的日语", "当てはまる日本語を入力"],
  input_reading: ["输入读音（假名）", "読み方をかなで入力"],
  flip_meaning: ["先回想意思，再揭晓", "意味を思い出してから答えを見る"],
  flip_word: ["先回想日语说法，再揭晓", "日本語を思い出してから答えを見る"],
  flip_fix: ["先回想正确的说法，再揭晓", "正しい言い方を思い出してから答えを見る"],
  flip_pattern: ["先回想完整句型，再揭晓", "文型の全体を思い出してから答えを見る"],
};

export const QUICK_TYPE_COPY: Record<QuickCardType, readonly [string, string]> = {
  meaning_choice: ["识义", "意味"],
  reading_choice: ["读音", "読み"],
  word_choice: ["识词", "語彙"],
  cloze_choice: ["助词填空", "助詞の穴埋め"],
  natural_choice: ["哪个更自然", "自然さ"],
  short_input: ["短输入", "短答入力"],
  flip: ["翻卡", "フリップ"],
};

export const QUICK_GROUP_COPY: Record<QuickGroup, readonly [string, string]> = {
  error_patch: ["错误修正", "誤りの修正"],
  interviewer_phrase: ["面试官表达", "面接官の表現"],
  active_chunk: ["主动词块", "表現の想起"],
  answer_strategy: ["回答结构", "回答の構成"],
  nb_calque: ["単語文法帳 · 中式说法", "単語文法帳・中国語式"],
  nb_term: ["単語文法帳 · 用语", "単語文法帳・用語"],
  nb_katakana: ["単語文法帳 · 片假名", "単語文法帳・カタカナ"],
  nb_keigo: ["単語文法帳 · 敬语", "単語文法帳・敬語"],
  nb_verb: ["単語文法帳 · 动词", "単語文法帳・動詞"],
  nb_pattern: ["単語文法帳 · 句型", "単語文法帳・文型"],
  nb_number: ["単語文法帳 · 数字读法", "単語文法帳・数字の読み"],
};

export const QUICK_REASON_COPY: Record<QuickCardReason, readonly [string, string]> = {
  due: ["到期复习", "復習"],
  lapsed: ["今天答错过", "今日のミス"],
  new: ["新题", "新規"],
  early: ["提前复习", "前倒し復習"],
};

export const QUICK_RATING_COPY: Record<QuickSelfRating, readonly [string, string]> = {
  remembered: ["记得", "覚えていた"],
  fuzzy: ["模糊", "あいまい"],
  forgot: ["忘了", "忘れた"],
};

export function useQuickCopy() {
  const { locale } = useUiLocale();
  const index = locale === "ja" ? 1 : 0;
  const t = (key: QuickCopyKey, values: Record<string, string | number> = {}) =>
    QUICK_COPY[key][index].replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
  const label = (value: string) => Object.hasOwn(QUICK_COPY, value) ? t(value as QuickCopyKey) : value;
  const pick = (pair: readonly [string, string]) => pair[index];
  return { t, label, pick, locale };
}
