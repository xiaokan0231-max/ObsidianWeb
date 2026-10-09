"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { postJson } from "@/lib/client-api";
import type { Note } from "@/lib/notes";
import type { InsightsState } from "./interview-insights-state";

export async function readInsightsState(signal?: AbortSignal): Promise<InsightsState> {
  const response = await fetch("/api/review/insights", { cache: "no-store", signal });
  const payload = await response.json() as InsightsState & { error?: string };
  if (!response.ok) throw new Error(payload.error || "横向分析读取失败");
  return payload as InsightsState;
}

// 同一页面的单场生成、反馈刷新和自动同步共用一个请求，避免重复启动后台任务。
let currentStep: Promise<InsightsState> | null = null;
function syncStep(force: boolean): Promise<InsightsState> {
  if (!currentStep) {
    currentStep = postJson<InsightsState & { ok?: boolean; error?: string }>(
      "/api/review/insights", { refreshSources: true, ...(force ? { force: true } : {}) },
      { timeoutMs: 600_000 },
    ).finally(() => { currentStep = null; });
  }
  return currentStep;
}

export function useInterviewAdvisorySync(notes: Note[]) {
  const [state, setState] = useState<InsightsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [replay, setReplay] = useState(0);
  const mounted = useRef(false);
  const running = useRef(false);
  const queued = useRef(false);
  const queuedForce = useRef(false);
  // 企业、本人事实和后续结果同样会改变判断；是否需要重算由服务端指纹决定。
  // 全库几千篇时这串要拼、要排序：只在 notes 换了引用时算一次，复盘页里敲字、展开不再重算。
  const signature = useMemo(() => notes.map((note) => `${note.path}:${note.stat.mtime}`).sort().join("|"), [notes]);

  const synchronize = useCallback(async (force = false): Promise<void> => {
    if (running.current) { queued.current = true; queuedForce.current ||= force; return; }
    running.current = true;
    setError("");
    try {
      let next = await readInsightsState();
      if (!mounted.current) return;
      setState(next);
      setRevision((value) => value + 1);
      if (next.active) return;
      if (!force && (next.error || (!next.pending && next.insightsStatus === "ready"))) return;
      setBusy(true);
      // 服务端每次只更新一场；最后一次统一生成横向分析，所有中间进度都可回读。
      do {
        next = await syncStep(force);
        force = false;
        if (!mounted.current) return;
        setState(next);
        setRevision((value) => value + 1);
      } while (next.done === false && !next.error);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "分析更新失败");
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
      // 生成中新增的本人批注不能被在途请求吞掉；只重放真实的新事件。
      if (queued.current && mounted.current) {
        queued.current = false;
        setReplay((value) => value + 1);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => {
      const force = queuedForce.current;
      queuedForce.current = false;
      void synchronize(force);
    }, 0);
    return () => { mounted.current = false; window.clearTimeout(timer); };
  }, [signature, synchronize, replay]);

  useEffect(() => {
    if (!state?.active || busy) return;
    const timer = window.setTimeout(() => { void synchronize(); }, 4_000);
    return () => window.clearTimeout(timer);
  }, [state, busy, synchronize]);

  return { state, busy, error, revision, synchronize };
}
