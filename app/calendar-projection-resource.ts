import type { AiApplicationDay } from "../lib/calendar-applications.ts";
import type { CalendarRangePage } from "../lib/calendar-query-model.ts";
import type { CalendarSnapshot } from "../lib/calendar-snapshot.ts";
import { calendarMonthDays } from "../lib/calendar-month.ts";
import { localDateKey } from "../lib/memory-atlas-data.ts";
import { calendarWeekStart } from "../lib/calendar-week.ts";
import { shiftCalendarDay } from "../lib/calendar-summary.ts";
import { readReadModelJSON, readModelSyncState, ReadModelFetchError, type ReadModelSyncState, type ReadModelFetcher, type ReadModelReadOptions } from "./read-model-resource.ts";

export type CalendarRangeSelection = { from: string; to: string; month: string };
export type CalendarHistoryPage = { revision: string; today: string; total: number; nextOffset: number | null; events: CalendarSnapshot["events"] };
export type CalendarInitialPin = { revision: string; today: string };
export type CalendarApplicationsState = { date: string; day: AiApplicationDay | null; loading: boolean; error: string; fetchedAt: number | null };
export type CalendarProjectionState = {
  page: CalendarRangePage | null;
  loading: boolean;
  error: string;
  fetchedAt: number | null;
  syncState: ReadModelSyncState | null;
  history: { loaded: boolean; loading: boolean; error: string; total: number; nextOffset: number | null; events: CalendarSnapshot["events"] };
  recent: CalendarProjectionState["history"];
  applications: CalendarApplicationsState;
};

export function calendarMonthParam(value: string) {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

export function calendarWeekParam(value: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? calendarWeekStart(value) : null;
}

export function calendarInitialRange(search: string, today: string): CalendarRangeSelection {
  const params = new URLSearchParams(search);
  if (params.get("calview") === "week") {
    const from = calendarWeekParam(params.get("calweek") ?? "") ?? calendarWeekStart(today);
    return { from, to: shiftCalendarDay(from, 6), month: from.slice(0, 7) };
  }
  const month = calendarMonthParam(params.get("month") ?? "") ?? today.slice(0, 7);
  const [year, ordinal] = month.split("-").map(Number);
  const days = calendarMonthDays(new Date(year, ordinal - 1, 1));
  return { from: localDateKey(days[0]), to: localDateKey(days.at(-1)!), month };
}

/** 范围、历史和单日申请各自读取；迟到响应不能把新月份或新资料版本覆盖回去。 */
export function createCalendarProjectionResource(fetcher: ReadModelFetcher = fetch, options: ReadModelReadOptions = {}, initialPin?: CalendarInitialPin) {
  const emptyHistory: CalendarProjectionState["history"] = { loaded: false, loading: false, error: "", total: 0, nextOffset: 0, events: [] };
  const emptyApplications: CalendarApplicationsState = { date: "", day: null, loading: false, error: "", fetchedAt: null };
  const initial: CalendarProjectionState = { page: null, loading: false, error: "", fetchedAt: null, syncState: null, history: emptyHistory, recent: emptyHistory, applications: emptyApplications };
  let state = initial;
  let range: CalendarRangeSelection | null = null;
  let acceptedRange: CalendarRangeSelection | null = null;
  let acceptedSyncKey: string | number | undefined;
  let pin = initialPin;
  let rangeId = 0;
  let rangeController: AbortController | null = null, applicationController: AbortController | null = null;
  let applicationPending: { date: string; request: Promise<void> } | null = null;
  let applicationRecovery: AbortController | null = null;
  let rangePending: Promise<void> | null = null;
  let freshnessController: AbortController | null = null;
  let freshnessPending: Promise<void> | null = null;
  const pageIds = { history: 0, recent: 0 };
  const pageControllers: Record<"history" | "recent", AbortController | null> = { history: null, recent: null };
  const pagePending: Record<"history" | "recent", Promise<void> | null> = { history: null, recent: null };
  const pageRecovery: Record<"history" | "recent", Promise<void> | null> = { history: null, recent: null };
  let visit = 0;
  let syncKey: string | number | undefined;
  const applicationCache = new Map<string, { day: AiApplicationDay | null; fetchedAt: number }>();
  const subscribers = new Set<() => void>();
  const publish = (next: CalendarProjectionState) => { state = next; subscribers.forEach((notify) => notify()); };
  const message = (error: unknown) => error instanceof Error ? error.message : "日历资料读取失败";
  const sameRange = (left: CalendarRangeSelection | null, right: CalendarRangeSelection) =>
    left?.from === right.from && left.to === right.to && left.month === right.month;
  const hasAcceptedRange = (wanted: CalendarRangeSelection) =>
    sameRange(acceptedRange, wanted) && acceptedSyncKey === syncKey && state.syncState === "ready" && !state.error;

  function read<T>(url: string, signal: AbortSignal, onProgress?: (page: T) => void): Promise<T> {
    return readReadModelJSON<T>(url, signal, fetcher, onProgress, options);
  }

  function cancelApplicationRead() {
    applicationController?.abort();
    applicationController = null;
    applicationPending = null;
    applicationRecovery = null;
  }

  function clearDetails() {
    if (!applicationRecovery) cancelApplicationRead();
    for (const kind of ["history", "recent"] as const) { pageIds[kind]++; pageControllers[kind]?.abort(); pagePending[kind] = null; }
    applicationCache.clear();
  }

  function requestRange(initialVersion = pin, freshnessSignal?: AbortSignal): Promise<void> {
    if (!range) return Promise.resolve();
    const requested = range;
    const requestedSyncKey = syncKey;
    const id = ++rangeId;
    rangeController?.abort();
    const controller = rangeController = new AbortController();
    const signals = [controller.signal, AbortSignal.timeout(65_000)];
    if (freshnessSignal) signals.push(freshnessSignal);
    const signal = AbortSignal.any(signals);
    const params = new URLSearchParams(requested);
    publish({ ...state, loading: true, error: "" });
    const accept = (page: CalendarRangePage, expected?: CalendarInitialPin) => {
      if (id !== rangeId || signal.aborted) return;
      if (!page || typeof page.revision !== "string" || typeof page.today !== "string" || !page.snapshot || !Array.isArray(page.applicationDays)
        || page.summary?.month !== requested.month || page.summary.today !== page.today) throw new Error("日历目录格式无效");
      if (expected && (page.revision !== expected.revision || page.today !== expected.today)) throw new ReadModelFetchError("日历资料版本已更新", 409);
      acceptedRange = requested;
      acceptedSyncKey = requestedSyncKey ?? syncKey;
      const changed = state.page?.revision !== page.revision || state.page.today !== page.today;
      if (changed) clearDetails();
      const applications = applicationRecovery ? { ...emptyApplications, date: state.applications.date, loading: true } : emptyApplications;
      publish({ ...state, page, loading: false, error: "", fetchedAt: Date.now(), syncState: readModelSyncState(page), ...(changed ? { history: emptyHistory, recent: emptyHistory, applications } : {}) });
    };
    const request = (async () => {
      try {
        const load = async (expected?: CalendarInitialPin) => {
          const target = new URLSearchParams(params);
          if (expected) { target.set("revision", expected.revision); target.set("today", expected.today); }
          const receive = (page: CalendarRangePage) => accept(page, expected);
          receive(await read<CalendarRangePage>(`/api/read-model/calendar/range?${target}`, signal, receive));
        };
        try { await load(initialVersion); }
        catch (error) {
          if (!initialVersion || id !== rangeId || signal.aborted || !(error instanceof ReadModelFetchError) || error.status !== 409) throw error;
          pin = undefined;
          await load();
        }
        if (id === rangeId && !signal.aborted) pin = undefined;
      } catch (error) {
        if (id !== rangeId || controller.signal.aborted) return;
        if (freshnessSignal?.aborted) { publish({ ...state, loading: false }); return; }
        publish({ ...state, loading: false, error: message(error) });
      }
    })().finally(() => { if (id === rangeId) rangePending = null; });
    rangePending = request;
    return request;
  }

  function onRangeChange(next: CalendarRangeSelection) {
    if (sameRange(range, next)) return rangePending ?? (hasAcceptedRange(next) ? Promise.resolve() : requestRange());
    range = next;
    return requestRange();
  }

  function checkFreshness(): Promise<void> {
    if (freshnessPending) return freshnessPending;
    if (!state.page || rangePending) return Promise.resolve();
    const controller = freshnessController = new AbortController();
    const pending = (async () => {
      try {
        const response = await fetcher("/api/read-model/warm", {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
        });
        if (!response.ok || controller.signal.aborted) return;
        const status = await response.json() as { revision?: string; state?: string };
        if (controller.signal.aborted || !state.page || rangePending || typeof status.revision !== "string") return;
        // 同一 ready 版本无需重取详情。构建中的新版本沿用范围请求原有的有界轮询。
        if (status.state === "ready" && status.revision !== state.page.revision) {
          await requestRange({ revision: status.revision, today: state.page.today }, controller.signal);
        } else if (status.state === "building") {
          await requestRange(undefined, controller.signal);
        } else if (status.state === "ready" && state.syncState !== "ready") {
          publish({ ...state, syncState: "ready" });
        }
      } catch {
        // 背景探测失败保留已经读到的资料，下一次定时检查再尝试。
      }
    })().finally(() => {
      if (freshnessController === controller) { freshnessController = null; freshnessPending = null; }
    });
    freshnessPending = pending;
    return pending;
  }

  function suspendFreshness() { freshnessController?.abort(); }

  function refreshRange() { pin = undefined; return requestRange(); }

  function loadEventPage(kind: "history" | "recent", allowRecovery = true): Promise<void> {
    const recovery = pageRecovery[kind];
    if (allowRecovery && recovery) return recovery;
    if (pagePending[kind]) return pagePending[kind];
    const source = state.page;
    const previous = state[kind];
    if (!source || previous.loaded && previous.nextOffset === null) return Promise.resolve();
    const { revision, today } = source;
    const offset = previous.loaded ? previous.nextOffset ?? 0 : 0;
    const id = ++pageIds[kind];
    pageControllers[kind]?.abort();
    const controller = pageControllers[kind] = new AbortController();
    publish({ ...state, [kind]: { ...previous, loading: true, error: "" } });
    const request: Promise<void> = (async () => {
      try {
        const page = await read<CalendarHistoryPage>(`/api/read-model/calendar/history?${new URLSearchParams({ revision, today, offset: String(offset), scope: kind === "recent" ? "recent" : "historical" })}`, controller.signal);
        if (id !== pageIds[kind] || controller.signal.aborted) return;
        if (page.revision !== revision || page.today !== today || state.page?.revision !== revision || state.page.today !== today) throw new Error("资料版本已更新，请重新读取日历。");
        const events = [...new Map([...previous.events, ...page.events].map((entry) => [entry.event.id, entry])).values()];
        publish({ ...state, [kind]: { loaded: true, loading: false, error: "", total: page.total, nextOffset: page.nextOffset, events } });
      } catch (error) {
        if (id !== pageIds[kind] || controller.signal.aborted) return;
        if (allowRecovery && error instanceof ReadModelFetchError && error.status === 409) {
          // 旧分页保留到未固定版本的范围读取成功；新日程版本必须从第一页重新开始。
          const startedOnVisit = visit;
          pageRecovery[kind] = pagePending[kind];
          await (rangePending ?? refreshRange());
          if (startedOnVisit !== visit) return;
          if (state.page && (state.page.revision !== revision || state.page.today !== today)) {
            await loadEventPage(kind, false);
            return;
          }
          if (id !== pageIds[kind] || controller.signal.aborted) return;
        }
        publish({ ...state, [kind]: { ...state[kind], loading: false, error: message(error) } });
      }
    })().finally(() => {
      if (pageRecovery[kind] === request) pageRecovery[kind] = null;
      if (id === pageIds[kind]) pagePending[kind] = null;
    });
    pagePending[kind] = request;
    return request;
  }

  function closeApplications() {
    cancelApplicationRead();
    publish({ ...state, applications: emptyApplications });
  }

  function loadApplications(date: string): Promise<void> {
    if (applicationPending?.date === date) return applicationPending.request;
    const source = state.page;
    if (!source) return Promise.resolve();
    cancelApplicationRead();
    const cached = applicationCache.get(`${source.revision}:${source.today}:${date}`);
    if (cached) {
      publish({ ...state, applications: { date, ...cached, loading: false, error: "" } });
      return Promise.resolve();
    }
    const controller = applicationController = new AbortController();
    publish({ ...state, applications: { date, day: null, loading: true, error: "", fetchedAt: null } });
    const readDay = async ({ revision, today }: CalendarInitialPin) => {
      const params = new URLSearchParams({ revision, today, date });
      const page = await read<{ revision: string; today: string; day: AiApplicationDay | null }>(`/api/read-model/calendar/applications?${params}`, controller.signal);
      if (page.revision !== revision || page.today !== today || state.page?.revision !== revision || state.page.today !== today) throw new Error("资料版本已更新，请重新读取日历。");
      return page;
    };
    const request = (async () => {
      try {
        let page;
        try { page = await readDay(source); }
        catch (error) {
          if (controller.signal.aborted || !(error instanceof ReadModelFetchError) || error.status !== 409) throw error;
          // 让当前日期跟着范围换版；用户关闭或改选日期后，旧恢复不能再打开详情。
          applicationRecovery = controller;
          await (rangePending ?? refreshRange());
          if (controller.signal.aborted) return;
          applicationRecovery = null;
          const next = state.page;
          if (!next || next.revision === source.revision && next.today === source.today) throw error;
          page = await readDay(next);
        }
        if (controller.signal.aborted) return;
        const fetchedAt = Date.now();
        applicationCache.set(`${page.revision}:${page.today}:${date}`, { day: page.day, fetchedAt });
        publish({ ...state, applications: { date, day: page.day, loading: false, error: "", fetchedAt } });
      } catch (error) {
        if (!controller.signal.aborted) publish({ ...state, applications: { date, day: null, loading: false, error: message(error), fetchedAt: null } });
      }
    })().finally(() => {
      if (applicationController === controller) {
        applicationController = null;
        applicationPending = null;
      }
      if (applicationRecovery === controller) applicationRecovery = null;
    });
    applicationPending = { date, request };
    return request;
  }

  return {
    subscribe(notify: () => void) { subscribers.add(notify); return () => { subscribers.delete(notify); }; },
    getState: () => state,
    getServerState: () => initial,
    onRangeChange, loadApplications, closeApplications, loadHistory: () => loadEventPage("history"), loadRecent: () => loadEventPage("recent"),
    synchronize(fallback: CalendarRangeSelection, key?: string | number) {
      if (!range) range = fallback;
      if (syncKey !== undefined && syncKey !== key) {
        syncKey = key;
        pin = undefined;
        return requestRange();
      }
      if (syncKey === undefined) acceptedSyncKey = key;
      syncKey = key;
      return rangePending ?? (hasAcceptedRange(range) ? Promise.resolve() : requestRange());
    },
    refresh: refreshRange,
    checkFreshness, suspendFreshness,
    suspend() {
      suspendFreshness();
      visit++;
      rangeId++; rangeController?.abort(); cancelApplicationRead(); rangePending = null;
      for (const kind of ["history", "recent"] as const) { pageIds[kind]++; pageControllers[kind]?.abort(); pagePending[kind] = null; pageRecovery[kind] = null; }
      if (state.loading || state.history.loading || state.recent.loading || state.applications.loading) publish({ ...state, loading: false, history: { ...state.history, loading: false }, recent: { ...state.recent, loading: false }, applications: { ...state.applications, loading: false } });
    },
    dispose() { suspendFreshness(); visit++; rangeId++; rangeController?.abort(); cancelApplicationRead(); clearDetails(); rangePending = null; pageRecovery.history = pageRecovery.recent = null; },
  };
}
