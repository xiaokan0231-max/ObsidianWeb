import type { QuickAction, QuickCardType, QuickEvent, QuickSelfRating, QuickTriageJudgment } from "./quick-types.ts";
import { quickDay } from "./quick-progress.ts";

// 练习日的换算放在 quick-progress.ts（到期日也要用同一个起点）；这里转出口，旧的 import 路径不用改。
export { quickDay };

/*
 * 快练事件日志：一题一条不可变事件，按练习日所在的月追加到一份笔记里。
 *
 * 为什么按月而不是按日：数据字典的 type 统计按文件数算，按日建文件会让统计每天漂移、
 * Stop hook 天天拦；按月只在每月第一次作答时多一份。
 * 为什么用 HTML 注释行而不是 JSON 区块：追加只需拼字符串，不必重写整份 JSON；
 * 坏一行只丢一行，过去的作答仍能回放（与专项训练的进度日志同一做法）。
 */

export const QUICK_LOG_DIR = "30_日本語学習/快練ログ";
export const QUICK_LOG_TYPE = "language-quick-log";
export const QUICK_EVENT_MARKER = "language-quick-event";

const QUICK_CARD_TYPES: readonly QuickCardType[] = [
  "meaning_choice",
  "reading_choice",
  "word_choice",
  "cloze_choice",
  "natural_choice",
  "short_input",
  "flip",
];
const QUICK_ACTIONS: readonly QuickAction[] = ["answer", "suspend", "restore", "easy", "triage"];
const QUICK_RATINGS: readonly QuickSelfRating[] = ["remembered", "fuzzy", "forgot"];
const QUICK_JUDGMENTS: readonly QuickTriageJudgment[] = ["known", "uncertain", "unknown"];

/**
 * 练习日 → 当月日志路径。传入的必须已是练习日（quickDay 的输出）：直接用 UTC 日期会在月末错位。
 * 月初 0:00–4:00 的作答属于上个月最后一个练习日，因此写进上个月的文件——回放按 at 排序，与文件归属无关。
 */
export function quickLogPath(day: string) {
  const month = /^(\d{4}-\d{2})/u.exec(day)?.[1];
  if (!month) throw new Error(`快练日志需要 YYYY-MM-DD 形式的练习日：${day}`);
  return `${QUICK_LOG_DIR}/${month}_快練ログ.md`;
}

/** 新建当月日志时客户端要拿到的 frontmatter（upsertAppendNote 的 frontmatterForNew）。 */
export function quickLogFrontmatter(month: string) {
  return { type: QUICK_LOG_TYPE, month, layer: "user-action", schema_version: 1 };
}

/** 新建当月日志的全文（不含事件）。month 写成带引号的字符串，否则 YAML 会把 2026-10 读成别的类型。 */
export function renderQuickLogNote(month: string) {
  return `---
type: ${QUICK_LOG_TYPE}
month: ${JSON.stringify(month)}
layer: user-action
schema_version: 1
---
# ${month} 快練ログ

> 快练逐题作答的追加式记录，由 Web 写入，请勿手改。掌握阶段由全部事件回放得出。

## 作答イベント
`;
}

/**
 * 一条事件的注释行。转义同专项训练日志：「<」与「--」写成 JSON 的 \u 转义，
 * 这样 response 里出现「-->」或「<!--」也关不掉、开不了注释，JSON.parse 读回原文。
 */
export function renderQuickEvent(event: QuickEvent) {
  const json = JSON.stringify(event).replace(/</gu, "\\u003c").replace(/--/gu, "\\u002d\\u002d");
  return `<!-- ${QUICK_EVENT_MARKER}:${json} -->`;
}

/** 把事件追加到当月日志：existing 为 null 时先建骨架。服务端在写入队列里拿它组 PUT 全文。 */
export function appendQuickEvents(existing: string | null, day: string, events: readonly QuickEvent[]) {
  const base = existing ?? renderQuickLogNote(day.slice(0, 7));
  const head = base.endsWith("\n") ? base : `${base}\n`;
  return `${head}${events.map((event) => `${renderQuickEvent(event)}\n`).join("")}`;
}

function optionalBoolean(value: unknown) {
  return value === undefined || typeof value === "boolean";
}

function normalizeEvent(raw: unknown): QuickEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.eventId !== "string" || !value.eventId) return null;
  if (typeof value.setId !== "string" || !value.setId) return null;
  if (typeof value.itemId !== "string" || !value.itemId) return null;
  if (typeof value.setSize !== "number" || !Number.isFinite(value.setSize)) return null;
  if (!QUICK_CARD_TYPES.includes(value.type as QuickCardType)) return null;
  if (!QUICK_ACTIONS.includes(value.action as QuickAction)) return null;
  if (typeof value.first !== "boolean") return null;
  if (typeof value.at !== "string" || !quickDay(value.at)) return null;
  if (value.response !== undefined && typeof value.response !== "string") return null;
  if (value.rating !== undefined && !QUICK_RATINGS.includes(value.rating as QuickSelfRating)) return null;
  // 分流判断必须带合法的 judgment；别的动作即使带了也丢掉，不让它流进选题。
  const triage = value.action === "triage";
  if (triage && !QUICK_JUDGMENTS.includes(value.judgment as QuickTriageJudgment)) return null;
  if (!optionalBoolean(value.passed) || !optionalBoolean(value.gaveUp)) return null;
  if (value.elapsedMs !== undefined && (typeof value.elapsedMs !== "number" || !Number.isFinite(value.elapsedMs))) return null;
  // 只留契约里的键：日志被手改塞进别的字段时，不让它流进回放和接口应答。
  return {
    eventId: value.eventId,
    setId: value.setId,
    setSize: value.setSize,
    itemId: value.itemId,
    type: value.type as QuickCardType,
    action: value.action as QuickAction,
    response: (value.response as string | undefined) ?? "",
    ...(value.rating !== undefined ? { rating: value.rating as QuickSelfRating } : {}),
    ...(value.gaveUp !== undefined ? { gaveUp: value.gaveUp as boolean } : {}),
    ...(triage ? { judgment: value.judgment as QuickTriageJudgment } : {}),
    ...(value.passed !== undefined ? { passed: value.passed as boolean } : {}),
    first: value.first,
    at: value.at,
    ...(value.elapsedMs !== undefined ? { elapsedMs: value.elapsedMs as number } : {}),
  };
}

/** 读出一份日志里的全部事件（文件内顺序）。坏行跳过：一行写坏不能让整月的作答都回放不出来。 */
export function parseQuickEvents(content: string): QuickEvent[] {
  const events: QuickEvent[] = [];
  const pattern = new RegExp(`<!--\\s*${QUICK_EVENT_MARKER}:(\\{[\\s\\S]*?\\})\\s*-->`, "gu");
  for (const match of content.matchAll(pattern)) {
    try {
      const event = normalizeEvent(JSON.parse(match[1]));
      if (event) events.push(event);
    } catch {
      // 坏行跳过。
    }
  }
  return events;
}

export type QuickLogNote = { path: string; content: string; frontmatter?: Record<string, unknown> };

/**
 * frontmatter 里没有 type 时（测试、只拿到原文的调用方，或刚新建的当月日志——Obsidian 的 metadata cache
 * 还没追上，接口返回空 frontmatter）从正文开头的 YAML 里认 type。否则每月第一批作答会在下一次读取时「消失」，
 * 首答与阶段都按没答过算。
 */
function isQuickLogNote(note: QuickLogNote) {
  const declared = String(note.frontmatter?.type ?? "").trim();
  if (declared) return declared === QUICK_LOG_TYPE;
  const head = /^---\n([\s\S]*?)\n---/u.exec(note.content)?.[1] ?? "";
  return new RegExp(`^type:\\s*["']?${QUICK_LOG_TYPE}["']?\\s*$`, "mu").test(head);
}

/**
 * 全库的快练事件，按 (at, 路径, 文件内顺序) 排序；同一 eventId 只留最早一条。
 * 写入路径已经全库去重，这里再去一次是兜底：两台机器各自追加过同一条时，回放不能把它算两次。
 */
export function collectQuickEvents(notes: readonly QuickLogNote[]): QuickEvent[] {
  const entries: Array<{ event: QuickEvent; path: string; order: number }> = [];
  for (const note of notes) {
    if (!isQuickLogNote(note)) continue;
    parseQuickEvents(note.content).forEach((event, order) => entries.push({ event, path: note.path, order }));
  }
  entries.sort((left, right) =>
    left.event.at.localeCompare(right.event.at)
    || left.path.localeCompare(right.path)
    || left.order - right.order
  );
  const seen = new Set<string>();
  const events: QuickEvent[] = [];
  for (const { event } of entries) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    events.push(event);
  }
  return events;
}

/**
 * 只有作答与「太简单」算「这题已经答过」。分流、撤销排除不是作答；「不再出」也不是：
 * 题面阶段按了 X 再撤销，那张卡会回到当前位置重新作答，那才是本人第一次回答它。
 * 若把同组的 suspend 也算进去，撤销后的作答永远判不成首答，条目一直停在新题。
 */
function answeredBefore(event: QuickEvent) {
  return event.action === "answer" || event.action === "easy";
}

/**
 * 这一题算不算首答（只有首答影响成败）。events 是此前已落盘的事件。
 * 两个条件缺一不可：
 * - 当日（练习日）该条目没有更早的作答或「太简单」：答错后同一天再答对拿不到成功日；
 * - 同一组里该条目没有更早的作答或「太简单」：一组跨过练习日起点时，组内重出不能因为换了日期就变成新一天的首答。
 */
export function isFirstAnswer(
  events: readonly QuickEvent[],
  { itemId, day, setId }: { itemId: string; day: string; setId: string },
) {
  return !events.some((event) =>
    event.itemId === itemId
    && answeredBefore(event)
    && (event.setId === setId || quickDay(event.at) === day)
  );
}

/**
 * 「一屏过一遍」的分流判断：条目 → 最后一次判断。events 须按时间排序（collectQuickEvents 的输出），
 * 改主意时以最后一次为准。
 */
export function collectTriageJudgments(events: readonly QuickEvent[]): Map<string, QuickTriageJudgment> {
  const judgments = new Map<string, QuickTriageJudgment>();
  for (const event of events) {
    if (event.action === "triage" && event.judgment) judgments.set(event.itemId, event.judgment);
  }
  return judgments;
}
