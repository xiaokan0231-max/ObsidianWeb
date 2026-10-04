"use client";

import "./styles/language-quick.css";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LanguageTrainingStage, LanguageV2State } from "@/lib/language/types";
import type { QuickAnswerResult, QuickSet, QuickSettings, QuickSummary } from "@/lib/language/quick-types";
import {
  createQuickSession,
  quickSessionReducer,
  summarizeQuickSet,
  type QuickSessionAction,
  type QuickSessionState,
} from "@/lib/language/quick-session";
import { QuickDrill } from "./language-quick-drill";
import { QuickOverview, type QuickTab } from "./language-quick-overview";
import { QuickSetSummary } from "./language-quick-summary";
import {
  createQuickAnswerQueue,
  IDLE_SAVE_STATUS,
  QUICK_ENDPOINTS,
  quickApi,
  quickFreshLeft,
  useQuickCopy,
  useQuickSettings,
  type QuickAnswerQueue,
  type QuickSaveStatus,
} from "./language-quick-sync";

// 节奏带与小结由各自模块实现；从这里再导出，测试与外壳只认这一个入口。
export { TrainingPulse } from "./language-quick-overview";
export { QuickSetSummary } from "./language-quick-summary";

/*
 * 日语训练外壳：总览 → 练习 → 小结。
 *
 * 旧的「集中训练」三阶段（200 项扫描 → 输入 → 压力测试）已从界面移除，批次记录与旧路由保留，
 * 界面也不再读 state.currentBatch。快练只用三条轻量接口；完整课程状态只有洞察标签需要，第一次点开才取。
 * 作答进内存队列逐题保存，组间不刷新外壳的笔记（快练日志不在训练 scope 里），只有重建课程后才通知外壳。
 */

/** GET quick/set：`{ ready, set, summary }`；无课程时只有 `{ ready: false }`。也兼容把组字段直接摊在顶层的应答。 */
type QuickSetResponse = Partial<QuickSet> & { ready?: boolean; set?: Partial<QuickSet>; summary?: QuickSummary };

const STAGES: readonly LanguageTrainingStage[] = ["unseen", "recognized", "correctable", "retrievable", "transferable", "stable"];

const EMPTY_SUMMARY: QuickSummary = {
  ready: false,
  stale: false,
  day: "",
  due: 0,
  lapsedToday: 0,
  newAvailable: 0,
  newToday: 0,
  dailyNewLimit: 0,
  answeredToday: 0,
  firstPassToday: 0,
  seedRemaining: { unknown: 0, uncertain: 0 },
  stageCounts: Object.fromEntries(STAGES.map((stage) => [stage, 0])) as Record<LanguageTrainingStage, number>,
  drillable: 0,
  excludedJaMeaning: 0,
  notebookParsed: 0,
  history: [],
  topIssues: [],
};

/** 无课程时服务端只回 `{ ready: false }`；补齐缺省字段，界面不必处处判空。 */
function normalizeSummary(body: unknown): QuickSummary | null {
  if (!body || typeof body !== "object") return null;
  const wrapped = (body as { summary?: unknown }).summary;
  const raw = (wrapped && typeof wrapped === "object" ? wrapped : body) as Partial<QuickSummary>;
  return {
    ...EMPTY_SUMMARY,
    ...raw,
    seedRemaining: { ...EMPTY_SUMMARY.seedRemaining, ...raw.seedRemaining },
    stageCounts: { ...EMPTY_SUMMARY.stageCounts, ...raw.stageCounts },
    history: raw.history ?? [],
    topIssues: raw.topIssues ?? [],
  };
}

const EMPTY_SESSION = createQuickSession({ setId: "", day: "", size: 20, cards: [] });

/**
 * eventId 前缀：setId 加一段本次会话的随机串。服务端按 eventId 去重，
 * 同一 setId 的组若被重新取到（GET set 无副作用、可能返回同一 setId），序号不能撞上上次的作答。
 */
function eventIdBase(setId: string) {
  const safe = setId.replace(/[^A-Za-z0-9._:-]/gu, "_").replace(/^[^A-Za-z0-9]+/u, "").slice(0, 80) || "set";
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${safe}.${nonce}`;
}

/** 服务端判分与本地不一致时以服务端为准：小结的正确率与错题都按应答改写。 */
function withServerPassed(session: QuickSessionState, results: ReadonlyMap<string, QuickAnswerResult>): QuickSessionState {
  let changed = false;
  const records = session.records.map((record) => {
    const result = results.get(record.input.eventId);
    if (!result || result.status === "stale" || result.passed === undefined) return record;
    if (record.grading !== "auto" || record.action !== "answer" || record.passed === result.passed) return record;
    changed = true;
    return { ...record, passed: result.passed };
  });
  return changed ? { ...session, records } : session;
}

function errorText(error: unknown, fallback: string, timeout: string) {
  if (error instanceof Error && error.name === "TimeoutError") return timeout;
  return error instanceof Error ? error.message : fallback;
}

/** 汇总按当前设置算（每日新题额度＝2×组大小、打字题开关影响可出题数）。 */
async function fetchSummary(settings: QuickSettings) {
  const params = new URLSearchParams({ size: String(settings.size), typing: settings.typing ? "1" : "0" });
  return normalizeSummary(await quickApi<unknown>(`${QUICK_ENDPOINTS.summary}?${params}`, { method: "GET" }));
}

/** 每次取组带一个随机串：同一状态下重复取到的组也有不同 setId，历史与 eventId 都不会串组。 */
function setNonce() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/gu, "").slice(0, 16)
    : Math.random().toString(36).slice(2, 14);
}

function JapaneseTraining({
  onVaultChanged,
}: {
  onVaultChanged: () => Promise<void>;
}) {
  const { t } = useQuickCopy();
  const [settings, updateSettings] = useQuickSettings();
  const [summary, setSummary] = useState<QuickSummary | null>(null);
  // 作答之后 summary 就过期了；队列清空后再取一次，小结里的「今天还剩」才可信。
  // 用计数而不是布尔：补取在途时又有新作答，晚到的旧结果不能把「已是最新」标回去。
  const [answerTick, setAnswerTick] = useState(0);
  const [freshTick, setFreshTick] = useState(0);
  const summaryFresh = freshTick === answerTick;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exhausted, setExhausted] = useState(false);
  const [view, setView] = useState<"overview" | "drill">("overview");
  const [session, setSession] = useState<QuickSessionState>(EMPTY_SESSION);
  const [results, setResults] = useState<ReadonlyMap<string, QuickAnswerResult>>(() => new Map());
  const [saveStatus, setSaveStatus] = useState<QuickSaveStatus>(IDLE_SAVE_STATUS);
  const [tab, setTab] = useState<QuickTab>("today");
  const [fullState, setFullState] = useState<LanguageV2State | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [stateError, setStateError] = useState("");

  const sessionRef = useRef<QuickSessionState>(EMPTY_SESSION);
  const queueRef = useRef<QuickAnswerQueue | null>(null);
  const idBase = useRef("set");
  const idSeq = useRef(0);
  const refreshing = useRef(false);

  // 答案队列跟外壳同寿：练习屏 → 小结 → 下一组之间不中断，晚到的应答也能补进小结。
  useEffect(() => {
    const queue = createQuickAnswerQueue({
      onStatus: setSaveStatus,
      onResults: (list, next) => {
        if (list.length) {
          setResults((current) => {
            const map = new Map(current);
            for (const result of list) map.set(result.eventId, result);
            return map;
          });
        }
        if (next) setSummary(normalizeSummary(next));
      },
    });
    queueRef.current = queue;
    const leave = () => queue.flushKeepalive();
    const retry = () => queue.retryNow();
    const visible = () => {
      if (document.visibilityState === "visible") queue.retryNow();
    };
    window.addEventListener("beforeunload", leave);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", visible);
      // 应用内切到别的视图时组件直接卸载，beforeunload 不会触发；这里补发最后一批。
      queue.flushKeepalive();
      queue.dispose();
      queueRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // 用计时器而不是 requestAnimationFrame：后台标签页不出帧，rAF 回调要等切回来才跑，
    // 总览会一直停在「—」（外壳的首次加载也是同样的理由，见 memory-atlas 的 loadVault）。
    const timer = window.setTimeout(() => {
      fetchSummary(settings).then(
        (value) => {
          if (!cancelled) setSummary(value);
        },
        (loadError: unknown) => {
          if (!cancelled) setError(errorText(loadError, t("无法读取快练"), t("读取超时")));
        },
      ).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  // 挂载时取一次；本机设置读出来（或改了组大小、打字题）之后按新设置重取，额度与可出题数才对得上。
  // t 每次渲染都是新函数，不能作依赖。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // 队列清空、且不在答题中时补取一次汇总；只在回调里改状态，取数本身是外部同步。
  // 答题中每题的保存应答已带回 summary，不必每题再多读一次全库。
  const drilling = view === "drill" && session.phase !== "ended";
  useEffect(() => {
    if (summaryFresh || drilling || saveStatus.pending > 0 || refreshing.current) return;
    refreshing.current = true;
    const tick = answerTick;
    fetchSummary(settings).then(
      (value) => {
        refreshing.current = false;
        if (value) setSummary(value);
        setFreshTick(tick);
      },
      () => {
        refreshing.current = false;
      },
    );
  }, [summaryFresh, drilling, saveStatus.pending, settings, answerTick, freshTick]);

  const retryLoad = () => {
    setLoading(true);
    setError("");
    fetchSummary(settings).then(setSummary, (loadError: unknown) => setError(errorText(loadError, t("无法读取快练"), t("读取超时"))))
      .finally(() => setLoading(false));
  };

  /**
   * reducer 在处理函数里同步算出下一状态：新增的作答马上进队列（不用 effect 去比对），
   * 连按两键时第二下也基于第一下之后的状态，不会读到旧闭包。
   */
  const onAction = useCallback((action: QuickSessionAction) => {
    const before = sessionRef.current;
    let next: QuickSessionState;
    if (action.type === "answer" || action.type === "gaveUp" || action.type === "suspend") {
      idSeq.current += 1;
      next = quickSessionReducer(before, { ...action, eventId: `${idBase.current}.${idSeq.current}` });
    } else {
      next = quickSessionReducer(before, action);
    }
    if (next === before) return;
    sessionRef.current = next;
    setSession(next);
    const fresh = next.records.slice(before.records.length);
    if (fresh.length) {
      queueRef.current?.enqueue(next.setId, fresh.map((record) => record.input), next.size);
      setAnswerTick((value) => value + 1);
    }
  }, []);

  const startSet = async (extra = false) => {
    if (busy) return;
    setBusy(t("正在取题"));
    setError("");
    setNotice("");
    try {
      // 上一组还没落盘完就取下一组，服务端会把刚答过的题再出一遍；最多等 4 秒，失败退避时不等。
      await queueRef.current?.drained(4_000);
      const params = new URLSearchParams({
        size: String(settings.size),
        typing: settings.typing ? "1" : "0",
        extra: extra ? "1" : "0",
        nonce: setNonce(),
      });
      const response = await quickApi<QuickSetResponse>(`${QUICK_ENDPOINTS.set}?${params}`, { method: "GET" });
      if (response.summary) setSummary(normalizeSummary(response.summary));
      const body = response.set ?? response;
      if (response.ready === false) {
        setSummary((current) => ({ ...(current ?? EMPTY_SUMMARY), ready: false }));
        setView("overview");
        return;
      }
      const cards = body.cards ?? [];
      const newExhausted = Boolean(body.limits?.newExhausted);
      setExhausted(newExhausted);
      if (!cards.length || !body.setId) {
        setNotice(newExhausted ? t("今天新题额度已用完，可再加") : t("今天没有可出的题"));
        setView("overview");
        return;
      }
      const next = createQuickSession({ setId: body.setId, day: body.day ?? "", size: body.size ?? settings.size, cards });
      idBase.current = eventIdBase(body.setId);
      idSeq.current = 0;
      sessionRef.current = next;
      setSession(next);
      setResults(new Map());
      setView("drill");
    } catch (startError) {
      setError(errorText(startError, t("无法读取快练"), t("读取超时")));
      setView("overview");
    } finally {
      setBusy("");
    }
  };

  const loadFullState = () => {
    setStateLoading(true);
    setStateError("");
    // 完整状态在服务端要回放全部课程与日志，首次可能要十几秒；比通用的 20 秒放宽一些。
    quickApi<LanguageV2State>(QUICK_ENDPOINTS.state, { method: "GET", signal: AbortSignal.timeout(45_000) })
      .then(setFullState, (loadError: unknown) => setStateError(errorText(loadError, t("无法读取快练"), t("读取超时"))))
      .finally(() => setStateLoading(false));
  };

  const openTab = (next: QuickTab) => {
    setTab(next);
    if (next !== "today" && !fullState && !stateLoading) loadFullState();
  };

  const rebuild = async () => {
    if (busy) return;
    setBusy(t("正在重建面试证据课程"));
    setError("");
    setNotice("");
    try {
      const result = await quickApi<{ state: LanguageV2State; path: string; unchanged?: boolean }>(
        QUICK_ENDPOINTS.rebuild,
        { method: "POST", body: "{}", signal: AbortSignal.timeout(120_000) },
      );
      setFullState(result.state);
      setNotice(t(result.unchanged ? "训练课程已是最新 {path}" : "训练课程已写入 {path}", { path: result.path }));
      setSummary(await fetchSummary(settings));
      // 重建写了新的课程生成物，外壳的笔记要跟着刷新；内容未变时服务端什么都没写，作答与组间也都不调用。
      if (!result.unchanged) await onVaultChanged();
    } catch (rebuildError) {
      setError(errorText(rebuildError, t("无法读取快练"), t("读取超时")));
    } finally {
      setBusy("");
    }
  };

  const ended = view === "drill" && session.phase === "ended";
  const setSummaryData = useMemo(
    () => ended ? summarizeQuickSet(withServerPassed(session, results), [...results.values()]) : null,
    [ended, session, results],
  );

  if (view === "drill" && !ended) {
    return <QuickDrill session={session} saveStatus={saveStatus} results={results} onAction={onAction} />;
  }

  if (setSummaryData) {
    return (
      <QuickSetSummary
        summary={setSummaryData}
        remaining={summary && summaryFresh && saveStatus.pending === 0 ? { due: summary.due, fresh: quickFreshLeft(summary) } : null}
        busy={Boolean(busy)}
        onAgain={() => void startSet(false)}
        onLeave={() => setView("overview")}
      />
    );
  }

  return (
    <QuickOverview
      summary={summary}
      loading={loading}
      error={error}
      notice={notice}
      busy={busy}
      settings={settings}
      exhausted={exhausted}
      tab={tab}
      fullState={fullState}
      stateLoading={stateLoading}
      stateError={stateError}
      onSettings={updateSettings}
      onStart={(extra) => void startSet(extra)}
      onRebuild={() => void rebuild()}
      onRetry={retryLoad}
      onTab={openTab}
    />
  );
}

// 外壳的 UI state（⌘K・overlay）变化时不重渲染整个视图。props 都是稳定引用。
export default memo(JapaneseTraining);
