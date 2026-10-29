"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { InterviewCatalog } from "../lib/interview-read-model.ts";
import type { SharedAssetTarget } from "../lib/interview-shared-assets.ts";
import type { Note } from "../lib/notes.ts";
import type { NoteResolution } from "../lib/read-model.ts";
import { readReadModelJSON, type ReadModelFetcher } from "./read-model-resource.ts";

export type InterviewOverlayNotesInput = {
  cardId?: string | null;
  asset?: SharedAssetTarget | null;
  catalog?: Pick<InterviewCatalog, "libraryPaths"> | null;
  revision?: string | null;
  /** 只可传入同一资料版本中已经读取的完整正文，不能传目录卡片或正文占位。 */
  seed?: readonly Note[];
};

type State = { notes: Note[]; sharedNote: Note | null; loading: boolean; error: string };

function inputKey(input: InterviewOverlayNotesInput) {
  return JSON.stringify([input.cardId || "", input.asset?.note ?? "", input.revision ?? "", input.catalog?.libraryPaths ?? null]);
}

/** 固定回答和共用素材有独立全文缓存，只在打开对应阅读层后补读其明确来源。 */
export function createInterviewOverlayNotesResource(fetcher: ReadModelFetcher = fetch) {
  const initial: State = { notes: [], sharedNote: null, loading: false, error: "" };
  let state = initial;
  let address = "";
  let selection: InterviewOverlayNotesInput = {};
  let generation = 0;
  let controller: AbortController | null = null;
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const versions = new Map<string, { notes: Map<string, Note>; resolutions: Map<string, NoteResolution> }>();
  const publish = (next: State) => { state = next; listeners.forEach((notify) => notify()); };

  function versionCache(revision: string) {
    let cache = versions.get(revision);
    if (!cache) {
      cache = { notes: new Map(), resolutions: new Map() };
      versions.set(revision, cache);
      if (versions.size > 3) versions.delete(versions.keys().next().value!);
    }
    return cache;
  }

  function query(input: InterviewOverlayNotesInput, force = false): Promise<void> {
    selection = input;
    const key = inputKey(input);
    if (!force && address === key) return pending ?? Promise.resolve();
    address = key;
    const id = ++generation;
    controller?.abort();
    const current = controller = new AbortController();
    const active = Boolean(input.cardId || input.asset);
    publish({ ...initial, loading: active });
    const revision = input.revision;
    if (!active || !revision || input.cardId && !input.catalog) { pending = null; return Promise.resolve(); }
    const cache = versionCache(revision);
    for (const note of input.seed ?? []) {
      if (note && typeof note.path === "string" && typeof note.content === "string" && note.frontmatter && typeof note.frontmatter === "object") cache.notes.set(note.path, note);
    }
    const notesInFlight = new Map<string, Promise<Note>>();

    function fullNote(path: string): Promise<Note> {
      const cached = cache.notes.get(path);
      if (cached) return Promise.resolve(cached);
      const inFlight = notesInFlight.get(path);
      if (inFlight) return inFlight;
      const request = (async () => {
        const value = await readReadModelJSON<{ note: Note; revision?: string }>(`/api/note?${new URLSearchParams({ path, revision: revision! })}`, current.signal, fetcher);
        if (current.signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (value.revision && value.revision !== revision) throw new Error("面试素材版本不一致，请重新打开。");
        if (value.note?.path !== path || typeof value.note.content !== "string" || !value.note.frontmatter || typeof value.note.frontmatter !== "object") throw new Error("完整面试素材格式无效");
        cache.notes.set(path, value.note);
        return value.note;
      })();
      notesInFlight.set(path, request);
      return request;
    }

    async function sharedNote() {
      const target = input.asset?.note;
      if (!target) return null;
      let resolution = cache.resolutions.get(target);
      if (!resolution) {
        resolution = await readReadModelJSON<NoteResolution>(`/api/read-model/resolve?${new URLSearchParams({ target, revision: revision! })}`, current.signal, fetcher);
        if (current.signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (!resolution || !["resolved", "missing", "ambiguous"].includes(resolution.kind) || resolution.kind === "resolved" && typeof resolution.path !== "string") throw new Error("面试素材目录格式无效");
        if (resolution.revision !== revision) throw new Error("面试素材版本不一致，请重新打开。");
        cache.resolutions.set(target, resolution);
      }
      if (resolution.kind === "ambiguous") throw new Error("面试素材链接重名，请使用完整来源路径。");
      if (resolution.kind !== "resolved") throw new Error("找不到这份面试素材。");
      return fullNote(resolution.path);
    }

    const task = (async () => {
      const [library, asset] = await Promise.allSettled([
        input.cardId ? Promise.all([...new Set(input.catalog!.libraryPaths)].map(fullNote)) : Promise.resolve([] as Note[]),
        sharedNote(),
      ]);
      if (id !== generation || current.signal.aborted) return;
      const error = [library, asset].find((result) => result.status === "rejected");
      publish({ notes: library.status === "fulfilled" ? library.value : [], sharedNote: asset.status === "fulfilled" ? asset.value : null,
        loading: false, error: error?.status === "rejected" ? error.reason instanceof Error ? error.reason.message : "面试素材读取失败" : "" });
    })().finally(() => { if (id === generation) pending = null; });
    pending = task;
    return task;
  }

  return {
    subscribe(notify: () => void) { listeners.add(notify); return () => { listeners.delete(notify); }; },
    getState: () => state,
    getServerState: () => initial,
    matches: (input: InterviewOverlayNotesInput) => address === inputKey(input),
    query,
    retry: () => query(selection, true),
    dispose() { generation++; controller?.abort(); controller = null; pending = null; address = ""; },
  };
}

export function useInterviewOverlayNotes(input: InterviewOverlayNotesInput) {
  const [resource] = useState(createInterviewOverlayNotesResource);
  const state = useSyncExternalStore(resource.subscribe, resource.getState, resource.getServerState);
  const key = inputKey(input);
  // 同一阅读目标保持已完成正文，不因父页产生新的 notes 数组而重新读取。
  useEffect(() => { void resource.query(input); }, [resource, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => resource.dispose(), [resource]);
  const active = Boolean(input.cardId || input.asset);
  const matches = resource.matches(input);
  return { notes: matches ? state.notes : [], sharedNote: matches ? state.sharedNote : null, error: matches ? state.error : "",
    loading: active && (!matches || state.loading || !input.revision || Boolean(input.cardId && !input.catalog)), retry: resource.retry };
}
