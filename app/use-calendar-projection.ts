"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { calendarModelFromSnapshot, type CalendarSnapshot } from "@/lib/calendar-snapshot";
import { useInitialUrlSearch } from "./use-url-state";
import { calendarInitialRange, createCalendarProjectionResource } from "./calendar-projection-resource";

const EMPTY_SNAPSHOT: CalendarSnapshot = { schemaVersion: 1, events: [], applicationNotes: [], selectionCount: 0 };

export function useCalendarProjection(today: string, enabled: boolean, invalidateKey?: string | number) {
  const search = useInitialUrlSearch();
  const [resource] = useState(createCalendarProjectionResource);
  const state = useSyncExternalStore(resource.subscribe, resource.getState, resource.getServerState);
  useEffect(() => { if (enabled) void resource.synchronize(calendarInitialRange(search, today), `${today}:${invalidateKey ?? ""}`); else resource.suspend(); }, [resource, enabled, today, search, invalidateKey]);
  useEffect(() => () => resource.dispose(), [resource]);
  const model = useMemo(() => {
    const snapshot = state.page?.snapshot ?? EMPTY_SNAPSHOT;
    const events = [...new Map([...snapshot.events, ...state.history.events, ...state.recent.events].map((entry) => [entry.event.id, entry])).values()];
    return calendarModelFromSnapshot({ ...snapshot, events }, today);
  }, [state.page, state.history.events, state.recent.events, today]);
  return {
    model, summary: state.page?.summary ?? null, applicationDays: state.page?.applicationDays ?? [], revision: state.page?.revision,
    loading: enabled && (state.loading || !state.page && !state.error), error: state.error, fetchedAt: state.fetchedAt, syncState: state.syncState,
    refresh: resource.refresh, onRangeChange: resource.onRangeChange, loadApplications: resource.loadApplications, closeApplications: resource.closeApplications,
    applications: state.applications, loadHistory: resource.loadHistory,
    history: { ...state.history, eventIds: new Set(state.history.events.map((entry) => entry.event.id)) },
    loadRecent: resource.loadRecent, recent: { ...state.recent, eventIds: new Set(state.recent.events.map((entry) => entry.event.id)) },
  };
}

export type CalendarProjection = ReturnType<typeof useCalendarProjection>;
