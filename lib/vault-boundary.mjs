/**
 * Vault の共通読取境界。
 * 「全消費者が同じノートを読む」のではなく、同じ分類から用途別 profile を選ぶ。
 */
export const JOB_CASE_TYPE = "job-case";
export const JOB_CASE_ORIGINS = ["ai-reco", "manual", "agent", "scout", "legacy"];

const CONTROL_FILES = new Set(["AGENTS.md", "CLAUDE.md"]);
const GENERATED_TYPES = new Set([
  "ledger",
  "training-profile",
  "training-lesson",
  "training-log",
  "practice-log",
  "exam-log",
  "language-bank",
  "language-session-log",
  "language-coach-log",
  "language-exam-log",
  "language-curriculum",
  "language-batch-log",
  "language-expression-course-progress",
]);
const AI_SOURCE_TYPES = new Set([
  "self",
  "company",
  JOB_CASE_TYPE,
  "transcript",
  "review",
  "mail",
  "application_log",
  "application_documents",
  "job_platform_sync",
  "deep-thought-evidence",
  "policy",
  "study",
  "material",
  "ai-report",
  "analysis",
]);

function normalizedPath(path) {
  return String(path ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isTemplatePath(path) {
  const value = normalizedPath(path);
  return value === "99_系统/模板" || value.startsWith("99_系统/模板/");
}

export function isArchivePath(path) {
  const value = normalizedPath(path);
  return value === "90_归档" || value.startsWith("90_归档/");
}

export function isControlPath(path) {
  return CONTROL_FILES.has(normalizedPath(path));
}

export function isOperationalPath(path) {
  const value = normalizedPath(path);
  if (!value || value.split("/").some((part) => part.startsWith("."))) return false;
  return !isTemplatePath(value) && !isArchivePath(value) && !isControlPath(value);
}

export function noteType(note) {
  return String(note?.frontmatter?.type ?? "note");
}

export function isCurrentPolicy(note) {
  return noteType(note) === "policy" && note?.frontmatter?.lifecycle === "current";
}

export function isGeneratedNote(note) {
  return GENERATED_TYPES.has(noteType(note));
}

export function includeRuntimeNote(note) {
  return isOperationalPath(note?.path);
}

export function includeAiSourceNote(note) {
  if (!includeRuntimeNote(note) || isGeneratedNote(note)) return false;
  const type = noteType(note);
  if (!AI_SOURCE_TYPES.has(type)) return false;
  if (type === "policy" && !isCurrentPolicy(note)) return false;
  // 手工策划的专项课程有自己的解析器和进度语义；放进通用 AI 来源会被
  // language-v1/道场再次拆成另一份词库，重新造成双重管理。
  if (type === "material" && note?.frontmatter?.material_kind === "language-expression-course") {
    return false;
  }
  return true;
}
