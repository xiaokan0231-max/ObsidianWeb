"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CalendarSnapshot } from "@/lib/calendar-snapshot";

type State = { snapshot: CalendarSnapshot | null; loading: boolean; error: string; fetchedAt: number | null };

export function useCalendarSnapshot(enabled: boolean) {
  const [state, setState] = useState<State>({ snapshot: null, loading: false, error: "", fetchedAt: null });
  const cached = useRef<{ snapshot: CalendarSnapshot; etag: string | null } | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const refresh = useCallback((): Promise<void> => {
    if (pending.current) return pending.current;
    setState((previous) => ({ ...previous, loading: true, error: "" }));
    const request = (async () => {
      try {
        const etag = cached.current?.etag;
        const response = await fetch("/api/calendar", {
          headers: etag ? { "If-None-Match": etag } : {}, signal: AbortSignal.timeout(20_000),
        });
        if (response.status === 304 && cached.current) {
          setState({ snapshot: cached.current.snapshot, loading: false, error: "", fetchedAt: Date.now() });
          return;
        }
        const body = await response.json() as { connected?: boolean; calendar?: CalendarSnapshot; error?: string };
        if (!response.ok || !body.connected || body.calendar?.schemaVersion !== 1 || !Array.isArray(body.calendar.events)
          || !Array.isArray(body.calendar.applicationNotes)) throw new Error(body.error || "日历读取失败");
        cached.current = { snapshot: body.calendar, etag: response.headers.get("ETag") };
        setState({ snapshot: body.calendar, loading: false, error: "", fetchedAt: Date.now() });
      } catch (error) {
        setState((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : "日历读取失败" }));
      }
    })().finally(() => { pending.current = null; });
    pending.current = request;
    return request;
  }, []);
  useEffect(() => { if (enabled) void refresh(); }, [enabled, refresh]);
  return { ...state, refresh };
}
