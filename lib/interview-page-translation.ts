import { getType, stripFrontmatter, type Note } from "./notes.ts";

export const INTERVIEW_PAGE_TRANSLATION_TYPE = "interview-page-translation";

function isNotePath(value: unknown): value is string {
  return typeof value === "string" && value.endsWith(".md") && !value.includes("\\") && !value.includes("\0")
    && value.split("/").every(part => part && part !== "." && part !== "..");
}

export function interviewPageTranslationTarget(note: Note) {
  if (getType(note) !== INTERVIEW_PAGE_TRANSLATION_TYPE || note.frontmatter.language !== "ja") return null;
  const { translation_for: prepPath, translation_source: sourcePath } = note.frontmatter;
  if (!isNotePath(prepPath) || !isNotePath(sourcePath)) return null;
  return { prepPath, sourcePath };
}

const displayFields = new Set(["title", "position", "round", "format", "interviewers", "meeting_topic", "location"]);
const structuredText = new Set([
  "label", "value", "scope", "coverage", "comment_period", "sample_unit", "limitations", "title", "summary",
  "implication", "role", "paraphrase", "rationale", "paragraphs", "unknowns", "strengths", "questions", "positive", "negative",
]);

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function translatedText(original: unknown, translated: unknown) {
  return typeof translated === "string" && translated.trim() ? translated : original;
}

// 按正本结构覆盖展示文字，译文不能改变证据地址、分数、日期或报告的字段结构。
function translatedStructure(original: unknown, translated: unknown, field: string): unknown {
  if (typeof original === "string" && structuredText.has(field)) return translatedText(original, translated);
  if (Array.isArray(original)) return Array.isArray(translated) && original.length === translated.length
    ? original.map((value, index) => translatedStructure(value, translated[index], field)) : original;
  const base = object(original), variant = object(translated);
  if (!base || !variant) return original;
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key,
    Object.hasOwn(variant, key) ? translatedStructure(value, variant[key], key) : value,
  ]));
}

/** 译文只作为读取时的展示副本，正本的路径、发布状态、日期和关联都保持原值。 */
export function applyInterviewPageTranslation(original: Note, variant: Note): Note | null {
  const target = interviewPageTranslationTarget(variant);
  if (!target || target.sourcePath !== original.path) return null;
  const type = getType(original), report = original.frontmatter.report_kind;
  const supportsTranslation = ["interview-prep", "company", "job-case", "todo"].includes(type)
    || (type === "ai-report" && (report === "company-summary" || report === "company-fit"));
  if (!supportsTranslation || (type === "interview-prep" && target.prepPath !== original.path)) return null;

  const content = stripFrontmatter(variant.content.replace(/\r\n/g, "\n"));
  if (!content.trim()) return null;
  const fields = object(variant.frontmatter.translated_frontmatter) ?? {};
  const frontmatter = { ...original.frontmatter };
  for (const field of displayFields) {
    if (Object.hasOwn(fields, field)) frontmatter[field] = translatedText(frontmatter[field], fields[field]);
  }
  if (type === "company" && Object.hasOwn(fields, "company_profile")) {
    frontmatter.company_profile = translatedStructure(frontmatter.company_profile, fields.company_profile, "company_profile");
  }
  if (type === "ai-report" && report === "company-summary") {
    if (Object.hasOwn(fields, "coverage_period")) frontmatter.coverage_period = translatedText(frontmatter.coverage_period, fields.coverage_period);
    if (Object.hasOwn(fields, "sources")) frontmatter.sources = translatedStructure(frontmatter.sources, fields.sources, "sources");
  }
  if (type === "ai-report" && report === "company-fit" && Object.hasOwn(fields, "fit_assessment")) {
    frontmatter.fit_assessment = translatedStructure(frontmatter.fit_assessment, fields.fit_assessment, "fit_assessment");
  }
  return { ...original, frontmatter, content };
}
