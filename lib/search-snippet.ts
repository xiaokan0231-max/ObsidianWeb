/**
 * ⌘K 结果的摘要：给出命中位置前后的一段，而不是永远是正文开头——
 * 全文匹配时人要先看到「为什么命中这篇」，才决定点不点开。
 *
 * 检索词沿用 noteMatches 的写法：空格分隔的词全部要命中（AND），词内 | 是 OR，
 * type:/status:/folder: 这类前缀词只筛选不高亮。
 */
export type SnippetPart = { text: string; hit: boolean };

/** 取出用于高亮的普通词（去掉带冒号的前缀词，展开 | 的候选）。 */
export function highlightTerms(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((token) => token && !token.includes(":"))
    .flatMap((token) => token.split("|"))
    .map((token) => token.trim())
    .filter(Boolean);
}

/** 按词把一段文字切成「命中 / 非命中」片段，大小写不敏感。 */
export function splitByTerms(text: string, terms: readonly string[]): SnippetPart[] {
  if (!terms.length || !text) return [{ text, hit: false }];
  const lower = text.toLocaleLowerCase();
  const ranges: [number, number][] = [];
  for (const term of terms) {
    const needle = term.toLocaleLowerCase();
    for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
      ranges.push([at, at + needle.length]);
    }
  }
  if (!ranges.length) return [{ text, hit: false }];
  ranges.sort((left, right) => left[0] - right[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const parts: SnippetPart[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}

/**
 * 命中处前后各约 `radius` 字的一段；没命中（或只用了前缀词）就退回开头。
 * 截断的一侧补省略号，让人知道这是中间的一段。
 */
export function searchSnippet(text: string, query: string, { radius = 40, fallback = 92 } = {}): SnippetPart[] {
  const terms = highlightTerms(query);
  const lower = text.toLocaleLowerCase();
  let first = -1;
  for (const term of terms) {
    const at = lower.indexOf(term.toLocaleLowerCase());
    if (at >= 0 && (first < 0 || at < first)) first = at;
  }
  if (first < 0) return [{ text: text.slice(0, fallback), hit: false }];
  const start = Math.max(0, first - radius);
  const end = Math.min(text.length, first + radius * 2);
  const slice = `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  return splitByTerms(slice, terms);
}
