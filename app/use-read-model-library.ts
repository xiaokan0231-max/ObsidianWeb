"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { BacklinksPage, LibraryPage, LibraryQuery, SearchPage } from "@/lib/read-model";
import { createReadModelResource } from "./read-model-resource";

function useCollection<T extends { revision: string; items: unknown[]; nextCursor?: string | null }>(url: string, enabled: boolean, revision?: string | number) {
  const [resource] = useState(() => createReadModelResource<T>());
  const snapshot = useSyncExternalStore(resource.subscribe, resource.getState, resource.getServerState);
  const state = enabled && resource.matches(url) ? snapshot : resource.getServerState();
  useEffect(() => {
    if (enabled) void resource.query(url, true);
    else resource.dispose();
  }, [resource, url, enabled, revision]);
  useEffect(() => () => resource.dispose(), [resource]);
  return { ...state, loading: enabled && (state.loading || !state.page && !state.error), more: resource.more, retry: resource.retry };
}

export function libraryReadModelUrl(query: LibraryQuery) {
  const params = new URLSearchParams({ q: query.query ?? "", group: query.group ?? "all", scope: query.scope ?? "all", sort: query.sort ?? "auto", limit: "24" });
  (query.tags ?? []).forEach((tag) => params.append("tags", tag));
  return `/api/read-model/library?${params}`;
}

export function useReadModelLibrary(query: LibraryQuery, enabled: boolean, revision?: string | number, debounceMs = 0) {
  const text = query.query ?? "";
  const [settledText, setSettledText] = useState(text);
  const waiting = enabled && debounceMs > 0 && text !== settledText;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setTimeout(() => setSettledText(text), debounceMs);
    return () => window.clearTimeout(timer);
  }, [waiting, text, debounceMs]);
  const result = useCollection<LibraryPage>(libraryReadModelUrl(query), enabled && !waiting, revision);
  // 新关键词等待输入结束时不展示上一个查询的命中或翻页入口。
  return waiting ? { ...result, loading: true } : result;
}

export function useReadModelSearch(query: string, recent: readonly string[], enabled: boolean, revision?: string | number) {
  const params = new URLSearchParams({ q: query, limit: "8" });
  if (!query.trim()) recent.slice(0, 8).forEach((path) => params.append("recent", path));
  return useCollection<SearchPage>(`/api/read-model/search?${params}`, enabled, revision);
}

export function useReadModelBacklinks(path: string, enabled: boolean, revision?: string) {
  const params = new URLSearchParams({ path });
  if (revision) params.set("revision", revision);
  return useCollection<BacklinksPage>(`/api/read-model/backlinks?${params}`, enabled, revision);
}

export type IndexedNoteLinks = ReturnType<typeof useReadModelBacklinks>;
