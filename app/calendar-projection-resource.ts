import type { AiApplicationDay } from "../lib/calendar-applications.ts";
import type { CalendarRangePage } from "../lib/calendar-query-model.ts";
import type { CalendarSnapshot } from "../lib/calendar-snapshot.ts";
import { calendarMonthDays } from "../lib/calendar-month.ts";
import { localDateKey } from "../lib/memory-atlas-data.ts";
import { calendarWeekStart } from "../lib/calendar-week.ts";
import { shiftCalendarDay } from "../lib/calendar-summary.ts";
import { readReadModelJSON, readModelSyncState, type ReadModelSyncState, type ReadModelFetcher, type ReadModelReadOptions } from "./read-model-resource.ts";

export type CalendarRangeSelection = { from: string; to: string; month: string };
export type CalendarHistoryPage = { revision: string; total: number; nextOffset: number | null; events: CalendarSnapshot["events"] };
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

export function calendarInitialRange(search: string, today: string): CalendarRangeSelection {
  const params = new URLSearchParams(search);
  if (params.get("calview") === "week") {
    const requested = params.get("calweek") ?? "";
    const from = calendarWeekStart(/^20\d{2}-\d{2}-\d{2}$/.test(requested) && Number.isFinite(Date.parse(`${requested}T00:00:00Z`)) ? requested : today);
    return { from, to: shiftCalendarDay(from, 6), month: from.slice(0, 7) };
  }
  const requested = params.get("month") ?? "";
  const month = /^20\d{2}-(0[1-9]|1[0-2])$/.test(requested) ? requested : today.slice(0, 7);
  const [year, ordinal] = month.split("-").map(Number);
  const days = calendarMonthDays(new Date(year, ordinal - 1, 1));
  return { from: localDateKey(days[0]), to: localDateKey(days.at(-1)!), month };
}

/** 范围、历史和单日申请各自读取；迟到响应不能把新月份或新资料版本覆盖回去。 */
export function createCalendarProjectionResource(fetcher: ReadModelFetcher = fetch, options: ReadModelReadOptions = {}) {
  const emptyHistory: CalendarProjectionState["history"] = { loaded: false, loading: false, error: "", total: 0, nextOffset: 0, events: [] };
  const emptyApplications: CalendarApplicationsState = { date: "", day: null, loading: false, error: "", fetchedAt: null };
  const initial: CalendarProjectionState = { page: null, loading: false, error: "", fetchedAt: null, syncState: null, history: emptyHistory, recent: emptyHistory, applications: emptyApplications };
  let state = initial;
  let range: CalendarRangeSelection | null = null;
  let rangeId = 0, applicationId = 0;
  let rangeController: AbortController | null = null, applicationController: AbortController | null = null;
  let rangePending: Promise<void> | null = null;
  const pageIds = { history: 0, recent: 0 };
  const pageControllers: Record<"history" | "recent", AbortController | null> = { history: null, recent: null };
  const pagePending: Record<"history" | "recent", Promise<void> | null> = { history: null, recent: null };
  let syncKey: string | number | undefined;
  let initialized = false;
  const applicationCache = new Map<string, { day: AiApplicationDay | null; fetchedAt: number }>();
  const subscribers = new Set<() => void>();
  const publish = (next: CalendarProjectionState) => { state = next; subscribers.forEach((notify) => notify()); };
  const message = (error: unknown) => error instanceof Error ? error.message : "日历资料读取失败";

  function read<T>(url: string, signal: AbortSignal, onProgress?: (page: T) => void): Promise<T> {
    return readReadModelJSON<T>(url, signal, fetcher, onProgress, options);
  }

  function clearDetails() {
    applicationId++;
    applicationController?.abort();
    for (const kind of ["history", "recent"] as const) { pageIds[kind]++; pageControllers[kind]?.abort(); pagePending[kind] = null; }
    applicationCache.clear();
  }

  function requestRange(): Promise<void> {
    if (!range) return Promise.resolve();
    const id = ++rangeId;
    rangeController?.abort();
    const controller = rangeController = new AbortController();
    const params = new URLSearchParams(range);
    publish({ ...state, loading: true, error: "" });
    const accept = (page: CalendarRangePage) => {
      if (id !== rangeId || controller.signal.aborted) return;
      if (!page || typeof page.revision !== "string" || !page.snapshot || !Array.isArray(page.applicationDays)) throw new Error("日历目录格式无效");
      const changed = state.page?.revision !== page.revision;
      if (changed) clearDetails();
      publish({ ...state, page, loading: false, error: "", fetchedAt: Date.now(), syncState: readModelSyncState(page), ...(changed ? { history: emptyHistory, recent: emptyHistory, applications: emptyApplications } : {}) });
    };
    const request = (async () => {
      try {
        accept(await read<CalendarRangePage>(`/api/read-model/calendar/range?${params}`, controller.signal, accept));
      } catch (error) {
        if (id !== rangeId || controller.signal.aborted) return;
        publish({ ...state, loading: false, error: message(error) });
      }
    })().finally(() => { if (id === rangeId) rangePending = null; });
    rangePending = request;
    return request;
  }

  function onRangeChange(next: CalendarRangeSelection) {
    if (range && range.from === next.from && range.to === next.to && range.month === next.month) return rangePending ?? Promise.resolve();
    range = next;
    return requestRange();
  }

  function loadEventPage(kind: "history" | "recent"): Promise<void> {
    if (pagePending[kind]) return pagePending[kind];
    const revision = state.page?.revision;
    const previous = state[kind];
    if (!revision || previous.loaded && previous.nextOffset === null) return Promise.resolve();
    const offset = previous.loaded ? previous.nextOffset ?? 0 : 0;
    const id = ++pageIds[kind];
    pageControllers[kind]?.abort();
    const controller = pageControllers[kind] = new AbortController();
    publish({ ...state, [kind]: { ...previous, loading: true, error: "" } });
    const request = (async () => {
      try {
        const page = await read<CalendarHistoryPage>(`/api/read-model/calendar/history?${new URLSearchParams({ revision, offset: String(offset), scope: kind === "recent" ? "recent" : "historical" })}`, controller.signal);
        if (id !== pageIds[kind] || controller.signal.aborted) return;
        if (page.revision !== revision || state.page?.revision !== revision) throw new Error("资料版本已更新，请重新读取日历。");
        const events = [...new Map([...previous.events, ...page.events].map((entry) => [entry.event.id, entry])).values()];
        publish({ ...state, [kind]: { loaded: true, loading: false, error: "", total: page.total, nextOffset: page.nextOffset, events } });
      } catch (error) {
        if (id !== pageIds[kind] || controller.signal.aborted) return;
        publish({ ...state, [kind]: { ...state[kind], loading: false, error: message(error) } });
      }
    })().finally(() => { if (id === pageIds[kind]) pagePending[kind] = null; });
    pagePending[kind] = request;
    return request;
  }

  function closeApplications() {
    applicationId++; applicationController?.abort();
    publish({ ...state, applications: emptyApplications });
  }

  async function loadApplications(date: string) {
    const revision = state.page?.revision;
    if (!revision) return;
    const id = ++applicationId;
    applicationController?.abort();
    const key = `${revision}:${date}`;
    const cached = applicationCache.get(key);
    if (cached) {
      publish({ ...state, applications: { date, ...cached, loading: false, error: "" } });
      return;
    }
    const controller = applicationController = new AbortController();
    publish({ ...state, applications: { date, day: null, loading: true, error: "", fetchedAt: null } });
    try {
      const page = await read<{ revision: string; day: AiApplicationDay | null }>(`/api/read-model/calendar/applications?${new URLSearchParams({ revision, date })}`, controller.signal);
      if (id !== applicationId || controller.signal.aborted) return;
      if (page.revision !== revision || state.page?.revision !== revision) throw new Error("资料版本已更新，请重新读取日历。");
      const fetchedAt = Date.now();
      applicationCache.set(key, { day: page.day, fetchedAt });
      publish({ ...state, applications: { date, day: page.day, loading: false, error: "", fetchedAt } });
    } catch (error) {
      if (id !== applicationId || controller.signal.aborted) return;
      publish({ ...state, applications: { date, day: null, loading: false, error: message(error), fetchedAt: null } });
    }
  }

  return {
    subscribe(notify: () => void) { subscribers.add(notify); return () => { subscribers.delete(notify); }; },
    getState: () => state,
    getServerState: () => initial,
    onRangeChange, loadApplications, closeApplications, loadHistory: () => loadEventPage("history"), loadRecent: () => loadEventPage("recent"),
    synchronize(fallback: CalendarRangeSelection, key?: string | number) {
      if (!range) range = fallback;
      const changed = initialized && syncKey !== key;
      initialized = true; syncKey = key;
      return changed ? requestRange() : rangePending ?? (!state.page ? requestRange() : Promise.resolve());
    },
    refresh: requestRange,
    suspend() {
      rangeId++; applicationId++; rangeController?.abort(); applicationController?.abort(); rangePending = null;
      for (const kind of ["history", "recent"] as const) { pageIds[kind]++; pageControllers[kind]?.abort(); pagePending[kind] = null; }
      if (state.loading || state.history.loading || state.recent.loading || state.applications.loading) publish({ ...state, loading: false, history: { ...state.history, loading: false }, recent: { ...state.recent, loading: false }, applications: { ...state.applications, loading: false } });
    },
    dispose() { rangeId++; rangeController?.abort(); clearDetails(); rangePending = null; },
  };
}
