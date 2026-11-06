"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { calendarModelFromSnapshot } from "@/lib/calendar-snapshot";
import { useInitialUrlSearch } from "./use-url-state";
import { calendarInitialRange, createCalendarProjectionResource, type CalendarInitialPin } from "./calendar-projection-resource";

const FRESHNESS_INTERVAL_MS = 30_000;

export function useCalendarProjection(today: string, enabled: boolean, invalidateKey?: string | number, initialPin?: CalendarInitialPin) {
  const search = useInitialUrlSearch();
  const [resource] = useState(() => createCalendarProjectionResource(fetch, {}, initialPin));
  const state = useSyncExternalStore(resource.subscribe, resource.getState, resource.getServerState);
  const hasPage = Boolean(state.page);
  const lastFreshness = useRef(0);
  useEffect(() => { if (enabled) void resource.synchronize(calendarInitialRange(search, today), `${today}:${invalidateKey ?? ""}`); else resource.suspend(); }, [resource, enabled, today, search, invalidateKey]);
  useEffect(() => () => resource.dispose(), [resource]);
  useEffect(() => {
    if (!enabled || !hasPage) return;
    let timer = 0;
    let pending = false;
    let stopped = false;
    const schedule = () => {
      window.clearTimeout(timer);
      if (stopped || pending || document.visibilityState !== "visible") return;
      const delay = Math.max(0, FRESHNESS_INTERVAL_MS - (Date.now() - lastFreshness.current));
      timer = window.setTimeout(() => {
        pending = true;
        lastFreshness.current = Date.now();
        void resource.checkFreshness().finally(() => {
          pending = false;
          lastFreshness.current = Date.now();
          schedule();
        });
      }, delay);
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") resource.suspendFreshness();
      schedule();
    };
    schedule();
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", onVisibility);
      resource.suspendFreshness();
    };
  }, [enabled, hasPage, resource]);
  const model = useMemo(() => {
    if (!state.page) return null;
    const { snapshot, today } = state.page;
    const events = [...new Map([...snapshot.events, ...state.history.events, ...state.recent.events].map((entry) => [entry.event.id, entry])).values()];
    return calendarModelFromSnapshot({ ...snapshot, events }, today);
  }, [state.page, state.history.events, state.recent.events]);
  return {
    model, summary: state.page?.summary ?? null, applicationDays: state.page?.applicationDays ?? [], revision: state.page?.revision, today: state.page?.today,
    loading: enabled && (state.loading || !state.page && !state.error), error: state.error, fetchedAt: state.fetchedAt, syncState: state.syncState,
    refresh: resource.refresh, onRangeChange: resource.onRangeChange, loadApplications: resource.loadApplications, closeApplications: resource.closeApplications,
    applications: state.applications, loadHistory: resource.loadHistory,
    history: { ...state.history, eventIds: new Set(state.history.events.map((entry) => entry.event.id)) },
    loadRecent: resource.loadRecent, recent: { ...state.recent, eventIds: new Set(state.recent.events.map((entry) => entry.event.id)) },
  };
}

export type CalendarProjection = ReturnType<typeof useCalendarProjection>;
