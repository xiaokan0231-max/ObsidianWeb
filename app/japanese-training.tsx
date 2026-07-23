"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LanguageBatch,
  LanguageBatchAction,
  LanguageBatchPhase,
  LanguageItemProgress,
  LanguageLearningItem,
  LanguageLearningItemKind,
  LanguageScanJudgment,
  LanguageTrainingStage,
  LanguageV2State,
} from "@/lib/language/types";

const EMPTY_STATE: LanguageV2State = {
  ready: false,
  stale: false,
  progress: [],
  history: [],
};

const KIND_LABELS: Record<LanguageLearningItemKind, string> = {
  active_chunk: "主动词块",
  error_patch: "错误修正",
  interviewer_phrase: "面试官表达",
  answer_strategy: "回答结构",
  technical_term: "岗位技术",
  fact_anchor: "事实口径",
};

const STAGE_LABELS: Record<LanguageTrainingStage, string> = {
  unseen: "未见过",
  recognized: "能识别",
  correctable: "能修正",
  retrievable: "能主动提取",
  transferable: "能迁移使用",
  stable: "训练稳定",
};

const JUDGMENT_LABELS: Record<LanguageScanJudgment, string> = {
  known: "已会",
  uncertain: "犹豫",
  unknown: "不会",
  reject: "排除",
};

const AUTO_SAVE_ACTION_COUNT = 50;

type ApiError = { error?: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const body = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}

export default function JapaneseTraining({
  onVaultChanged,
}: {
  onVaultChanged: () => Promise<void>;
  focusDojoItemId?: string | null;
  onClearFocus?: () => void;
}) {
  const [state, setState] = useState<LanguageV2State>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"today" | "profile" | "issues" | "library">("today");
  const [size, setSize] = useState<100 | 150 | 200>(200);
  const [showBatch, setShowBatch] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await api<LanguageV2State>("/api/language/v2/state"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法读取集中训练状态");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const act = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${label}失败`);
    } finally {
      setBusy("");
    }
  };

  const rebuild = () => act("正在重建面试证据课程", async () => {
    const result = await api<{ state: LanguageV2State; path: string }>(
      "/api/language/v2/rebuild",
      { method: "POST", body: "{}" },
    );
    setState(result.state);
    setNotice(`训练课程已写入 ${result.path}`);
    await onVaultChanged();
  });

  const start = () => act("正在编排一小时训练", async () => {
    const result = await api<{ state: LanguageV2State; batch: LanguageBatch }>(
      "/api/language/v2/batch/start",
      { method: "POST", body: JSON.stringify({ size }) },
    );
    setState(result.state);
    setShowBatch(true);
    await onVaultChanged();
  });

  const curriculum = state.curriculum;
  const progress = useMemo(
    () => new Map(state.progress.map((value) => [value.itemId, value])),
    [state.progress],
  );

  if (showBatch && state.currentBatch && curriculum) {
    return (
      <LanguageBatchWorkspace
        state={state}
        onState={setState}
        onExit={() => setShowBatch(false)}
        onVaultChanged={onVaultChanged}
      />
    );
  }

  return (
    <div className="focus-language-view">
      <header className="focus-language-hero">
        <div>
          <span className="eyebrow"><i /> INTERVIEW-EVIDENCE COMPILER</span>
          <h1>一小时，把面试日语<br />批量编译成主动能力。</h1>
          <p>{curriculum?.summaryZh || "从真实面试原话、本人裁定和回答复盘建立高吞吐训练课程。"}</p>
        </div>
        <div className="focus-language-build">
          <small>DAILY BUILD</small>
          <strong>{state.currentBatch ? "训练已自动保存" : `${size} 项 / 约 60 分钟`}</strong>
          <p>扫描建立索引，集中处理缓存未命中，最后做隐藏答案压力测试。</p>
          {state.currentBatch ? (
            <button onClick={() => setShowBatch(true)}>继续今天的批次</button>
          ) : (
            <button disabled={!state.ready || Boolean(busy)} onClick={() => void start()}>开始集中训练</button>
          )}
        </div>
      </header>

      {(error || notice || busy) && (
        <div className={`focus-language-message ${error ? "error" : busy ? "working" : "success"}`}>
          {error || (busy ? `${busy}…` : notice)}
        </div>
      )}

      {!state.ready && !loading ? (
        <section className="focus-language-empty">
          <b>語</b>
          <div>
            <small>FIRST INDEX</small>
            <h2>从已有面试复盘建立第一份课程</h2>
            <p>核心抽取不调用 Codex，不会用通用JLPT内容凑数量，也不会修改任何逐字稿或复盘事实。</p>
          </div>
          <button disabled={Boolean(busy)} onClick={() => void rebuild()}>建立集中训练课程</button>
        </section>
      ) : curriculum ? (
        <>
          {state.stale && (
            <section className="focus-language-stale">
              <div><strong>面试或岗位资料已经更新</strong><span>当前批次仍可继续；重建后，新证据才会进入下一批。</span></div>
              <button disabled={Boolean(busy)} onClick={() => void rebuild()}>更新训练画像</button>
            </section>
          )}

          <nav className="focus-language-tabs" aria-label="日语集中训练">
            {([
              ["today", "今日训练"],
              ["profile", "能力画像"],
              ["issues", "问题地图"],
              ["library", "训练语料"],
            ] as const).map(([key, label]) => (
              <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>
            ))}
          </nav>

          {tab === "today" && (
            <TodayDashboard
              state={state}
              size={size}
              onSize={setSize}
              onStart={() => void start()}
              onResume={() => setShowBatch(true)}
            />
          )}
          {tab === "profile" && <AbilityProfile state={state} />}
          {tab === "issues" && <IssueMap state={state} />}
          {tab === "library" && <LanguageLibrary items={curriculum.items} progress={progress} />}
        </>
      ) : loading ? <div className="focus-language-loading">正在读取训练课程…</div> : null}
    </div>
  );
}

function TodayDashboard({
  state,
  size,
  onSize,
  onStart,
  onResume,
}: {
  state: LanguageV2State;
  size: 100 | 150 | 200;
  onSize: (size: 100 | 150 | 200) => void;
  onStart: () => void;
  onResume: () => void;
}) {
  const stageCounts = Object.fromEntries(
    Object.keys(STAGE_LABELS).map((stage) => [stage, state.progress.filter((item) => item.stage === stage).length]),
  ) as Record<LanguageTrainingStage, number>;
  const recent = state.history.slice(0, 5);
  return (
    <div className="focus-language-dashboard">
      <section className="focus-language-metrics">
        <div><strong>{state.curriculum?.items.length ?? 0}</strong><span>证据项目</span></div>
        <div><strong>{stageCounts.unseen}</strong><span>尚未扫描</span></div>
        <div><strong>{stageCounts.retrievable + stageCounts.transferable}</strong><span>可主动提取</span></div>
        <div><strong>{stageCounts.stable}</strong><span>训练稳定</span></div>
      </section>
      <section className="focus-language-launcher">
        <div>
          <small>ONE-HOUR DEEP WORK</small>
          <h2>{state.currentBatch ? "继续未完成批次" : "生成今天的批处理任务"}</h2>
          <p>默认200项。规模只改变扫描量；集中编译最多60项，压力测试最多40项。</p>
        </div>
        {!state.currentBatch && (
          <div className="focus-language-size" role="group" aria-label="训练规模">
            {[100, 150, 200].map((value) => (
              <button key={value} className={size === value ? "active" : ""} onClick={() => onSize(value as 100 | 150 | 200)}>
                <strong>{value}</strong><span>{value === 100 ? "轻量" : value === 150 ? "标准" : "深度"}</span>
              </button>
            ))}
          </div>
        )}
        <button className="focus-language-primary" onClick={state.currentBatch ? onResume : onStart}>
          {state.currentBatch ? `继续 ${state.currentBatch.phase}` : `开始 ${size} 项训练`}
        </button>
      </section>
      <section className="focus-language-two-column">
        <div>
          <header><small>HOT PATH</small><h2>现在最值得修</h2></header>
          {state.curriculum?.profile.topIssues.slice(0, 8).map((issue, index) => (
            <article className="focus-issue-compact" key={issue.key}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <div><strong>{issue.label}</strong><span>{issue.interviewCount} 场 · {issue.occurrenceCount} 次证据</span></div>
            </article>
          ))}
        </div>
        <div>
          <header><small>BUILD HISTORY</small><h2>最近批次</h2></header>
          {recent.length ? recent.map((entry) => (
            <article className="focus-history-row" key={entry.id}>
              <time>{entry.date}</time><strong>{entry.completedCount} / {entry.targetSize}</strong>
              <span>{entry.completedAt ? "已完成" : "进行中"}</span>
            </article>
          )) : <p className="focus-language-muted">完成第一批后，这里会显示吞吐和成功记录。</p>}
        </div>
      </section>
    </div>
  );
}

function AbilityProfile({ state }: { state: LanguageV2State }) {
  const profile = state.curriculum!.profile;
  const stages = Object.keys(STAGE_LABELS) as LanguageTrainingStage[];
  return (
    <div className="focus-language-panel-page">
      <header><small>ABILITY PROFILE</small><h2>能力画像来自事实，不来自泛化判断</h2></header>
      <section className="focus-profile-summary">
        <div><strong>{profile.interviewCount}</strong><span>结构化面试</span></div>
        <div><strong>{profile.learnerErrorCount}</strong><span>已确认本人错误</span></div>
        <div><strong>{profile.reviewedBlockCount}</strong><span>回答复盘块</span></div>
        <div><strong>{profile.listeningGapCount}</strong><span>本人标记听解缺口</span></div>
      </section>
      {!profile.listeningGapCount && (
        <p className="focus-evidence-note">当前没有本人标记的“△推测／×没听懂”，因此系统只训练面试官表达识别，不把它描述成听力缺陷。</p>
      )}
      <section className="focus-stage-grid">
        {stages.map((stage) => (
          <article key={stage}>
            <strong>{state.progress.filter((value) => value.stage === stage).length}</strong>
            <span>{STAGE_LABELS[stage]}</span>
            <small>{stage === "recognized" ? "自报已会最多到这里" : stage === "stable" ? "跨3日且不少于7天" : "由实际训练结果推进"}</small>
          </article>
        ))}
      </section>
      {!!profile.staleReviewPaths.length && (
        <section className="focus-review-warning"><strong>以下深度复盘晚于本人反馈，需要先重建：</strong>{profile.staleReviewPaths.map((path) => <code key={path}>{path}</code>)}</section>
      )}
    </div>
  );
}

function IssueMap({ state }: { state: LanguageV2State }) {
  const items = new Map(state.curriculum!.items.map((value) => [value.id, value]));
  return (
    <div className="focus-language-panel-page">
      <header><small>ISSUE MAP</small><h2>跨面试复发模式</h2><p>父模式用于排序；展开后仍能回到具体 sNN/qNN 证据。</p></header>
      <div className="focus-issue-map">
        {state.curriculum!.profile.topIssues.map((issue) => (
          <details key={issue.key}>
            <summary>
              <span>{KIND_LABELS[issue.kind]}</span><strong>{issue.label}</strong>
              <b>{issue.interviewCount} 场 / {issue.occurrenceCount} 次</b>
            </summary>
            <div>
              {issue.itemIds.slice(0, 12).map((id) => {
                const value = items.get(id);
                return value ? (
                  <article key={id}>
                    <code>{value.originalJa || value.titleZh}</code>
                    <span>→</span><strong lang="ja">{value.targetJa}</strong>
                    <small>{value.evidence.map((entry) => `${entry.sentenceId || entry.blockId || "来源"} · ${entry.path}`).join(" / ")}</small>
                  </article>
                ) : null;
              })}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function LanguageLibrary({
  items,
  progress,
}: {
  items: LanguageLearningItem[];
  progress: Map<string, LanguageItemProgress>;
}) {
  const [kind, setKind] = useState<LanguageLearningItemKind | "all">("all");
  const visible = items.filter((value) => kind === "all" || value.kind === kind);
  return (
    <div className="focus-language-panel-page">
      <header><small>TRAINING CORPUS</small><h2>个人词汇、语法和面试表达</h2></header>
      <div className="focus-library-filters">
        <button className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>全部 {items.length}</button>
        {(Object.keys(KIND_LABELS) as LanguageLearningItemKind[]).map((key) => (
          <button key={key} className={kind === key ? "active" : ""} onClick={() => setKind(key)}>{KIND_LABELS[key]} {items.filter((value) => value.kind === key).length}</button>
        ))}
      </div>
      <div className="focus-language-table">
        <div className="head"><span>类型</span><span>日语</span><span>中文功能</span><span>状态</span></div>
        {visible.map((value) => (
          <article key={value.id}>
            <small>{KIND_LABELS[value.kind]}</small>
            <div><strong lang="ja">{value.targetJa}</strong>{value.reading && <span lang="ja">{value.reading}</span>}</div>
            <p>{value.meaningZh}</p>
            <b>{STAGE_LABELS[progress.get(value.id)?.stage ?? "unseen"]}</b>
          </article>
        ))}
      </div>
    </div>
  );
}

function LanguageBatchWorkspace({
  state,
  onState,
  onExit,
  onVaultChanged,
}: {
  state: LanguageV2State;
  onState: (state: LanguageV2State) => void;
  onExit: () => void;
  onVaultChanged: () => Promise<void>;
}) {
  const batch = state.currentBatch!;
  const itemById = useMemo(
    () => new Map(state.curriculum!.items.map((value) => [value.id, value])),
    [state.curriculum],
  );
  const [pending, setPending] = useState<LanguageBatchAction[]>([]);
  const [cursor, setCursor] = useState(batch.cursor);
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(
    batch.actions.filter((action) => action.answer !== undefined).map((action) => [action.itemId, action.answer ?? ""]),
  ));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [showScanOverview, setShowScanOverview] = useState(false);
  const saveInFlight = useRef<Promise<void> | null>(null);

  const allActions = useMemo(() => {
    const map = new Map(batch.actions.map((value) => [value.actionId, value]));
    for (const value of pending) map.set(value.actionId, value);
    return [...map.values()];
  }, [batch.actions, pending]);

  const latestFor = useCallback((itemId: string, phase: string) =>
    allActions.filter((action) => action.itemId === itemId && action.phase === phase).at(-1),
  [allActions]);

  const actionFor = (itemId: string, phase: Exclude<LanguageBatchPhase, "completed">, values: Partial<LanguageBatchAction>) => {
    const previous = latestFor(itemId, phase);
    return {
      actionId: previous?.actionId || crypto.randomUUID(),
      itemId,
      phase,
      at: new Date().toISOString(),
      ...values,
    } satisfies LanguageBatchAction;
  };

  const queue = (action: LanguageBatchAction) => setPending((current) => [
    ...current.filter((value) => value.actionId !== action.actionId),
    action,
  ]);

  const checkpoint = useCallback(async (
    actions: LanguageBatchAction[],
    nextPhase?: LanguageBatchPhase,
    nextCursor = cursor,
    silent = false,
  ) => {
    if (saveInFlight.current) {
      if (silent) return;
      await saveInFlight.current;
    }
    if (!silent) setBusy(nextPhase ? "正在切换训练阶段" : "正在保存");
    setError("");
    const sentIds = new Set(actions.map((action) => action.actionId));
    const operation = (async () => {
      try {
        const result = await api<{ state: LanguageV2State }>(
          "/api/language/v2/batch/checkpoint",
          {
            method: "POST",
            body: JSON.stringify({ batchId: batch.id, actions, nextPhase, cursor: nextCursor }),
          },
        );
        onState(result.state);
        setPending((current) => current.filter((action) => !sentIds.has(action.actionId)));
        setCursor(result.state.currentBatch?.cursor ?? 0);
        if (!silent) await onVaultChanged();
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : "自动保存失败");
      } finally {
        if (!silent) setBusy("");
      }
    })();
    saveInFlight.current = operation;
    try {
      await operation;
    } finally {
      if (saveInFlight.current === operation) saveInFlight.current = null;
    }
  }, [batch.id, cursor, onState, onVaultChanged]);

  useEffect(() => {
    if (pending.length < AUTO_SAVE_ACTION_COUNT || busy) return;
    const timer = window.setTimeout(() => void checkpoint(pending, undefined, cursor, true), 0);
    return () => window.clearTimeout(timer);
  }, [pending, busy, checkpoint, cursor]);

  useEffect(() => {
    const update = () => setElapsed(Math.max(0, Math.round((Date.now() - new Date(batch.createdAt).getTime()) / 60_000)));
    const timer = window.setInterval(update, 30_000);
    const first = window.setTimeout(update, 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [batch.createdAt]);

  useEffect(() => {
    const leave = () => {
      if (!pending.length) return;
      void fetch("/api/language/v2/batch/checkpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: batch.id, actions: pending, cursor }),
        keepalive: true,
      });
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [batch.id, cursor, pending]);

  const scanJudgments = new Map(
    allActions.filter((action) => action.phase === "scan" && action.judgment).map((action) => [action.itemId, action.judgment!]),
  );

  const markScan = useCallback((judgment: LanguageScanJudgment) => {
    const itemId = batch.scanItemIds[cursor];
    if (!itemId) return;
    queue(actionFor(itemId, "scan", { judgment }));
    const judgedAfterAction = new Map(scanJudgments).set(itemId, judgment);
    for (let offset = 1; offset <= batch.scanItemIds.length; offset += 1) {
      const next = (cursor + offset) % batch.scanItemIds.length;
      if (!judgedAfterAction.has(batch.scanItemIds[next])) {
        setCursor(next);
        return;
      }
    }
  // actionFor/queue use the latest render deliberately; keyboard is rebound when cursor/actions change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch.scanItemIds, cursor, scanJudgments]);

  useEffect(() => {
    if (batch.phase !== "scan") return;
    const keydown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement)?.matches("input,textarea,select,button")) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        setCursor((current) => Math.max(0, Math.min(batch.scanItemIds.length - 1, current + direction)));
        return;
      }
      const judgment = ({ "1": "known", "2": "uncertain", "3": "unknown", "4": "reject" } as const)[event.key];
      if (!judgment) return;
      event.preventDefault();
      markScan(judgment);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [batch.phase, batch.scanItemIds.length, markScan]);

  const saveAnswer = (itemId: string, phase: "compile" | "stress", answer: string) => {
    setAnswers((current) => ({ ...current, [itemId]: answer }));
    queue(actionFor(itemId, phase, { answer }));
  };

  const advance = async (phase: LanguageBatchPhase) => {
    if (batch.phase === "scan" && scanJudgments.size < batch.scanItemIds.length) {
      setError(`还有 ${batch.scanItemIds.length - scanJudgments.size} 项未扫描；可以先保存退出，稍后继续。`);
      return;
    }
    await checkpoint(pending, phase, 0);
  };

  const complete = async () => {
    setBusy("正在结算本轮训练");
    setError("");
    try {
      const result = await api<{ state: LanguageV2State }>(
        "/api/language/v2/batch/complete",
        { method: "POST", body: JSON.stringify({ batchId: batch.id, actions: pending }) },
      );
      onState(result.state);
      await onVaultChanged();
      onExit();
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "训练结算失败");
    } finally {
      setBusy("");
    }
  };

  const phaseItems = batch.phase === "scan" ? batch.scanItemIds : batch.phase === "compile" ? batch.compileItemIds : batch.stressItemIds;
  const currentScanItem = itemById.get(batch.scanItemIds[cursor]);
  const currentScanJudgment = currentScanItem ? scanJudgments.get(currentScanItem.id) : undefined;
  const scanComplete = scanJudgments.size === batch.scanItemIds.length;

  return (
    <div className="language-batch-workspace">
      <header className="language-batch-topbar">
        <div><span>語</span><div><small>DEEP WORK · AUTO SAVED</small><strong>{batch.targetSize} 项集中训练</strong></div></div>
        <div className="language-batch-clock"><strong>{elapsed}</strong><span>分钟</span></div>
        <div>
          <button disabled={Boolean(busy)} onClick={() => void checkpoint(pending)}>保存</button>
          <button className="quiet" disabled={Boolean(busy)} onClick={async () => { await checkpoint(pending); onExit(); }}>退出到总览</button>
        </div>
      </header>
      <div className="language-batch-progress">
        {(["scan", "compile", "stress"] as const).map((phase, index) => (
          <div key={phase} className={batch.phase === phase ? "active" : (["scan", "compile", "stress"].indexOf(batch.phase) > index ? "done" : "")}>
            <b>{index + 1}</b><span>{phase === "scan" ? "快速扫描" : phase === "compile" ? "集中编译" : "压力测试"}</span>
          </div>
        ))}
      </div>
      {(error || busy) && <div className={`focus-language-message ${error ? "error" : "working"}`}>{error || `${busy}…`}</div>}

      {batch.phase === "scan" && (
        <main className="language-scan-stage">
          <header>
            <div><small>PHASE 1 · INDEX</small><h1>快速判断，不要停下来研究</h1><p>当前项固定在视线中央。按 1–4 后自动切换，无需滚动页面。</p></div>
            <div className="language-scan-count"><strong>{scanJudgments.size}</strong><span>/ {batch.scanItemIds.length}</span></div>
          </header>
          <div className="language-scan-meter" aria-label={`已判断 ${scanJudgments.size} / ${batch.scanItemIds.length}`}>
            <i style={{ width: `${Math.round(scanJudgments.size / batch.scanItemIds.length * 100)}%` }} />
          </div>
          {currentScanItem && (
            <section className={`language-scan-focus-card ${currentScanJudgment ? `marked ${currentScanJudgment}` : ""}`}>
              <div className="language-scan-focus-meta">
                <b>{String(cursor + 1).padStart(3, "0")}</b>
                <small>{KIND_LABELS[currentScanItem.kind]}</small>
                {currentScanJudgment && <em>当前：{JUDGMENT_LABELS[currentScanJudgment]}</em>}
              </div>
              <div className="language-scan-focus-copy">
                <strong lang="ja">{currentScanItem.targetJa}</strong>
                {currentScanItem.reading && <span lang="ja">{currentScanItem.reading}</span>}
                <p>{currentScanItem.meaningZh}</p>
              </div>
              <div className="language-shortcuts">
                {(Object.entries(JUDGMENT_LABELS) as [LanguageScanJudgment, string][]).map(([key, label], index) => (
                  <button key={key} onClick={() => markScan(key)}><kbd>{index + 1}</kbd>{label}</button>
                ))}
              </div>
              <footer>
                <button disabled={cursor === 0} onClick={() => setCursor((current) => Math.max(0, current - 1))}>← 上一项</button>
                <span>也可使用键盘 ← → 回看</span>
                <button disabled={cursor === batch.scanItemIds.length - 1} onClick={() => setCursor((current) => Math.min(batch.scanItemIds.length - 1, current + 1))}>下一项 →</button>
              </footer>
            </section>
          )}
          <div className="language-scan-overview-toggle">
            <button onClick={() => setShowScanOverview((value) => !value)}>
              {showScanOverview ? "收起批次总览" : "需要回看？展开批次总览"}
            </button>
          </div>
          {showScanOverview && (
            <div className="language-scan-table compact">
              <div className="head"><span>#</span><span>类型</span><span>日语</span><span>中文功能</span><span>判断</span></div>
              {batch.scanItemIds.map((id, index) => {
                const value = itemById.get(id);
                const judgment = scanJudgments.get(id);
                if (!value) return null;
                return (
                  <article key={id} className={`${index === cursor ? "current" : ""} ${judgment ? `marked ${judgment}` : ""}`} onClick={() => setCursor(index)}>
                    <b>{String(index + 1).padStart(3, "0")}</b>
                    <small>{KIND_LABELS[value.kind]}</small>
                    <div><strong lang="ja">{value.targetJa}</strong>{value.reading && <span>{value.reading}</span>}</div>
                    <p>{value.meaningZh}</p>
                    <em>{judgment ? JUDGMENT_LABELS[judgment] : "未判断"}</em>
                  </article>
                );
              })}
            </div>
          )}
          {scanComplete && <div className="language-scan-complete">全部判断完成。可以直接进入集中编译，也可以展开总览修改任意一项。</div>}
          <button className="language-stage-next" disabled={Boolean(busy)} onClick={() => void advance("compile")}>扫描完成，进入集中编译 →</button>
        </main>
      )}

      {batch.phase === "compile" && (
        <LanguageInputStage
          phase="compile"
          title="只处理缓存未命中"
          description={`从犹豫和不会中选出 ${phaseItems.length} 个最高价值项目。使用日语输入法，不做被动选择。`}
          itemIds={phaseItems}
          itemById={itemById}
          answers={answers}
          actions={allActions}
          onAnswer={saveAnswer}
          onNext={() => void advance("stress")}
          nextLabel="进入隐藏答案压力测试"
          disabled={Boolean(busy)}
        />
      )}

      {batch.phase === "stress" && (
        <LanguageInputStage
          phase="stress"
          title="答案已隐藏，重新提取"
          description={`本轮抽取 ${phaseItems.length} 项；回答结构题允许写短答案，其余项目输入目标词块。`}
          itemIds={phaseItems}
          itemById={itemById}
          answers={answers}
          actions={allActions}
          onAnswer={saveAnswer}
          onNext={() => void complete()}
          nextLabel="完成并结算本轮"
          disabled={Boolean(busy)}
        />
      )}
    </div>
  );
}

function LanguageInputStage({
  phase,
  title,
  description,
  itemIds,
  itemById,
  answers,
  actions,
  onAnswer,
  onNext,
  nextLabel,
  disabled,
}: {
  phase: "compile" | "stress";
  title: string;
  description: string;
  itemIds: string[];
  itemById: Map<string, LanguageLearningItem>;
  answers: Record<string, string>;
  actions: LanguageBatchAction[];
  onAnswer: (itemId: string, phase: "compile" | "stress", answer: string) => void;
  onNext: () => void;
  nextLabel: string;
  disabled: boolean;
}) {
  const answered = itemIds.filter((id) => (answers[id] ?? "").trim()).length;
  const resultFor = (id: string) => actions.filter((action) => action.itemId === id && action.phase === phase).at(-1);
  return (
    <main className="language-input-stage">
      <header><div><small>{phase === "compile" ? "PHASE 2 · COMPILE" : "PHASE 3 · STRESS"}</small><h1>{title}</h1><p>{description}</p></div><div><strong>{answered}</strong><span>/ {itemIds.length}</span></div></header>
      {!itemIds.length ? (
        <section className="language-no-input"><strong>这一阶段没有待处理项目</strong><p>扫描中没有标记“犹豫/不会”，系统会从“已会”中抽样进入压力测试。</p></section>
      ) : (
        <div className="language-input-list">
          {itemIds.map((id, index) => {
            const value = itemById.get(id);
            if (!value) return null;
            const result = resultFor(id);
            const open = value.kind === "answer_strategy";
            return (
              <article key={id}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <div className="prompt"><small>{KIND_LABELS[value.kind]}{value.pattern ? ` · ${value.pattern}` : ""}</small><strong>{phase === "compile" && value.kind === "error_patch" ? value.promptZh : value.meaningZh}</strong>{phase === "compile" && value.originalJa && <code lang="ja">{value.originalJa}</code>}</div>
                <label>
                  {open ? (
                    <textarea rows={4} value={answers[id] ?? ""} onChange={(event) => onAnswer(id, phase, event.target.value)} placeholder="用日语写出结论先行的短回答…" />
                  ) : (
                    <input lang="ja" value={answers[id] ?? ""} onChange={(event) => onAnswer(id, phase, event.target.value)} placeholder="输入日语答案" />
                  )}
                  {result && <span className={result.passed ? "pass" : "fail"}>{result.passed ? "✓ 已命中" : "× 继续复练"}</span>}
                </label>
                {phase === "compile" && <div className="answer"><small>目标</small><strong lang="ja">{value.correctedJa || value.targetJa}</strong></div>}
              </article>
            );
          })}
        </div>
      )}
      <button className="language-stage-next" disabled={disabled} onClick={onNext}>{nextLabel} →</button>
    </main>
  );
}
