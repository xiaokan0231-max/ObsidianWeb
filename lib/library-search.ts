// 资料库（app/library-view.tsx）的派生层：摘要、命中片段、相关度、标签 facet、按日期分组。
// 不依赖 React，卡片和测试共用同一份口径。

import { getString, getTitle, stripMarkdown, type Note } from "./notes.ts";
import { highlightTerms, searchSnippet, splitByTerms, type SnippetPart } from "./search-snippet.ts";

/**
 * 卡片用的纯文本：剥掉生成区块标记与重复的标题。
 * 搜索框每敲一个字整页重渲染，已显示的卡片都要再取一次摘要；
 * stripMarkdown 是整篇正则，所以按 note 对象缓存（notes 整体替换或单条 patch 都会换对象，自然失效）。
 */
const plainCache = new WeakMap<Note, string>();

export function libraryPlainText(note: Note) {
  const cached = plainCache.get(note);
  if (cached !== undefined) return cached;
  const title = getTitle(note);
  const plain = stripMarkdown(
    note.content
      .replace(/<!--\s*\/?generated:[^>]*-->/giu, " ")
      .replace(/<!--\s*\/generated\s*-->/giu, " "),
  ).replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "u"), "").trim();
  plainCache.set(note, plain);
  return plain;
}

const summaryCache = new WeakMap<Note, string>();

/**
 * 空查询时卡片的摘要：frontmatter 的 summary/result 优先，否则正文开头 150 字。
 * 兜底文案随界面语言变，不进缓存；取不到正文时返回空串由调用方补。
 */
export function libraryCardSummary(note: Note) {
  const cached = summaryCache.get(note);
  if (cached !== undefined) return cached;
  const structured = getString(note.frontmatter.summary) || getString(note.frontmatter.result);
  const value = structured || libraryPlainText(note);
  const clipped = value.length > 150 ? `${value.slice(0, 149)}…` : value;
  summaryCache.set(note, clipped);
  return clipped;
}

function countIn(text: string, terms: readonly string[]) {
  if (!text) return 0;
  const lower = text.toLocaleLowerCase();
  let total = 0;
  for (const term of terms) {
    const needle = term.toLocaleLowerCase();
    if (!needle) continue;
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) total += 1;
  }
  return total;
}

function frontmatterText(note: Note) {
  return Object.entries(note.frontmatter)
    .map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(" ") : getString(value)}`)
    .join("\n");
}

export type LibraryHits = { title: number; frontmatter: number; body: number; total: number };

/** 只数普通词（前缀词 type:/status:/folder: 只筛选，不算命中）。 */
export function libraryHits(note: Note, query: string): LibraryHits {
  const terms = highlightTerms(query);
  if (!terms.length) return { title: 0, frontmatter: 0, body: 0, total: 0 };
  const title = countIn(getTitle(note), terms);
  const frontmatter = countIn(frontmatterText(note), terms);
  const body = countIn(libraryPlainText(note), terms);
  return { title, frontmatter, body, total: title + frontmatter + body };
}

/**
 * 相关度：标题命中 > frontmatter 命中 > 正文命中次数，逐级比较。
 * 不加权求和：正文里出现 40 次的长文不该压过标题就叫这个名字的那篇。
 */
export function compareRelevance(left: LibraryHits, right: LibraryHits) {
  return Number(right.title > 0) - Number(left.title > 0)
    || Number(right.frontmatter > 0) - Number(left.frontmatter > 0)
    || right.body - left.body
    || right.title - left.title
    || right.frontmatter - left.frontmatter;
}

/**
 * 有关键词时卡片摘要换成命中处前后的一段（前约 30 字、后约 60 字），让人一眼看出「为什么命中这篇」。
 * 正文没命中（只命中标题或属性）时返回 null，调用方退回普通摘要。
 */
export function librarySnippet(note: Note, query: string): SnippetPart[] | null {
  const terms = highlightTerms(query);
  if (!terms.length) return null;
  const parts = searchSnippet(libraryPlainText(note), query, { radius: 30, fallback: 0 });
  return parts.some((part) => part.hit) ? parts : null;
}

/** 标题高亮：没有普通词时整段原样返回。 */
export function libraryTitleParts(note: Note, query: string): SnippetPart[] {
  return splitByTerms(getTitle(note), highlightTerms(query));
}

/** Obsidian 的标签有的带 #、有的不带；facet 与 URL 一律用不带 # 的写法。 */
export function normalizeTag(tag: string) {
  return tag.trim().replace(/^#+/u, "");
}

export function noteTags(note: Note) {
  return [...new Set((note.tags ?? []).map(normalizeTag).filter(Boolean))];
}

/** 多选标签是「同时满足」：和搜索框空格分隔的 AND 口径一致，越选越窄。 */
export function noteHasTags(note: Note, selected: readonly string[]) {
  if (!selected.length) return true;
  const own = noteTags(note);
  return selected.every((tag) => own.includes(tag));
}

/**
 * 当前范围内出现最多的标签。已选的标签即使掉出前 N 也要留着，否则用户没法在侧栏里取消它。
 */
export function topLibraryTags(notes: readonly Note[], selected: readonly string[] = [], limit = 12) {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of noteTags(note)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const ranked = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
  for (const tag of selected) {
    if (!ranked.some((item) => item.tag === tag)) ranked.push({ tag, count: counts.get(tag) ?? 0 });
  }
  return ranked;
}

/** URL 里的标签列表：逗号分隔，去重去空；认不出时返回空列表。 */
export const tagListCodec = {
  parse: (raw: string): string[] => [...new Set(raw.split(",").map(normalizeTag).filter(Boolean))],
  serialize: (value: string[]) => value.join(","),
};

export type RecencyBucket = "today" | "week" | "month" | "older";

/**
 * 「最近更新」排序下的分组：今天 / 本周（周一起）/ 本月 / 更早。
 * 按本机日历算，不按 24 小时滚动——人说「这周改过的」指的是日历上的这周。
 * 本周的起点可能早于本月 1 号；那几天仍算「本周」，所以顺序上 week 必须先于 month 判断。
 */
export function recencyBucket(mtime: number, now = new Date()): RecencyBucket {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (mtime >= today) return "today";
  const weekday = (now.getDay() + 6) % 7;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday).getTime();
  if (mtime >= weekStart) return "week";
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  if (mtime >= monthStart) return "month";
  return "older";
}

export type RecencyRow<T> = { item: T; bucket: RecencyBucket; first: boolean };

/** 给已按更新时间倒序的列表标出每组的第一项，视图在那里插一个吸顶小标题。 */
export function markRecencyBreaks<T extends { stat: { mtime: number } }>(items: readonly T[], now = new Date()): RecencyRow<T>[] {
  let previous: RecencyBucket | null = null;
  return items.map((item) => {
    const bucket = recencyBucket(item.stat.mtime, now);
    const first = bucket !== previous;
    previous = bucket;
    return { item, bucket, first };
  });
}
