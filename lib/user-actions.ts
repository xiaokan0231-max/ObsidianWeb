import { normalizeJobStatus } from "./job-status.ts";
import { getType, type Note } from "./notes.ts";
import { TODO_STATUSES, OPEN_TODO_STATUSES } from "./todo-status.mjs";
import { ACTION_KINDS, ACTION_OWNERS } from "./todo-action-schema.ts";

export { ACTION_KINDS, ACTION_OWNERS };
export const USER_ACTION_CATEGORIES = ["current", "waiting", "system", "optional", "history", "review"] as const;

export type ActionOwner = typeof ACTION_OWNERS[number];
export type ActionKind = typeof ACTION_KINDS[number];
export type UserActionCategory = typeof USER_ACTION_CATEGORIES[number];
export type UserActionReason =
  | "required-user-action" | "awaiting-counterpart" | "system-action" | "optional-action"
  | "completed" | "expired" | "recorded-history" | "case-rejected" | "case-paused"
  | "todo-paused" | "needs-review";

export type UserActionItem = {
  note: Note;
  category: UserActionCategory;
  reasonCode: UserActionReason;
  /** 缺项和非法字段不能静默变成本人义务；这些稳定代码供界面解释待核原因。 */
  issues: string[];
  warnings: string[];
  owner: ActionOwner | null;
  kind: ActionKind | null;
  action: string;
  reviewedAt: string;
  reason: string;
  source: string;
  nextOwner: ActionOwner | null;
  due: string;
  dueText: string;
  suggestedDue: string;
  caseNote: Note | null;
  focus: boolean;
};

export type UserActions = Record<UserActionCategory, UserActionItem[]>;

const COUNTERPARTS: readonly ActionOwner[] = ["company", "agent", "platform"];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function member<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === "string" && values.includes(value.trim() as T) ? value.trim() as T : null;
}

/** 日期必须来自明确字段，不能从正文、建议期限或宽松的日期前缀推导。 */
function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function activeStatus(note: Note): boolean {
  return OPEN_TODO_STATUSES.includes(text(note.frontmatter.status));
}

function classify(note: Note, today: string, caseNote: Note | null, associationIssue = ""): UserActionItem {
  const fm = note.frontmatter;
  const owner = member(ACTION_OWNERS, fm.action_owner);
  const kind = member(ACTION_KINDS, fm.action_kind);
  const nextOwner = member(ACTION_OWNERS, fm.action_next_owner);
  const issues: string[] = [];
  const warnings: string[] = [];
  const status = text(fm.status);
  // audience 的旧契约允许缺省为 user；这不能替代新模型要求的 owner/kind/审核证据。
  const audience = present(fm.audience) ? text(fm.audience) : "user";
  const day = validDay(today) ? today : "";
  const reviewedAt = validDay(fm.action_reviewed_at) ? fm.action_reviewed_at : "";
  const due = validDay(fm.due) ? fm.due : "";
  const expires = validDay(fm.expires_at) ? fm.expires_at : "";
  const focusUntil = validDay(fm.focus_until) ? fm.focus_until : "";
  const focus = fm.focus === true && Boolean(day && focusUntil && focusUntil >= day);
  const action = text(fm.action);
  const reason = text(fm.action_reason);
  const source = text(fm.action_source);
  const linkedStatus = caseNote ? normalizeJobStatus(text(caseNote.frontmatter.status)) : null;

  if (!day) issues.push("invalid-today");
  if (!TODO_STATUSES.includes(status)) issues.push("invalid-status");
  if (!owner) issues.push(present(fm.action_owner) ? "invalid-action-owner" : "missing-action-owner");
  if (!kind) issues.push(present(fm.action_kind) ? "invalid-action-kind" : "missing-action-kind");
  if (!reviewedAt) issues.push(present(fm.action_reviewed_at) ? "invalid-action-reviewed-at" : "missing-action-reviewed-at");
  else if (day && reviewedAt > day) issues.push("future-action-reviewed-at");
  if (!["user", "system"].includes(audience)) issues.push("invalid-audience");
  if (associationIssue) issues.push(associationIssue);
  if (caseNote && !linkedStatus) issues.push("invalid-case-status");
  for (const field of ["due", "expires_at", "focus_until", "suggested_due", "action_resolved_at"]) {
    if (present(fm[field]) && !validDay(fm[field])) issues.push(`invalid-${field.replaceAll("_", "-")}`);
  }
  for (const field of ["action", "action_reason", "action_source", "due_text", "action_resolution", "action_resolution_note"]) {
    if (present(fm[field]) && typeof fm[field] !== "string") issues.push(`invalid-${field.replaceAll("_", "-")}`);
  }
  if (present(fm.focus) && typeof fm.focus !== "boolean") issues.push("invalid-focus");
  if (fm.focus === true && !focusUntil) issues.push("missing-focus-until");
  if (due && expires && expires < due) issues.push("expiry-before-due");
  if (present(fm.action_next_owner) && !nextOwner) issues.push("invalid-action-next-owner");
  else if (!nextOwner) warnings.push("missing-action-next-owner");
  if (owner === "user" && kind === "required") {
    if (!action) issues.push("missing-action");
    if (!reason) issues.push("missing-action-reason");
    if (!source) issues.push("missing-action-source");
  }

  const item: UserActionItem = {
    note, caseNote, owner, kind, nextOwner, action, reason, source, reviewedAt, due,
    dueText: text(fm.due_text), suggestedDue: validDay(fm.suggested_due) ? fm.suggested_due : "",
    focus, issues, warnings, category: "review", reasonCode: "needs-review",
  };
  function result(category: UserActionCategory, reasonCode: UserActionReason): UserActionItem {
    return { ...item, category, reasonCode };
  }

  // 完成/取消/已拒绝的旧记录不因缺少新审核字段复活；focus 只覆盖日期失效。
  if (status === "完了") return result("history", "completed");
  if (kind === "history") return result("history", "recorded-history");
  if (linkedStatus === "不採用") return result("history", "case-rejected");
  if (day && expires && expires < day && !focus) return result("history", "expired");
  if (issues.length || kind === "review") return item;
  if (owner === "ai" || owner === "system" || audience === "system") return result("system", "system-action");
  if (kind === "waiting" || (owner && COUNTERPARTS.includes(owner))) return result("waiting", "awaiting-counterpart");
  if (kind === "optional" || kind === "reference") return result("optional", "optional-action");
  // 保留说明暂停推进，不能盖过已核定的「只供参考」，也不能补足缺失的真实性审核。
  if (linkedStatus === "保留") return result("waiting", "case-paused");
  if (status === "保留") return result("waiting", "todo-paused");
  if (kind === "required" && owner === "user" && activeStatus(note)) return result("current", "required-user-action");
  return item;
}

/** 六类只投影已有事实；没有写入、完成操作，也不从 next_action 或点击行为产生任务。 */
export function buildUserActions(notes: readonly Note[], today: string): UserActions {
  const cases = new Map<string, Note[]>();
  for (const note of notes) {
    if (getType(note) !== "job-case") continue;
    const id = text(note.frontmatter.case_id);
    if (id) cases.set(id, [...(cases.get(id) ?? []), note]);
  }
  const groups: UserActions = { current: [], waiting: [], system: [], optional: [], history: [], review: [] };
  for (const note of notes) {
    if (getType(note) !== "todo") continue;
    const rawId = note.frontmatter.case_id;
    const id = text(rawId);
    const matches = id ? cases.get(id) ?? [] : [];
    const associationIssue = present(rawId) && !id ? "invalid-case-id"
      : id && matches.length !== 1 ? (matches.length ? "ambiguous-case-id" : "missing-case") : "";
    const item = classify(note, today, matches.length === 1 ? matches[0] : null, associationIssue);
    groups[item.category].push(item);
  }
  return groups;
}

/** 调用方须先确定唯一案件；只接受精确 case_id，不借公司名或模糊路径关联。 */
export function userActionForCase(note: Note, caseNote: Note, today: string): UserActionItem | null {
  const id = text(note.frontmatter.case_id);
  if (getType(note) !== "todo" || getType(caseNote) !== "job-case" || !id || id !== text(caseNote.frontmatter.case_id)) return null;
  return classify(note, today, caseNote);
}

export function actionableTodoForCase(note: Note, caseNote: Note, today: string): boolean {
  return userActionForCase(note, caseNote, today)?.category === "current";
}

/** 日历的待核候选不包含已明确归属AI/对方或自愿阅读的事项，即使它们有缺项。 */
export function reviewTodoForCase(note: Note, caseNote: Note, today: string): boolean {
  const item = userActionForCase(note, caseNote, today);
  if (!item || item.category !== "review" || !activeStatus(note)) return false;
  if (["不採用", "保留"].includes(normalizeJobStatus(text(caseNote.frontmatter.status)) ?? "")) return false;
  if (item.owner && item.owner !== "user") return false;
  if (text(note.frontmatter.audience) === "system") return false;
  return !item.kind || ["required", "review"].includes(item.kind);
}
