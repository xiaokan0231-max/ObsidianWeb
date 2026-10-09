"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { TextbookModule } from "@/lib/language-textbook-module";
import { normalizeTextbookPosition, readTextbookPosition, resolveTextbookPosition, textbookPositionKey, type TextbookPosition } from "@/lib/language-textbook-position";
import { notifyUrlChange, URL_CHANGE_EVENT } from "./use-url-state";

const readSearch = () => typeof window === "undefined" ? "" : window.location.search;
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(URL_CHANGE_EVENT, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(URL_CHANGE_EVENT, listener); };
}
export const useTextbookSearch = () => useSyncExternalStore(subscribe, readSearch, readSearch);

export function useTextbookPosition(chapterId: string, chapterIds: string[], module: TextbookModule) {
  const search = useTextbookSearch();
  const position = resolveTextbookPosition(module, search, readTextbookPosition(chapterId));
  const { knowledge, lessonView } = position;
  const persist = useCallback((nextPosition: TextbookPosition) => {
    if (window.location.pathname !== "/training/topics" || window.location.search !== search) return;
    const params = new URLSearchParams(search);
    const requested = params.get("chapter") ?? "";
    if ((chapterIds.includes(requested) ? requested : chapterIds[0]) !== chapterId) return;
    params.set("chapter", chapterId);
    params.set("knowledge", nextPosition.knowledge);
    params.set("lessonView", nextPosition.lessonView);
    const next = `${window.location.pathname}?${params}${window.location.hash}`;
    const changed = next !== `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (changed) window.history.replaceState(window.history.state, "", next);
    // 只记阅读位置；存储被禁用时 URL 仍能恢复，不产生完成或能力记录。
    try { window.localStorage.setItem(textbookPositionKey(chapterId), JSON.stringify(nextPosition)); } catch { /* 保留本次阅读 */ }
    if (changed) notifyUrlChange();
  }, [search, chapterId, chapterIds]);
  useEffect(() => {
    // URL 是唯一即时状态；旧 render 的 effect 不能覆盖 back 已切换的地址。
    persist({ knowledge, lessonView });
  }, [persist, knowledge, lessonView]);
  return [position, (next: TextbookPosition) => persist(normalizeTextbookPosition(module, next))] as const;
}
