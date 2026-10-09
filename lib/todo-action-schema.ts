import { getString, type Frontmatter } from "./notes.ts";

export const ACTION_OWNERS = ["user", "ai", "system", "company", "agent", "platform"] as const;
export const ACTION_KINDS = ["required", "waiting", "optional", "reference", "review", "history"] as const;
export const ACTION_RESOLUTIONS = ["completed", "cancelled"] as const;

export function validActionDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 未审核的旧记录留在待核区；已声明的审核字段不能拼错后静默变成另一类。 */
export function todoActionMetadataIssues(fm: Frontmatter) {
  const issues: string[] = [];
  for (const [field, values] of [
    ["action_owner", ACTION_OWNERS], ["action_kind", ACTION_KINDS], ["action_resolution", ACTION_RESOLUTIONS],
  ] as const) {
    if (fm[field] !== undefined && !(values as readonly string[]).includes(getString(fm[field]))) issues.push(`${field} 的值不合法`);
  }
  for (const field of ["action_reviewed_at", "action_resolved_at", "suggested_due"]) {
    if (fm[field] !== undefined && !validActionDate(getString(fm[field]))) issues.push(`${field} 必须是实际存在的 YYYY-MM-DD`);
  }
  if (fm.action_next_owner !== undefined && !(ACTION_OWNERS as readonly string[]).includes(getString(fm.action_next_owner))) issues.push("action_next_owner 的值不合法");
  for (const field of ["action", "action_reason", "action_source", "due_text", "action_resolution_note"]) {
    if (fm[field] !== undefined && (typeof fm[field] !== "string" || /[\r\n]/.test(fm[field] as string))) issues.push(`${field} 必须是单行文本`);
  }
  if (fm.action_kind === "required") {
    for (const field of ["action", "action_reason", "action_source", "action_reviewed_at", "action_owner"]) {
      if (!getString(fm[field]).trim()) issues.push(`required 事项缺少 ${field}`);
    }
  }
  return issues;
}
