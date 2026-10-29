"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { hydrateInterviewCompany, interviewDefaultSource, type InterviewCatalog, type InterviewContext, type InterviewCompanyProjection, type InterviewQualitySection, type InterviewReviewBlock, type InterviewReviewProjection } from "@/lib/interview-read-model";
import type { InterviewAnswerBlockReview, InterviewAnswerReview } from "@/lib/review-deep";
import type { InterviewAdvisory } from "@/lib/interview-advisory";
import type { Note } from "@/lib/notes";
import type { ReviewBlock } from "@/lib/review";
import type { InterviewTrends } from "@/lib/interview-trends.mjs";
import type { CalendarInterviewTarget } from "@/lib/calendar-interview";
import { ReadModelFetchError } from "./read-model-resource";
import type { CompanyOverview } from "@/lib/company-overview";

export type InterviewView = "session" | "prep" | "review" | "insights" | "practice";
export type InterviewSelection = { sourcePath?: string; contextPath?: string; company?: string; paths?: string[]; overviewOnly?: boolean; calendar?: CalendarInterviewTarget };
export type InterviewRemoteReview = {
  projection: InterviewReviewProjection; blocks: Record<string, ReviewBlock>;
  quality: InterviewAnswerReview | null; advisory: InterviewAdvisory | null;
  qualityBlocks: Record<string, InterviewAnswerBlockReview>;
  sections: { quality: boolean; advisory: boolean }; error: string;
  loadBlocks: (ids: string[]) => Promise<void>;
  loadSection: (section: "quality" | "advisory") => Promise<void>;
  loadQualityBlock: (id: string) => Promise<void>;
};
type State = { notes: Note[]; companyContexts?: CompanyOverview[]; catalog: InterviewCatalog | null; digest: InterviewTrends | null; target: CalendarInterviewTarget | null; revision: string; fetchedAt: number | null; syncState: "ready" | "building" | "failed"; ready: boolean; loading: boolean; error: string; sourcePath: string; contextPath: string; review: InterviewRemoteReview | null };
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** 正文、目录、分块各有独立缓存，迟到的 A 场请求不能覆盖刚选中的 B 场。 */
export function createInterviewContextResource(fetcher: Fetcher = fetch) {
  const initial: State = { notes: [], catalog: null, digest: null, target: null, revision: "", fetchedAt: null, syncState: "ready", ready: false, loading: false, error: "", sourcePath: "", contextPath: "", review: null };
  let state = initial;
  let activeView: InterviewView = "session";
  let activeSelection: InterviewSelection = {};
  let address = "";
  let generation = 0;
  let controller: AbortController | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollDeadline = 0;
  const listeners = new Set<() => void>();
  const noteCache = new Map<string, Note>();
  const blockCache = new Map<string, ReviewBlock>();
  const sectionCache = new Map<string, unknown>();
  const inFlight = new Map<string, Promise<unknown>>();
  const writtenNotes = new Map<string, { note: Note; revision: string; sourcePath: string }>();
  const publish = (next: State) => { state = next; for (const listener of listeners) listener(); };
  async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
    let response = await fetcher(url, { cache: "no-store", signal });
    const until = Date.now() + 60_000;
    while (response.status === 503 && response.headers.has("retry-after") && Date.now() < until) {
      const delay = Math.min(2_000, Math.max(250, Number(response.headers.get("retry-after")) * 1_000 || 1_000));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, delay);
        const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
      response = await fetcher(url, { cache: "no-store", signal });
    }
    const value = await response.json();
    if (!response.ok) throw new ReadModelFetchError((value as { error?: string }).error || `面试资料读取失败（${response.status}）`, response.status);
    return value as T;
  }
  const endpoint = (path: string, revision: string, extra: Record<string, string>) => {
    const params = new URLSearchParams({ revision, ...extra });
    return `/api/interview/${path}?${params}`;
  };
  async function fullNote(path: string, revision: string, signal: AbortSignal) {
    const key = JSON.stringify([revision, path]);
    const cached = noteCache.get(key);
    if (cached) return cached;
    const payload = await json<{ note: Note }>(`/api/note?${new URLSearchParams({ path, revision })}`, signal);
    if (payload.note?.path !== path || typeof payload.note.content !== "string") throw new Error("完整笔记格式无效");
    noteCache.set(key, payload.note);
    return payload.note;
  }
  function remoteReview(projection: InterviewReviewProjection, revision: string, id: number): InterviewRemoteReview {
    const sourcePath = projection.source.path;
    const current = () => id === generation && state.review?.projection.source.path === sourcePath && state.revision === revision;
    const update = (patch: Partial<InterviewRemoteReview>) => { if (current() && state.review) publish({ ...state, review: { ...state.review, ...patch } }); };
    const requestOnce = (key: string, task: () => Promise<unknown>) => {
      const pending = inFlight.get(key);
      if (pending) return pending;
      const next = task().finally(() => { inFlight.delete(key); });
      inFlight.set(key, next);
      return next;
    };
    const result: InterviewRemoteReview = {
      projection, blocks: {}, quality: null, advisory: null, qualityBlocks: {}, sections: { quality: false, advisory: false }, error: "",
      async loadBlocks(ids) {
        try {
          const requested = [...new Set(ids)];
          const adjacent = requested.length === 1 ? projection.blocks.slice(Math.max(0, projection.blocks.findIndex((item) => item.id === requested[0]) - 1),
            projection.blocks.findIndex((item) => item.id === requested[0]) + 2).map((item) => item.id) : [];
          await Promise.all([...new Set([...requested, ...adjacent])].map((block) => {
            if (!projection.blocks.some((item) => item.id === block)) return Promise.resolve();
            const key = JSON.stringify([revision, sourcePath, block]);
            return requestOnce(key, async () => {
              let value = blockCache.get(key);
              if (!value) {
                const payload = await json<{ revision: string; block: InterviewReviewBlock }>(endpoint("review", revision, { path: sourcePath, block }));
                if (payload.revision !== revision || payload.block.sourcePath !== sourcePath || payload.block.block.id !== block) throw new Error("面试分块版本不一致，请刷新重试");
                value = payload.block.block;
                blockCache.set(key, value);
              }
              if (current()) update({ blocks: { ...state.review!.blocks, [block]: value } });
            });
          }));
        } catch (error) { update({ error: error instanceof Error ? error.message : "章节读取失败" }); }
      },
      async loadSection(section) {
        if ((section === "quality" && !projection.hasQuality) || (section === "advisory" && !projection.hasAdvisory)) return;
        const key = JSON.stringify([revision, sourcePath, section]);
        try {
          await requestOnce(key, async () => {
            let value = sectionCache.get(key);
            if (!value) {
              const payload = await json<{ revision: string; section: unknown }>(endpoint("review", revision, { path: sourcePath, section }));
              if (payload.revision !== revision) throw new Error("复盘章节版本不一致，请刷新重试");
              value = payload.section;
              sectionCache.set(key, value);
            }
            if (current()) update({ [section]: section === "quality" ? qualityFromSection(value as InterviewQualitySection) : value,
              sections: { ...state.review!.sections, [section]: true } });
          });
        } catch (error) { update({ error: error instanceof Error ? error.message : "章节读取失败" }); }
      },
      async loadQualityBlock(block) {
        const blocks = state.review?.quality?.blocks ?? [];
        const index = blocks.findIndex((item) => item.blockId === block);
        const ids = index >= 0 ? blocks.slice(Math.max(0, index - 1), index + 2).map((item) => item.blockId) : [block];
        await Promise.all(ids.map(async (block) => {
        const key = JSON.stringify([revision, sourcePath, "quality", block]);
        try {
          await requestOnce(key, async () => {
            let value = sectionCache.get(key) as InterviewAnswerBlockReview | undefined;
            if (!value) {
              const payload = await json<{ revision: string; section: InterviewAnswerBlockReview }>(endpoint("review", revision, { path: sourcePath, section: block }));
              if (payload.revision !== revision || payload.section.blockId !== block) throw new Error("回答评价章节版本不一致，请刷新重试");
              value = payload.section;
              sectionCache.set(key, value);
            }
            if (current()) update({ qualityBlocks: { ...state.review!.qualityBlocks, [block]: value } });
          });
        } catch (error) { update({ error: error instanceof Error ? error.message : "问题评价读取失败" }); }
        }));
      },
    };
    return result;
  }
  async function query(view: InterviewView, selection: InterviewSelection, force = false, polling = false) {
    const key = JSON.stringify([view, selection]);
    const previousView = activeView;
    activeView = view; activeSelection = selection;
    if (!force && key === address && (state.loading || state.ready)) return;
    const changedSelection = key !== address;
    address = key;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (!polling) pollDeadline = Date.now() + 60_000;
    const id = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    // 刷新本场时保留已展开章节，等新投影完整到达才替换，草稿和滚动不依赖目录对象。
    const clearSelection = changedSelection && (view !== "insights" || previousView !== view);
    publish({ ...(clearSelection ? initial : state), ready: false, loading: true, error: "" });
    try {
      const catalogParams = new URLSearchParams({ view });
      for (const field of ["sourcePath", "contextPath", "company"] as const) if (selection[field]) catalogParams.set(field, selection[field]!);
      for (const path of selection.paths ?? []) catalogParams.append("selected", path);
      const payload = await json<{ revision: string; catalog: InterviewCatalog; syncState?: "building" | "failed" }>(`/api/interview/catalog?${catalogParams}`, signal);
      if (id !== generation) return;
      const { revision, catalog } = payload;
      if (catalog?.kind !== "interview-catalog" || typeof revision !== "string") throw new Error("面试目录格式无效");
      let target: CalendarInterviewTarget | null = null;
      if (selection.calendar) {
        const requested = selection.calendar;
        const extra: Record<string, string> = { view: requested.view, date: requested.date, event: requested.sourcePath,
          company: requested.company, round: requested.label, case: requested.caseId };
        if (requested.time) extra.time = requested.time;
        if (requested.path) extra[requested.view === "session" ? "prep" : "review"] = requested.path;
        const resolved = await json<{ revision: string; target: CalendarInterviewTarget }>(endpoint("target", revision, extra), signal);
        if (resolved.revision !== revision) throw new Error("日历场次版本不一致，请刷新重试");
        target = resolved.target;
      }
      const sourcePath = view === "session" ? target ? target.path || target.sourcePath
        : selection.overviewOnly && selection.contextPath ? selection.contextPath : interviewDefaultSource(catalog, selection)
        : view === "review" ? target ? target.path ?? "" : selection.sourcePath ?? "" : "";
      const roots = view === "prep" ? catalog.libraryPaths : view === "practice" ? catalog.practicePaths
        : view === "insights" ? selection.paths ?? catalog.compareDefaults
          : sourcePath ? [sourcePath] : [];
      const [contexts, trendPayload] = await Promise.all([
        Promise.all([...new Set(roots)].map((path) => json<{ revision: string; context: InterviewContext; company?: InterviewCompanyProjection | null }>(endpoint("context", revision, { path }), signal))),
        view === "session" ? json<{ digest: InterviewTrends | null }>(endpoint("trends", revision, {}), signal) : Promise.resolve({ digest: null }),
      ]);
      if (contexts.some((item) => item.revision !== revision)) throw new Error("资料版本不一致，请刷新重试");
      const paths = [...new Set(contexts.flatMap((item) => item.context.paths))];
      let notes = await Promise.all(paths.map((path) => fullNote(path, revision, signal)));
      for (const [path, written] of writtenNotes) {
        if (payload.syncState !== "building" && revision !== written.revision) { writtenNotes.delete(path); continue; }
        if (sourcePath !== written.sourcePath && view !== "practice") continue;
        notes = notes.some((item) => item.path === path) ? notes.map((item) => item.path === path ? written.note : item) : [...notes, written.note];
      }
      const companyProjections = contexts.flatMap((item) => item.company ? [item.company] : []);
      const companyContexts = companyProjections.length ? [...new Map(companyProjections.map((projection) => {
        const company = hydrateInterviewCompany(projection, notes);
        if (!company) throw new Error("本场公司材料版本不完整，请重新读取");
        return [company.note.path, company] as const;
      })).values()] : undefined;
      let review: InterviewRemoteReview | null = null;
      if (view === "review" && sourcePath) {
        const payload = await json<{ revision: string; review: InterviewReviewProjection }>(endpoint("review", revision, { path: sourcePath }), signal);
        if (payload.revision !== revision) throw new Error("复盘版本不一致，请刷新重试");
        review = remoteReview(payload.review, revision, id);
        const previous = state.review;
        if (previous?.projection.source.path === sourcePath) {
          if (state.revision === revision) review = { ...review, blocks: previous.blocks, quality: previous.quality, advisory: previous.advisory, qualityBlocks: previous.qualityBlocks, sections: previous.sections };
          else {
            // 保存后先补齐仍在阅读的章节，再原位换版；句卡不会被 loading 卸载，未提交草稿也保留。
            const blocks = await Promise.all(Object.keys(previous.blocks).filter((block) => payload.review.blocks.some((item) => item.id === block))
              .map(async (block) => (await json<{ block: InterviewReviewBlock }>(endpoint("review", revision, { path: sourcePath, block }), signal)).block.block));
            review.blocks = Object.fromEntries(blocks.map((block) => [block.id, block]));
            for (const section of ["quality", "advisory"] as const) if (previous.sections[section] && (section === "quality" ? payload.review.hasQuality : payload.review.hasAdvisory)) {
              const value = (await json<{ section: InterviewQualitySection & InterviewAdvisory }>(endpoint("review", revision, { path: sourcePath, section }), signal)).section;
              if (section === "quality") review.quality = qualityFromSection(value);
              else review.advisory = value;
              review.sections[section] = true;
            }
            const qualityBlocks = await Promise.all(Object.keys(previous.qualityBlocks).map(async (section) =>
              (await json<{ section: InterviewAnswerBlockReview }>(endpoint("review", revision, { path: sourcePath, section }), signal)).section));
            review.qualityBlocks = Object.fromEntries(qualityBlocks.map((block) => [block.blockId, block]));
          }
        }
      }
      if (id === generation) publish({ notes, companyContexts, catalog, digest: trendPayload.digest, target, revision, fetchedAt: Date.now(), syncState: payload.syncState ?? "ready", ready: true, loading: false, error: "", sourcePath,
        contextPath: contexts[0]?.context.contextPath ?? "", review });
      if (id === generation && payload.syncState === "building" && Date.now() < pollDeadline) pollTimer = setTimeout(() => {
        pollTimer = null; void query(view, selection, true, true);
      }, 1_000);
    } catch (error) {
      if (id !== generation || signal.aborted) return;
      if (error instanceof ReadModelFetchError && error.status === 409 && Date.now() < pollDeadline) {
        // 本地桥重启可能已回收旧正文快照；等同版目录和正文恢复，不把暂时不可读误报为没有准备稿。
        publish({ ...state, ready: false, loading: true, syncState: "building", error: "" });
        pollTimer = setTimeout(() => { pollTimer = null; void query(view, selection, true, true); }, 1_000);
        return;
      }
      publish({ ...state, loading: false, syncState: "failed", error: error instanceof Error ? error.message : "面试资料读取失败" });
    }
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getState: () => state, getServerState: () => initial,
    query,
    select(selection: InterviewSelection) { return query(activeView, selection); },
    refresh() { noteCache.clear(); sectionCache.clear(); blockCache.clear(); return query(activeView, activeSelection, true); },
    patchNote(note: Note) {
      // 写入应答只更新这一篇正文。派生投影在同步完成后按本场重新读取。
      for (const [key, cached] of noteCache) if (cached.path === note.path) noteCache.delete(key);
      writtenNotes.set(note.path, { note, revision: state.revision, sourcePath: state.sourcePath });
      publish({ ...state, notes: state.notes.some((item) => item.path === note.path)
        ? state.notes.map((item) => item.path === note.path ? note : item) : [...state.notes, note] });
      return query(activeView, activeSelection, true);
    },
    dispose() { generation++; controller?.abort(); if (pollTimer) clearTimeout(pollTimer); },
  };
}

/** 摘要保留筛选和标题所需的字段，详细评价只在对应问题展开后补齐。 */
function qualityFromSection(section: InterviewQualitySection): InterviewAnswerReview {
  return { ...section.review, blocks: section.blocks.map(({ missedCount, ...block }) => ({ ...block,
    interviewerIntentZh: "", askedPoints: [], answeredPoints: [], missedPoints: Array.from({ length: missedCount }, () => ""),
    evaluationZh: "", improvementZh: "", improvedAnswerJa: "" })) };
}

export function useInterviewContext(options: InterviewSelection & { enabled: boolean; view: InterviewView; today?: string }) {
  const resource = useMemo(() => createInterviewContextResource(), []);
  const state = useSyncExternalStore(resource.subscribe, resource.getState, resource.getServerState);
  const selectionKey = JSON.stringify({ sourcePath: options.sourcePath, contextPath: options.contextPath, company: options.company, paths: options.paths, overviewOnly: options.overviewOnly, calendar: options.calendar });
  useEffect(() => {
    if (options.enabled) void resource.query(options.view, JSON.parse(selectionKey), true);
  }, [resource, options.enabled, options.view, options.today, selectionKey]);
  useEffect(() => () => resource.dispose(), [resource]);
  return { ...state, select: resource.select, refresh: resource.refresh, patchNote: resource.patchNote };
}
