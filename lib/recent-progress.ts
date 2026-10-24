import { buildAiApplicationDays } from "./calendar-applications.ts";
import { stableId } from "./dojo/utils.ts";
import { jobPosition } from "./jobs.ts";
import { normalizeJobStatus, type JobStatus } from "./job-status.ts";
import { getType, type Note } from "./notes.ts";
import { validActionDate } from "./todo-action-schema.ts";
import { buildUserActions } from "./user-actions.ts";
import { isOperationalPath } from "./vault-boundary.mjs";
import { resolveNoteLink } from "./wiki-target.ts";

export type RecentProgressKind = "status" | "application" | "work" | "blocker" | "draft";
export type RecentProgressDateBasis = "event" | "recorded" | "reviewed";
export type RecentProgressState = JobStatus | "application-submitted" | "required-action"
  | "work-completed" | "work-in-progress" | "draft" | "prepared" | "awaiting-approval"
  | "saved" | "sent" | "not-sent";
export type RecentProgressSourceType = "case" | "ai-application" | "user-action"
  | "application-log" | "platform-sync" | "outbound-draft";

/** 页面只接收这份白名单投影；工作记录的标题、路径和正文都不属于可展示内容。 */
export type RecentProgressEntry = {
  id: string;
  kind: RecentProgressKind;
  date: string;
  dateBasis: RecentProgressDateBasis;
  company: string;
  position: string;
  state: RecentProgressState;
  sourceType: RecentProgressSourceType;
  sourcePaths: string[];
  externalSources: string[];
  sourceCount: number;
  actor?: string;
  summary?: string;
  action?: string;
  actionPath?: string;
  caseId?: string;
  due?: string;
  dueText?: string;
};

export type RecentProgressGaps = {
  undated: number;
  invalidDates: number;
  futureDates: number;
  unreviewed: number;
  unsupportedRecords: number;
};

export type RecentProgress = { entries: RecentProgressEntry[]; gaps: RecentProgressGaps };

const WORK_TYPES = new Set(["application_log", "job_platform_sync", "profile_sync"]);
const COMPLETED = new Set(["completed", "complete", "完了"]);
const SENT = new Set(["sent", "送信済", "送信済み", "已发送"]);
const NOT_SENT = new Set(["not-sent", "unsent", "未送信", "未发送"]);
const WORK_STATES: Record<string, RecentProgressState> = {
  // active 常指记录仍在使用，不能据此宣称助手正在执行。
  active: "saved", "in-progress": "work-in-progress", in_progress: "work-in-progress", 進行中: "work-in-progress",
  draft: "draft", 下書き: "draft", 草稿: "draft",
  prepared: "prepared", 準備済: "prepared", 準備完了: "prepared", 已准备: "prepared",
  "awaiting-approval": "awaiting-approval", awaiting_approval: "awaiting-approval", approval_pending: "awaiting-approval",
  承認待ち: "awaiting-approval", 待批准: "awaiting-approval",
  saved: "saved", 保存済: "saved", 已保存: "saved",
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** 只接受字段本身是原链接；不抓取正文里的追踪链接、文件路径或带账户密码的 URL。 */
function externalSource(value: unknown): string[] {
  const input = text(value);
  if (!input || /\s/.test(input)) return [];
  try {
    const url = new URL(input);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? [url.href] : [];
  } catch {
    return [];
  }
}

function workState(note: Note): RecentProgressState | null {
  const status = text(note.frontmatter.status);
  const execution = text(note.frontmatter.execution_status);
  // 两个明确状态冲突时不选择其中较乐观的那个。
  if (COMPLETED.has(execution) && status && !COMPLETED.has(status)) return null;
  if (COMPLETED.has(status) && execution && !COMPLETED.has(execution)) return null;
  if (COMPLETED.has(status) || COMPLETED.has(execution)) return "work-completed";
  return WORK_STATES[status] ?? null;
}

function outboundState(note: Note): { state: RecentProgressState; sentDate: unknown } | null {
  const fm = note.frontmatter;
  const status = text(fm.status);
  const hasSentDate = fm.sent_at !== undefined && fm.sent_at !== null && fm.sent_at !== "";
  const datedSent = typeof fm.sent === "string" && Boolean(fm.sent.trim());
  const isSent = SENT.has(status) || fm.sent === true || hasSentDate || datedSent;
  const explicitlyUnsent = NOT_SENT.has(status) || fm.sent === false || Boolean(WORK_STATES[status]);
  if (isSent && explicitlyUnsent) return null;
  if (isSent) return { state: "sent", sentDate: hasSentDate ? fm.sent_at : datedSent ? fm.sent : undefined };
  if (NOT_SENT.has(status) || fm.sent === false) return { state: "not-sent", sentDate: undefined };
  const state = status ? WORK_STATES[status] : "draft";
  return state ? { state, sentDate: undefined } : null;
}

/**
 * 仅投影已有事实。status_updated 是当前状态对应的事件日，不是完整状态变迁；
 * date 只是工作记录日，action_reviewed_at 只是审核日，三者不可互相补位。
 */
export function buildRecentProgress(notes: readonly Note[], today: string): RecentProgress {
  const gaps: RecentProgressGaps = { undated: 0, invalidDates: 0, futureDates: 0, unreviewed: 0, unsupportedRecords: 0 };
  if (!validActionDate(today)) return { entries: [], gaps: { ...gaps, invalidDates: 1 } };
  const unique = new Map<string, Note>();
  for (const note of notes) {
    if (!isOperationalPath(note.path) || note.frontmatter.private === true ||
      ["private", "internal"].includes(text(note.frontmatter.visibility))) continue;
    if (!unique.has(note.path)) unique.set(note.path, note);
  }
  const sourceNotes = [...unique.values()].sort((left, right) => left.path.localeCompare(right.path));
  const safeNotes = sourceNotes.filter((note) => ["job-case", "todo"].includes(getType(note)));
  const entries = new Map<string, RecentProgressEntry>();

  function date(value: unknown): string {
    if (value === undefined || value === null || value === "") { gaps.undated += 1; return ""; }
    if (typeof value !== "string" || !validActionDate(value)) { gaps.invalidDates += 1; return ""; }
    if (value > today) { gaps.futureDates += 1; return ""; }
    return value;
  }

  function add(key: string, entry: Omit<RecentProgressEntry, "id">) {
    const id = stableId("progress", key);
    const previous = entries.get(id);
    if (previous) {
      previous.sourcePaths = [...new Set([...previous.sourcePaths, ...entry.sourcePaths])].sort();
      previous.externalSources = [...new Set([...previous.externalSources, ...entry.externalSources])].sort();
      previous.sourceCount = Math.max(previous.sourceCount, previous.sourcePaths.length);
    } else entries.set(id, { id, ...entry });
  }

  // 日历已使用严格的成功申请契约；这里复用其日期、执行者与稳定案件去重。
  const applications = buildAiApplicationDays(sourceNotes, today).flatMap((day) => day.applications);
  const appliedKeys = new Set<string>();
  for (const application of applications) {
    if (!validActionDate(application.date)) { gaps.invalidDates += 1; continue; }
    const note = application.note;
    const caseId = text(note.frontmatter.case_id);
    const key = caseId || note.path;
    appliedKeys.add(`${key}\0${application.date}`);
    add(`application\0${key}\0${application.date}`, {
      kind: "application", date: application.date, dateBasis: "event", company: application.company,
      position: application.position, state: "application-submitted", sourceType: "ai-application",
      sourcePaths: [note.path], externalSources: externalSource(note.frontmatter.url), sourceCount: 1,
      actor: application.agent, ...(caseId ? { caseId } : {}),
    });
  }

  for (const note of sourceNotes) {
    if (getType(note) !== "job-case") continue;
    const company = text(note.frontmatter.company);
    const state = normalizeJobStatus(text(note.frontmatter.status));
    if (!company || !state) { gaps.unsupportedRecords += 1; continue; }
    // 候选建档和待申请计划没有已发生的选考进展。
    if (state === "未応募") continue;
    const day = date(note.frontmatter.status_updated);
    if (!day) continue;
    const caseId = text(note.frontmatter.case_id);
    const key = caseId || note.path;
    if (state === "応募済" && appliedKeys.has(`${key}\0${day}`)) continue;
    add(`status\0${key}\0${day}\0${state}`, {
      kind: "status", date: day, dateBasis: "event", company, position: jobPosition(note), state,
      sourceType: "case", sourcePaths: [note.path], externalSources: externalSource(note.frontmatter.url), sourceCount: 1,
      ...(caseId ? { caseId } : {}),
    });
  }

  const actions = buildUserActions(safeNotes, today);
  gaps.unreviewed = actions.review.length;
  for (const item of actions.current) {
    const linkedSource = resolveNoteLink(safeNotes, item.source)?.note;
    const paths = [...new Set([item.note.path, item.caseNote?.path, linkedSource?.path].filter((path): path is string => Boolean(path)))];
    const caseId = text(item.caseNote?.frontmatter.case_id);
    add(`blocker\0${item.note.path}\0${item.reviewedAt}`, {
      kind: "blocker", date: item.reviewedAt, dateBasis: "reviewed", state: "required-action", sourceType: "user-action",
      company: text(item.caseNote?.frontmatter.company) || text(item.note.frontmatter.company),
      position: item.caseNote ? jobPosition(item.caseNote) : "",
      action: item.action, summary: item.reason, actionPath: item.note.path,
      ...(item.due ? { due: item.due } : {}), ...(item.dueText ? { dueText: item.dueText } : {}),
      sourcePaths: paths, sourceCount: paths.length, externalSources: externalSource(item.source),
      ...(caseId ? { caseId } : {}),
    });
  }

  for (const note of sourceNotes) {
    const type = getType(note);
    if (!WORK_TYPES.has(type) && type !== "outbound-draft") continue;
    const outbound = type === "outbound-draft" ? outboundState(note) : null;
    const state = type === "outbound-draft" ? outbound?.state : workState(note);
    if (!state) { gaps.unsupportedRecords += 1; continue; }
    const sendingDate = outbound?.sentDate;
    const day = date(sendingDate ?? note.frontmatter.date);
    if (!day) continue;
    const sourceType: RecentProgressSourceType = type === "outbound-draft" ? "outbound-draft"
      : type === "application_log" ? "application-log" : "platform-sync";
    add(`${type}\0${note.path}\0${day}\0${state}`, {
      kind: type === "outbound-draft" ? "draft" : "work", date: day,
      dateBasis: sendingDate !== undefined ? "event" : "recorded",
      company: text(note.frontmatter.company), position: text(note.frontmatter.position), state, sourceType,
      // 工作记录可能混有操作指令与个人材料；没有统一外部证据字段时只给出来源数量。
      sourcePaths: [], externalSources: [], sourceCount: 1,
    });
  }

  return { entries: [...entries.values()].sort((left, right) => right.date.localeCompare(left.date) ||
    left.kind.localeCompare(right.kind) || left.company.localeCompare(right.company) || left.id.localeCompare(right.id)), gaps };
}
