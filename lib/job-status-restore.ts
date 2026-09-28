import { normalizeJobStatus } from "./job-status.ts";

/*
 * 看板「已改为 X · 撤销」的撤销写入。
 *
 * 为什么不直接复用状态写入：状态写入会顺手推进 status_updated、补 applied_on、终结时清掉等待字段——
 * 撤销要的是「把刚才那一次动过的键原样放回去」，再走一遍状态规则就会把这些副作用又做一次。
 * 所以撤销只接受一张「键 → 旧值」的表，而且键只能是状态写入可能动过的那几个。
 */

/** 状态写入可能改动的键。撤销只许碰这些——别的字段不是这次写入动的，放回去就是在改无关的事实。 */
export const JOB_STATUS_RESTORE_KEYS = [
  "status",
  "status_updated",
  "channel",
  "applied_on",
  "waiting_for",
  "follow_up_at",
  "follow_up_action",
  "next_event_at",
] as const;

export type JobStatusRestoreKey = (typeof JOB_STATUS_RESTORE_KEYS)[number];

/** 旧值再长也不该超过这个数：frontmatter 的单行标量，超长多半是把正文误塞了进来。 */
export const JOB_STATUS_RESTORE_VALUE_MAX = 300;

/**
 * 写回用的是 patchFrontmatterScalars，它把值原样拼成 `key: value`，不加引号。
 * 旧值来自 Obsidian 解析后的 frontmatter，原来的引号已经没了——`返信: 日程調整` 这种值不加引号写回去，
 * 整个 frontmatter 就解析失败，案件从看板和统计里一起消失。所以只放行「不加引号也能原样读回来」的值。
 * 规则与状态注记（jobStatusNoteError）同源，再加上 YAML 的起始指示符。
 */
export function yamlPlainScalarError(text: string): string | null {
  if (/:(\s|$)/.test(text) || /^#/.test(text) || /\s#/.test(text)) return "含有「: 」或 #";
  if (/^[?:,[\]{}&*!|>'"%@`]/.test(text) || /^-(\s|$)/.test(text)) return "以 YAML 指示符开头";
  if (text !== text.trim()) return "首尾有空白";
  return null;
}

/** 原本是字符串、但不加引号写回就会变成别的类型（null・布尔・数字）的值。 */
function retypesWhenUnquoted(text: string) {
  // null・布尔（含 YAML 1.1 的 yes/no/on/off）
  if (/^(~|null|true|false|yes|no|on|off|y|n)$/i.test(text)) return true;
  // 数字：十进制（可带下划线・小数・指数）、0b/0o/0x、.inf/.nan——js-yaml（vault:check 用它）会读成数字。
  return /^[-+]?(0b[01_]+|0o[0-7_]+|0x[0-9a-f_]+|[0-9][0-9_]*(\.[0-9_]*)?(e[-+]?[0-9]+)?|\.[0-9][0-9_]*(e[-+]?[0-9]+)?|\.inf)$/i.test(text)
    || /^\.nan$/i.test(text);
}

/**
 * 状态写入只在案件还没有 channel / applied_on 时才补写它们（channel 是历史事实，不随状态改写）。
 * 所以这两个键的「旧值」只可能是「原来没有」——撤销只许把它们删掉，不许借撤销写入任意渠道。
 */
const DELETE_ONLY_KEYS: readonly string[] = ["channel", "applied_on"];

function badRequest(message: string) {
  // 带 status 的 Error 会被 errorResponse 原样映射成 400，调用方就知道是请求本身有问题，不必重试。
  return Object.assign(new Error(message), { status: 400 });
}

/**
 * 校验撤销请求的 restore 表。null 表示「写入前没有这个键」＝删掉它。
 * 返回整理后的表（值已 trim）；不合规时抛出可读的中文错误。
 */
export function validateJobStatusRestore(raw: unknown): Record<JobStatusRestoreKey, string | null> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw badRequest("restore 必须是「字段 → 旧值」的对象。");
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) throw badRequest("restore 至少要有一个字段。");
  const allowed: readonly string[] = JOB_STATUS_RESTORE_KEYS;
  const result = {} as Record<JobStatusRestoreKey, string | null>;
  for (const [key, value] of entries) {
    if (!allowed.includes(key)) {
      throw badRequest(`撤销不能改动字段「${key}」。只允许：${JOB_STATUS_RESTORE_KEYS.join(" / ")}`);
    }
    if (value === null) {
      result[key as JobStatusRestoreKey] = null;
      continue;
    }
    if (DELETE_ONLY_KEYS.includes(key)) {
      throw badRequest(`字段「${key}」只能撤销为「删除」：状态写入只会补写原本没有的 ${key}。`);
    }
    if (typeof value !== "string") throw badRequest(`字段「${key}」的旧值必须是文本或 null。`);
    const text = value.trim();
    if (/\r|\n/.test(text)) throw badRequest(`字段「${key}」只允许单行值。`);
    const yamlError = yamlPlainScalarError(text);
    if (yamlError) throw badRequest(`字段「${key}」的旧值${yamlError}，不加引号写回会破坏 frontmatter，无法撤销。`);
    if (text.length > JOB_STATUS_RESTORE_VALUE_MAX) {
      throw badRequest(`字段「${key}」的旧值超过 ${JOB_STATUS_RESTORE_VALUE_MAX} 字，拒绝写回。`);
    }
    // status 写回去也必须是 7 个枚举之一（可带括号注记），否则看板会静默把它当成无效状态。
    if (key === "status" && normalizeJobStatus(text) === null) {
      throw badRequest(`要写回的状态「${text || "(空)"}」不是 7 个应募状态之一，无法撤销。`);
    }
    result[key as JobStatusRestoreKey] = text;
  }
  return result;
}

/**
 * 状态写入成功后，为「这次动过的键」记下旧值，作为撤销的 restore 表。
 * 旧值是数组・对象这类无法按标量写回的形状时返回 null——宁可不给撤销，也不写回一个变了形的值。
 * 整张表还要能通过 validateJobStatusRestore：通不过的撤销按钮只会在点下去时报错，不如一开始就不出。
 */
export function buildJobStatusUndo(
  previous: Record<string, unknown>,
  touchedKeys: readonly string[],
): Record<string, string | null> | null {
  const undo: Record<string, string | null> = {};
  for (const key of touchedKeys) {
    const value = previous[key];
    // 空串与「没有这个键」在看板上是同一个意思；按删除撤销，避免写回一个 `key: ` 空行。
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) undo[key] = null;
    else if (typeof value === "string") {
      // 原本带引号的 "true"・"123" 之类，不加引号写回就换了类型：不给撤销。
      if (retypesWhenUnquoted(value.trim())) return null;
      undo[key] = value;
    }
    // 原本就是数字・布尔：不加引号写回恰好还原成同一类型。
    else if (typeof value === "number" || typeof value === "boolean") undo[key] = String(value);
    else return null;
  }
  try {
    validateJobStatusRestore(undo);
  } catch {
    return null;
  }
  return undo;
}
