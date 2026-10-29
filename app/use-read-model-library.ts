"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { BacklinksPage, LibraryPage, LibraryQuery, SearchPage } from "@/lib/read-model";
import { createReadModelResource } from "./read-model-resource";

function useCollection<T extends { revision: string; items: unknown[]; nextCursor?: string | null }>(url: string, enabled: boolean, revision?: string | number) {
  const [resource] = useState(() => createReadModelResource<T>());
  const state = useSyncExternalStore(resource.subscribe, resource.getState, resource.getServerState);
  useEffect(() => { if (enabled) void resource.query(url, true); }, [resource, url, enabled, revision]);
  useEffect(() => () => resource.dispose(), [resource]);
  return { ...state, loading: enabled && (state.loading || !state.page && !state.error), more: resource.more, retry: resource.retry };
}

export function libraryReadModelUrl(query: LibraryQuery) {
  const params = new URLSearchParams({ q: query.query ?? "", group: query.group ?? "all", scope: query.scope ?? "all", sort: query.sort ?? "auto", limit: "24" });
  (query.tags ?? []).forEach((tag) => params.append("tags", tag));
  return `/api/read-model/library?${params}`;
}

export function useReadModelLibrary(query: LibraryQuery, enabled: boolean, revision?: string | number) {
  return useCollection<LibraryPage>(libraryReadModelUrl(query), enabled, revision);
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
