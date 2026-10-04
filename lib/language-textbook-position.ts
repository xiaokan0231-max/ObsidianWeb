import type { TextbookModule } from "./language-textbook-module.ts";

export const TEXTBOOK_VIEWS = ["explain", "source", "contrast", "examples"] as const;
export type TextbookView = typeof TEXTBOOK_VIEWS[number];
export type TextbookPosition = { knowledge: string; lessonView: TextbookView };
export const textbookPositionKey = (chapterId: string) => `obsidianweb:textbook-position:v1:${chapterId}`;

export function normalizeTextbookPosition(module: TextbookModule, candidate: unknown): TextbookPosition {
  const value = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
  const matched = module.points.find(point => point.id === value.knowledge);
  const point = matched ?? module.points[0];
  const validView = TEXTBOOK_VIEWS.includes(value.lessonView as TextbookView)
    && (value.lessonView !== "source" || !!point.source);
  // 已删除的知识点不能把原来的页签套到另一点；旧 source 链接仍可读讲解。
  return { knowledge: point.id, lessonView: validView && (!value.knowledge || matched) ? value.lessonView as TextbookView : "explain" };
}

export function resolveTextbookPosition(module: TextbookModule, search: string, saved?: unknown): TextbookPosition {
  const params = new URLSearchParams(search);
  // 显式链接作为完整位置处理，不与本机另一知识点的缓存拼接。
  const candidate = params.has("knowledge") || params.has("lessonView")
    ? { knowledge: params.get("knowledge"), lessonView: params.get("lessonView") }
    : saved;
  return normalizeTextbookPosition(module, candidate);
}

export function readTextbookPosition(chapterId: string): unknown {
  try { return JSON.parse(window.localStorage.getItem(textbookPositionKey(chapterId)) ?? "null"); }
  catch { return null; }
}

export function textbookChapterLink(href: string, origin: string, chapterIds: string[]) {
  try {
    const url = new URL(href, origin);
    const chapterId = url.searchParams.get("chapter");
    if (url.origin !== origin || url.pathname !== "/training/topics" || url.searchParams.has("course")
      || url.hash || !chapterId || !chapterIds.includes(chapterId)) return null;
    return { chapterId, search: url.search };
  } catch { return null; }
}
