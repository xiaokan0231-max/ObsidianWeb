import { interviewNoteTime, resolveInterviewOwner } from "./calendar-interview.ts";
import { interviewSessionOwner } from "./interview-outcome.ts";
import { getString, getType, type Note } from "./notes.ts";
import { includeRuntimeNote } from "./vault-boundary.mjs";

export type SelectionNotice = {
  id: string;
  date: string;
  time: string;
  stage: string;
  outcome: "rejected" | "passed" | "offer" | "other";
  channel: string;
  sourceUrl?: string;
  sourcePath?: string;
  reasonStatus: "not-stated" | "explicit" | "unknown";
  capture: "full" | "excerpt";
  original: string;
};

const START = "<!-- selection-notice:original -->";
const END = "<!-- /selection-notice:original -->";
const OUTCOMES = new Set<SelectionNotice["outcome"]>(["rejected", "passed", "offer", "other"]);
const CAPTURES = new Set<SelectionNotice["capture"]>(["full", "excerpt"]);
const REASONS = new Set<SelectionNotice["reasonStatus"]>(["not-stated", "explicit", "unknown"]);

function validDate(value: unknown): string {
  const date = getString(value);
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : "";
}

function noticeId(path: string): string {
  let first = 2166136261;
  let second = 3339675911;
  for (let index = 0; index < path.length; index += 1) {
    first = Math.imul(first ^ path.charCodeAt(index), 16777619);
    second = Math.imul(second ^ path.charCodeAt(index), 2246822519);
  }
  return `selection-notice-${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function originalText(content: string): string | null {
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  // 重复或残缺标记不能静默只取一段，否则界面会把不完整资料显示成全文。
  if (start < 0 || end < start + START.length || content.indexOf(START, start + START.length) >= 0 || content.indexOf(END, end + END.length) >= 0) return null;
  const original = content.slice(start + START.length, end).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return original.trim() ? original : null;
}

function sourceUrl(value: unknown): string | undefined {
  const candidate = getString(value).trim();
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return ["https:", "http:"].includes(parsed.protocol) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function parseNotice(note: Note): SelectionNotice | null {
  if (getType(note) !== "selection-notice" || note.frontmatter.source_verified !== true || !includeRuntimeNote(note)) return null;
  const date = validDate(note.frontmatter.date);
  const original = originalText(note.content);
  const outcome = getString(note.frontmatter.outcome) as SelectionNotice["outcome"];
  const capture = getString(note.frontmatter.capture) as SelectionNotice["capture"];
  if (!date || original === null || !OUTCOMES.has(outcome) || !CAPTURES.has(capture)) return null;
  const rawReason = getString(note.frontmatter.reason_status) as SelectionNotice["reasonStatus"];
  const url = sourceUrl(note.frontmatter.source_url);
  return {
    id: noticeId(note.path), date, time: interviewNoteTime(note, date), stage: getString(note.frontmatter.stage),
    outcome, channel: getString(note.frontmatter.channel), ...(url ? { sourceUrl: url } : {}), sourcePath: note.path,
    reasonStatus: REASONS.has(rawReason) ? rawReason : "unknown", capture, original,
  };
}

/** 通知只挂到明确关联的案件；后续轮次的通知保留阶段，由阅读界面说明它与本场的关系。 */
export function selectionNoticesForSession(note: Note, notes: Note[]): SelectionNotice[] {
  const isOwner = ["job-case", "todo"].includes(getType(note));
  // 案件抽屉也会读通知；案件 date 是发现日，不能拿来过滤企业通知。
  const date = isOwner ? "" : validDate(note.frontmatter.date);
  const owner = interviewSessionOwner(note, notes);
  if ((!isOwner && !date) || !owner) return [];
  const time = date ? interviewNoteTime(note, date) : "";
  return notes.flatMap(candidate => {
    const notice = parseNotice(candidate);
    if (!notice || notice.date < date || (notice.date === date && time && notice.time && notice.time < time)) return [];
    // 通知自身必须有显式关联，不借同公司准备稿或目录补猜归属。
    const noticeOwner = resolveInterviewOwner(candidate, notes);
    return noticeOwner?.path === owner.path ? [notice] : [];
  }).sort((left, right) => right.date.localeCompare(left.date) || right.time.localeCompare(left.time) || (left.sourcePath ?? "").localeCompare(right.sourcePath ?? ""));
}
