import { getTitle, getType, type Note } from "./notes.ts";
import { isOperationalPath } from "./vault-boundary.mjs";

export const LANGUAGE_READING_LIST_TYPE = "language-reading-list";
export const LANGUAGE_READING_LIST_MARKER = "<!-- language-reading-list:data -->";
export const LANGUAGE_READING_LIST_CATEGORIES = ["语体", "含义", "搭配", "语法"] as const;
export const LANGUAGE_READING_LIST_PRIORITIES = ["先改", "顺手改"] as const;
export const LANGUAGE_READING_LIST_FINDINGS = ["correction", "alternative", "uncertain"] as const;

export type LanguageReadingListCategory = string;
export type LanguageReadingListPriority = typeof LANGUAGE_READING_LIST_PRIORITIES[number];
export type LanguageReadingListFinding = typeof LANGUAGE_READING_LIST_FINDINGS[number];
export type LanguageReadingListSource = { path: string; locator: string; label: string };
export type LanguageReadingListItem = {
  id: string;
  number: number;
  category: LanguageReadingListCategory;
  priority: LanguageReadingListPriority;
  pattern: string;
  original: string;
  suggested: string;
  reminder: string;
  finding?: LanguageReadingListFinding;
  rule?: string;
  boundary?: string;
  sources: LanguageReadingListSource[];
};
export type LanguageReadingListPeriod = { start: string; end: string };
export type LanguageReadingListData = {
  version: 1;
  description: string;
  period: LanguageReadingListPeriod;
  sections?: string[];
  items: LanguageReadingListItem[];
};
export type LanguageReadingList = {
  path: string;
  title: string;
  date: string;
  description: string;
  period: LanguageReadingListPeriod;
  sections?: string[];
  items: LanguageReadingListItem[];
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function dateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function sourcePath(value: unknown): value is string {
  return nonempty(value) && value === value.trim() && value.endsWith(".md") && !value.startsWith("/")
    && !/[\\\u0000-\u001f\u007f]/u.test(value) && !/^[a-z][a-z0-9+.-]*:/iu.test(value)
    && !value.split("/").some((part) => !part || part === "." || part === "..") && isOperationalPath(value);
}

function source(value: unknown): value is LanguageReadingListSource {
  return record(value) && sourcePath(value.path) && nonempty(value.locator) && nonempty(value.label);
}

function item(value: unknown, sections: readonly string[]): value is LanguageReadingListItem {
  return record(value) && nonempty(value.id) && value.id === value.id.trim()
    && Number.isSafeInteger(value.number) && Number(value.number) > 0
    && sections.some((category) => category === value.category)
    && LANGUAGE_READING_LIST_PRIORITIES.some((priority) => priority === value.priority)
    && nonempty(value.pattern) && nonempty(value.original) && nonempty(value.suggested) && nonempty(value.reminder)
    && (value.finding === undefined || LANGUAGE_READING_LIST_FINDINGS.some(finding => finding === value.finding))
    && (value.rule === undefined || nonempty(value.rule)) && (value.boundary === undefined || nonempty(value.boundary))
    && Array.isArray(value.sources) && value.sources.length > 0 && value.sources.every(source);
}

/** 整篇拒绝损坏数据，避免漏掉一行后仍让读者以为清单已经完整载入。 */
export function parseLanguageReadingList(note: Note): LanguageReadingList | null {
  if (getType(note) !== LANGUAGE_READING_LIST_TYPE) return null;
  const marker = note.content.indexOf(LANGUAGE_READING_LIST_MARKER);
  if (marker < 0 || note.content.indexOf(LANGUAGE_READING_LIST_MARKER, marker + LANGUAGE_READING_LIST_MARKER.length) >= 0) return null;
  const block = note.content.slice(marker + LANGUAGE_READING_LIST_MARKER.length)
    .match(/^\s*```json[\t ]*\r?\n([\s\S]*?)\r?\n[\t ]*```[\t ]*(?:\r?\n|$)/u)?.[1];
  if (!block) return null;
  let data: unknown;
  try { data = JSON.parse(block); } catch { return null; }
  if (!record(data) || data.version !== 1 || typeof data.description !== "string" || !record(data.period)
    || !dateKey(data.period.start) || !dateKey(data.period.end) || data.period.start > data.period.end
    || !Array.isArray(data.items) || data.items.length === 0) return null;
  // 专题可自定目录；未声明目录的旧清单仍沿用原来的四类校验。
  if (data.sections !== undefined && (!Array.isArray(data.sections) || data.sections.length === 0 || data.sections.length > 12
    || !data.sections.every(section => nonempty(section) && section === section.trim())
    || new Set(data.sections).size !== data.sections.length)) return null;
  const sections = data.sections as string[] | undefined;
  if (!data.items.every(entry => item(entry, sections ?? LANGUAGE_READING_LIST_CATEGORIES))) return null;
  const ids = new Set<string>(), numbers = new Set<number>();
  for (const entry of data.items) {
    if (ids.has(entry.id) || numbers.has(entry.number)) return null;
    ids.add(entry.id); numbers.add(entry.number);
  }
  const metadata = note as Note & { title?: unknown; date?: unknown };
  const title = nonempty(note.frontmatter.title) ? note.frontmatter.title.trim()
    : nonempty(metadata.title) ? metadata.title.trim() : getTitle(note);
  const date = nonempty(note.frontmatter.date) ? note.frontmatter.date.trim()
    : nonempty(metadata.date) ? metadata.date.trim() : "";
  if (date && !dateKey(date)) return null;
  return { path: note.path, title, date, description: data.description,
    period: { start: data.period.start, end: data.period.end }, ...(sections ? { sections } : {}), items: data.items };
}
