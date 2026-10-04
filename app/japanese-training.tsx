"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import type {
  LanguageBatch,
  LanguageBatchAction,
  LanguageBatchHistory,
  LanguageBatchPhase,
  LanguageItemProgress,
  LanguageLearningItem,
  LanguageLearningItemKind,
  LanguageScanJudgment,
  LanguageTrainingStage,
  LanguageV2State,
} from "@/lib/language/types";
import {
  LANGUAGE_COMPILE_LIMIT,
  LANGUAGE_STRESS_LIMIT,
} from "@/lib/language/types";
import { tokyoParts } from "@/lib/dojo/utils";
import { isTypingTarget } from "@/lib/keyboard";
import {
  dailyTraining,
  formatClock,
  goalRatio,
  heatLevel,
  stageDistribution,
  trainingStreak,
} from "@/lib/training-rhythm";
import {
  snapshotStages,
  summarizeBatch,
  summarizeHistory,
  type FullSettlement,
  type SettleMark,
  type Settlement,
  type StageSnapshot,
} from "@/lib/training-settlement";
import { CountUp } from "./count-up";
import { useUiLocale } from "./ui-locale";

// 课程素材与练习题保留原文，仅切换入口、分类和训练模式标签。
const TRAINING_MENU_COPY = {
  "今日训练": ["今日训练", "今日の練習"],
  "能力画像": ["能力画像", "能力プロフィール"],
  "问题地图": ["问题地图", "課題マップ"],
  "训练语料": ["训练语料", "練習素材"],
  "日语集中训练": ["日语集中训练", "日本語集中トレーニング"],
  "训练入口": ["训练入口", "練習の開始"],
  "训练规模": ["训练规模", "練習量"],
  "当前训练阶段": ["当前训练阶段", "現在の練習段階"],
  "轻量": ["轻量", "軽め"],
  "标准": ["标准", "標準"],
  "深度": ["深度", "じっくり"],
  "主动词块": ["主动词块", "表現の想起"],
  "错误修正": ["错误修正", "誤りの修正"],
  "面试官表达": ["面试官表达", "面接官の表現"],
  "回答结构": ["回答结构", "回答の構成"],
  "岗位技术": ["岗位技术", "職種の技術用語"],
  "事实口径": ["事实口径", "事実の表現"],
  "全部": ["全部", "すべて"],
  "快速扫描": ["快速扫描", "クイックスキャン"],
  "集中修正": ["集中修正", "集中修正"],
  "集中编译": ["集中编译", "集中練習"],
  "压力测试": ["压力测试", "実力チェック"],
  "已完成": ["已完成", "完了"],
  "继续{phase}": ["继续{phase}", "{phase}を続ける"],
  "设置今日训练": ["设置今日训练", "今日の練習を設定"],
  "开始今天的集中训练": ["开始今天的集中训练", "今日の集中練習を始める"],
  "开始 {count} 项": ["开始 {count} 项", "{count} 項目を開始"],
  "建立集中训练课程": ["建立集中训练课程", "集中練習コースを作成"],
  "更新训练画像": ["更新训练画像", "練習プロフィールを更新"],
  "保存": ["保存", "保存"],
  "退出到总览": ["退出到总览", "概要に戻る"],
  "已保存": ["已保存", "保存済み"],
  "{count} 项待保存": ["{count} 项待保存", "未保存 {count} 項目"],
  "保存中": ["保存中", "保存中"],
  "保存失败": ["保存失败", "保存に失敗"],
  // 计时与结算等待
  "本次用时": ["本次用时", "今回の経過"],
  "一小时目标 {percent}%": ["一小时目标 {percent}%", "1時間目標 {percent}%"],
  "保存作答": ["保存作答", "回答を保存"],
  "本地判分": ["本地判分", "ローカル採点"],
  "回答结构题批改（可能较慢）": ["回答结构题批改（可能较慢）", "回答構成問題の採点（時間がかかる場合あり）"],
  "本轮没有回答结构题，写入结算": ["本轮没有回答结构题，写入结算", "回答構成問題なし・結果を書き込み"],
  "没有待保存的作答": ["没有待保存的作答", "未保存の回答なし"],
  "已等待 {seconds} 秒": ["已等待 {seconds} 秒", "{seconds} 秒経過"],
  "正在结算本轮训练": ["正在结算本轮训练", "今回の練習を集計中"],
  // 结算屏
  "本轮结算": ["本轮结算", "今回の結果"],
  "{count} 项集中训练": ["{count} 项集中训练", "{count} 項目の集中練習"],
  "本次专注 {time}": ["本次专注 {time}", "今回の集中 {time}"],
  "命中率": ["命中率", "正答率"],
  "命中 {hits} / 作答 {answered}": ["命中 {hits} / 作答 {answered}", "正答 {hits} / 回答 {answered}"],
  "各阶段": ["各阶段", "段階別"],
  "命中": ["命中", "正解"],
  "未通过": ["未通过", "不正解"],
  "未作答": ["未作答", "未回答"],
  "未批改": ["未批改", "未採点"],
  "待确认": ["待确认", "採点未確認"],
  "未判断": ["未判断", "未判定"],
  "已会": ["已会", "分かる"],
  "犹豫": ["犹豫", "あいまい"],
  "不会": ["不会", "分からない"],
  "排除": ["排除", "除外"],
  "未批改说明": [
    "超出每批 Codex 批改上限，没有送去批改；进度按未通过记。",
    "1バッチの採点上限を超えたため Codex に送っていません。進捗上は不正解扱いです。",
  ],
  "待确认说明": [
    "已送 Codex 批改但结果为未通过；Codex 离线时接口同样返回未通过，两者无法区分。进度按未通过记。",
    "Codex の結果は不正解でしたが、Codex がオフラインの場合も同じ応答になるため区別できません。進捗上は不正解扱いです。",
  ],
  "压力测试逐题": ["压力测试逐题", "実力チェックの各問"],
  "本轮升阶": ["本轮升阶", "ステージが上がった項目"],
  "{count} 项": ["{count} 项", "{count} 項目"],
  "项": ["项", "項目"],
  "回落 {count} 项": ["回落 {count} 项", "{count} 項目が後退"],
  "展开升阶条目": ["展开升阶条目", "項目を表示"],
  "与本批开始时相比": ["与本批开始时相比", "このバッチ開始時との比較"],
  "与本次打开时相比": ["与本次打开训练页时相比，之前已保存的作答不计入", "今回開いた時点との比較（以前に保存した回答は含まない）"],
  "没有比较基准": ["没有本批开始时的阶段记录，无法比较升阶", "バッチ開始時のステージ記録がないため比較できません"],
  "{count} 题没有画成 ×": ["{count} 题未批改或待确认，没有画成 ×", "{count} 問は未採点・未確認のため × にしていません"],
  "这一批已经结算过": ["这一批已经结算过，接口只返回汇总行，没有逐题结果。", "このバッチは集計済みのため、合計のみ表示します。"],
  "完成项目": ["完成项目", "完了項目"],
  "命中次数": ["命中次数", "正答数"],
  "回到总览": ["回到总览", "概要に戻る"],
  "正在刷新资料": ["正在刷新资料", "資料を更新中"],
  // 总览节奏
  "连续训练": ["连续训练", "連続練習"],
  "天": ["天", "日"],
  "{day} · {batches} 批 · {items} 项": ["{day} · {batches} 批 · {items} 项", "{day}・{batches} バッチ・{items} 項目"],
  "今天已完成": ["今天已完成", "今日は完了"],
  "保持中 · 今天还没练": ["保持中 · 今天还没练", "継続中 · 今日はまだ"],
  "完成一批后开始计数": ["完成一批后开始计数", "1バッチ完了で開始"],
  "近 14 天": ["近 14 天", "直近 14 日"],
  "近 7 天 {week} 天 · 近 14 天 {fortnight} 天": ["近 7 天 {week} 天 · 近 14 天 {fortnight} 天", "直近7日 {week} 日・14日 {fortnight} 日"],
  "掌握阶段分布": ["掌握阶段分布", "習得ステージの分布"],
  "未见过": ["未见过", "未学習"],
  "能识别": ["能识别", "認識できる"],
  "能修正": ["能修正", "修正できる"],
  "能主动提取": ["能主动提取", "自分で言える"],
  "能迁移使用": ["能迁移使用", "応用できる"],
  "训练稳定": ["训练稳定", "定着"],
  "命中 {count}": ["命中 {count}", "正答 {count}"],
} as const satisfies Record<string, readonly [string, string]>;

type TrainingMenuKey = keyof typeof TRAINING_MENU_COPY;
function useTrainingMenu() {
  const { locale } = useUiLocale();
  const t = (key: TrainingMenuKey, values: Record<string, string | number> = {}) =>
    TRAINING_MENU_COPY[key][locale === "ja" ? 1 : 0].replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
  const label = (value: string) => Object.hasOwn(TRAINING_MENU_COPY, value) ? t(value as TrainingMenuKey) : value;
  return { t, label };
}

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

const BATCH_PHASE_LABELS: Record<LanguageBatchPhase, string> = {
  scan: "快速扫描",
  compile: "集中修正",
  stress: "压力测试",
  completed: "已完成",
};

const ISSUE_DISPLAY_LABELS: Record<string, string> = {
  "compound-question-miss": "复合问题漏答",
  "weak-evidence": "回答缺少事实证据",
  "over-absolute": "表述过于绝对",
  "negative-oversharing": "负面信息展开过多",
};

const AUTO_SAVE_ACTION_COUNT = 50;
// 编译・压力阶段同一题的作答原地替换，待保存数最多就是题数（20/15），到不了上面的阈值；
// 停手这么久就静默存一次，免得切到别的页面时整段作答随组件一起丢掉。
const IDLE_SAVE_MS = 2500;

type ApiError = { error?: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
    // 状態の読み取りが黙り込むと「正在读取…」が永遠に出る。読み取りは 20 秒で諦めて理由を出す。
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  });
  const body = await response.json() as T & ApiError;
  if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
  return body;
}

/*
 * 「本轮升阶」需要本批开始前的阶段。服务端的 progress 把未完成批次里已保存的作答也算进去，
 * 而作答停手 2.5 秒就会静默保存，所以 complete 前后对比几乎永远是 0。
 * 开批那一刻（批次还没有任何动作）把批次内项目的阶段记到本机；这是 UI 状态，不写 vault。
 */
const BASELINE_PREFIX = "language-batch-baseline:";

function readBaseline(batchId: string): StageSnapshot | undefined {
  try {
    const raw = window.localStorage.getItem(BASELINE_PREFIX + batchId);
    const parsed = raw ? JSON.parse(raw) as StageSnapshot : undefined;
    return parsed && parsed.scope === "batch" && parsed.stages && typeof parsed.stages === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeBaseline(batchId: string, snapshot: StageSnapshot) {
  try {
    // 同一时间只有一个进行中的批次，旧批次的快照顺手清掉，不让本机存储越积越多。
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(BASELINE_PREFIX) && key !== BASELINE_PREFIX + batchId) window.localStorage.removeItem(key);
    }
    window.localStorage.setItem(BASELINE_PREFIX + batchId, JSON.stringify(snapshot));
  } catch {
    // 隐私模式或存储被禁用：退回「本次打开」的内存快照。
  }
}

function clearBaseline(batchId: string) {
  try {
    window.localStorage.removeItem(BASELINE_PREFIX + batchId);
  } catch {
    // 同上，存储不可用时无事可做。
  }
}

type CompleteOutcome = {
  batchId: string;
  before: LanguageV2State;
  response: { state: LanguageV2State; batch?: LanguageBatch; history?: LanguageBatchHistory };
  elapsedMs: number;
};

/** 浮层、抽屉打开时（aria-modal 或 inert 祖先）单键快捷键要让出去。 */
function shortcutBlocked(target: EventTarget | null) {
  if (isTypingTarget(target)) return true;
  if (document.querySelector('[aria-modal="true"]')) return true;
  return Boolean((target as Element | null)?.closest?.("[inert]"));
}

function JapaneseTraining({
  onVaultChanged,
}: {
  onVaultChanged: () => Promise<void>;
}) {
  const { t, label: menuLabel } = useTrainingMenu();
  const [state, setState] = useState<LanguageV2State>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"today" | "profile" | "issues" | "library">("today");
  const [size, setSize] = useState<100 | 150 | 200>(200);
  const [showBatch, setShowBatch] = useState(false);
  // 结算数据必须放在这里：complete 返回后 currentBatch 变成 undefined，工作区会被卸载。
  const [settlement, setSettlement] = useState<{ value: Settlement; elapsedMs: number } | null>(null);
  const [leavingSettlement, setLeavingSettlement] = useState(false);
  const settleRefresh = useRef<Promise<void> | null>(null);
  const baselines = useRef(new Map<string, StageSnapshot>());

  const currentBatchId = state.currentBatch?.id;
  useEffect(() => {
    const batch = state.currentBatch;
    if (!batch || baselines.current.has(batch.id)) return;
    const stored = readBaseline(batch.id);
    if (stored) {
      baselines.current.set(batch.id, stored);
      return;
    }
    // 还没有任何动作 = progress 里不含本批作答，是真正的开批基准；否则只能从这次打开算起。
    const fresh = batch.actions.length === 0;
    const snapshot: StageSnapshot = {
      scope: fresh ? "batch" : "session",
      stages: snapshotStages(state.progress, batch.scanItemIds),
    };
    baselines.current.set(batch.id, snapshot);
    if (fresh) writeBaseline(batch.id, snapshot);
  // 只在批次换了时取快照；progress 随保存变化时再取就不是基准了。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBatchId]);

  const handleCompleted = useCallback((outcome: CompleteOutcome) => {
    const { response, before } = outcome;
    const kinds = new Map((before.curriculum?.items ?? []).map((item) => [item.id, item.kind]));
    const value: Settlement | null = response.batch
      ? summarizeBatch({
          batch: response.batch,
          kindOf: (itemId) => kinds.get(itemId),
          before: baselines.current.get(outcome.batchId),
          after: response.state.progress,
        })
      : response.history ? summarizeHistory(response.history) : null;
    baselines.current.delete(outcome.batchId);
    clearBaseline(outcome.batchId);
    // 外壳的笔记刷新先在后台跑，结算屏上「回到总览」时再等它，原来的 onVaultChanged → 退出顺序不变。
    settleRefresh.current = onVaultChanged().catch(() => undefined);
    if (value) setSettlement({ value, elapsedMs: outcome.elapsedMs });
    else setShowBatch(false);
  }, [onVaultChanged]);

  const leaveSettlement = useCallback(async () => {
    setLeavingSettlement(true);
    try {
      await settleRefresh.current;
    } finally {
      settleRefresh.current = null;
      setLeavingSettlement(false);
      setSettlement(null);
      setShowBatch(false);
    }
  }, []);

  // 等了多久要说出来：首次读取会在服务端重算全部课程状态，几秒是正常的，但没有反馈就像卡死。
  // tick 每秒加一、每次开始读取归零，读取中就是已等待秒数。
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [loading]);
  const elapsed = loading ? tick : 0;

  const load = useCallback(async () => {
    setLoading(true);
    setTick(0);
    try {
      setState(await api<LanguageV2State>("/api/language/v2/state", { method: "GET" }));
    } catch (loadError) {
      setError(loadError instanceof Error && loadError.name === "TimeoutError"
        ? "读取集中训练状态超过 20 秒。首次会重算全部课程状态，稍后再试或按 R 重读。"
        : loadError instanceof Error ? loadError.message : "无法读取集中训练状态");
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
  const stageCounts = useMemo(
    () => Object.fromEntries(
      Object.keys(STAGE_LABELS).map((stage) => [
        stage,
        state.progress.filter((item) => item.stage === stage).length,
      ]),
    ) as Record<LanguageTrainingStage, number>,
    [state.progress],
  );

  const firstLoad = loading && !curriculum;

  if (settlement) {
    return (
      <BatchSettlementScreen
        settlement={settlement.value}
        elapsedMs={settlement.elapsedMs}
        items={curriculum?.items ?? []}
        leaving={leavingSettlement}
        onLeave={() => void leaveSettlement()}
      />
    );
  }

  if (showBatch && state.currentBatch && curriculum) {
    return (
      <LanguageBatchWorkspace
        state={state}
        onState={setState}
        onExit={() => setShowBatch(false)}
        onCompleted={handleCompleted}
        onVaultChanged={onVaultChanged}
      />
    );
  }

  return (
    <div className="focus-language-view">
      <dl className="focus-language-glance page-stat-strip module-stat-strip" aria-label="日语训练摘要">
        {/* 首次读取时还不知道数字，先显示「—」，不先闪一排 0。 */}
        <div><dt>训练项目</dt><dd>{firstLoad ? "—" : curriculum?.items.length ?? 0}</dd></div>
        <div><dt>尚未扫描</dt><dd>{firstLoad ? "—" : stageCounts.unseen}</dd></div>
        <div><dt>可主动提取</dt><dd>{firstLoad ? "—" : stageCounts.retrievable + stageCounts.transferable}</dd></div>
        <div><dt>训练稳定</dt><dd>{firstLoad ? "—" : stageCounts.stable}</dd></div>
      </dl>

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
          <button disabled={Boolean(busy)} onClick={() => void rebuild()}>{t("建立集中训练课程")}</button>
        </section>
      ) : curriculum ? (
        <>
          {state.stale && (
            <section className="focus-language-stale">
              <div><strong>面试或岗位资料已经更新</strong><span>当前批次仍可继续；重建后，新证据才会进入下一批。</span></div>
              <button disabled={Boolean(busy)} onClick={() => void rebuild()}>{t("更新训练画像")}</button>
            </section>
          )}

          <nav className="focus-language-tabs" aria-label={t("日语集中训练")}>
            {([
              ["today", "今日训练"],
              ["profile", "能力画像"],
              ["issues", "问题地图"],
              ["library", "训练语料"],
            ] as const).map(([key, label]) => (
              <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{menuLabel(label)}</button>
            ))}
          </nav>

          {tab === "today" ? (
            <>
              <TrainingNow
                state={state}
                size={size}
                busy={Boolean(busy)}
                onSize={setSize}
                onStart={() => void start()}
                onResume={() => setShowBatch(true)}
              />
              <TodayDashboard state={state} />
            </>
          ) : (
            <section className="focus-language-resume" aria-label={t("训练入口")}>
              <span>{state.currentBatch ? `本批 ${state.currentBatch.targetSize} 项 · 进度已保存` : "今日训练尚未开始"}</span>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => state.currentBatch ? setShowBatch(true) : setTab("today")}
              >
                {state.currentBatch ? t("继续{phase}", { phase: menuLabel(BATCH_PHASE_LABELS[state.currentBatch.phase]) }) : t("设置今日训练")}
                <span aria-hidden="true"> →</span>
              </button>
            </section>
          )}
          {tab === "profile" && <AbilityProfile state={state} />}
          {tab === "issues" && <IssueMap state={state} />}
          {tab === "library" && <LanguageLibrary items={curriculum.items} progress={progress} />}
        </>
      ) : loading ? (
        <div className="focus-language-loading" role="status">
          <p>正在读取训练课程…{elapsed >= 3 && `（已等待 ${elapsed} 秒；首次会重算课程状态，较慢）`}</p>
          {/* 骨架按总览的版式铺：入口卡、节奏带、两栏，数据到达时版面不跳。 */}
          <div className="focus-language-skeleton" aria-hidden="true">
            <i className="skeleton now" />
            <span className="pulse"><i className="skeleton" /><i className="skeleton" /><i className="skeleton" /></span>
            <span className="columns"><i className="skeleton" /><i className="skeleton" /></span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TrainingNow({
  state,
  size,
  busy,
  onSize,
  onStart,
  onResume,
}: {
  state: LanguageV2State;
  size: 100 | 150 | 200;
  busy: boolean;
  onSize: (size: 100 | 150 | 200) => void;
  onStart: () => void;
  onResume: () => void;
}) {
  const { t, label: menuLabel } = useTrainingMenu();
  const batch = state.currentBatch;
  const phaseOrder: Exclude<LanguageBatchPhase, "completed">[] = ["scan", "compile", "stress"];
  const currentIndex = batch ? phaseOrder.indexOf(batch.phase as Exclude<LanguageBatchPhase, "completed">) : -1;

  return (
    <section className="focus-language-now">
      <span className="focus-language-now-mark" aria-hidden="true">語</span>
      <div className="focus-language-now-copy">
        <h2>{batch ? t("继续{phase}", { phase: menuLabel(BATCH_PHASE_LABELS[batch.phase]) }) : t("开始今天的集中训练")}</h2>
        <p>
          {batch
            ? `本批 ${batch.targetSize} 项。当前只处理训练未命中，完成后进入隐藏答案压力测试。`
            : "先快速扫描建立索引，再集中修正最多 20 项，最后压力测试最多 15 项。"}
        </p>
      </div>
      {batch ? (
        <ol className="focus-language-now-steps" aria-label={t("当前训练阶段")}>
          {phaseOrder.map((phase, index) => (
            <li
              key={phase}
              className={index < currentIndex ? "done" : index === currentIndex ? "active" : ""}
            >
              <b>{index + 1}</b>
              <span>{menuLabel(BATCH_PHASE_LABELS[phase])}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="focus-language-size" role="group" aria-label={t("训练规模")}>
          {[100, 150, 200].map((value) => (
            <button key={value} className={size === value ? "active" : ""} onClick={() => onSize(value as 100 | 150 | 200)}>
              <strong>{value}</strong><span>{value === 100 ? t("轻量") : value === 150 ? t("标准") : t("深度")}</span>
            </button>
          ))}
        </div>
      )}
      <button
        className="focus-language-now-action"
        disabled={busy}
        onClick={batch ? onResume : onStart}
      >
        {batch ? t("继续{phase}", { phase: menuLabel(BATCH_PHASE_LABELS[batch.phase]) }) : t("开始 {count} 项", { count: size })}
        <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

function TodayDashboard({
  state,
}: {
  state: LanguageV2State;
}) {
  const { t } = useTrainingMenu();
  const recent = state.history.slice(0, 5);
  return (
    <div className="focus-language-dashboard">
      <TrainingPulse state={state} />
      <section className="focus-language-two-column">
        <div>
          <header><h2>现在最值得修</h2></header>
          {state.curriculum?.profile.topIssues.slice(0, 8).map((issue, index) => (
            <article className="focus-issue-compact" key={issue.key}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <div>
                <strong title={issue.label}>{ISSUE_DISPLAY_LABELS[issue.label] ?? issue.label}</strong>
                <span>{issue.interviewCount} 场 · {issue.occurrenceCount} 次证据</span>
              </div>
            </article>
          ))}
        </div>
        <div>
          <header><h2>最近批次</h2></header>
          {recent.length ? recent.map((entry) => (
            <article className="focus-history-row" key={entry.id}>
              <time>{entry.date}</time><strong>{entry.completedCount} / {entry.targetSize}</strong>
              {/* LanguageBatchHistory.successCount：本批判定通过的作答数，不是条目累计的 successCount。 */}
              <em>{entry.completedAt ? t("命中 {count}", { count: entry.successCount }) : "—"}</em>
              <span>{entry.completedAt ? "已完成" : "进行中"}</span>
            </article>
          )) : <p className="focus-language-muted">完成第一批后，这里会显示吞吐和成功记录。</p>}
        </div>
      </section>
    </div>
  );
}

/** 掌握阶段的色阶：同一色相由浅到深，阶段是有序的，不该用六种无关的颜色。 */
const STAGE_TONE: Record<LanguageTrainingStage, string> = {
  unseen: "var(--line-strong)",
  recognized: "color-mix(in oklab, var(--green) 28%, var(--surface-sunken))",
  correctable: "color-mix(in oklab, var(--green) 44%, var(--surface-sunken))",
  retrievable: "color-mix(in oklab, var(--green) 62%, var(--surface-sunken))",
  transferable: "color-mix(in oklab, var(--green) 80%, var(--surface-sunken))",
  stable: "var(--green)",
};

// 「今天」按 JST 订阅而不是在渲染里直接读时钟：服务端快照为空，水合前后一致；
// 页面挂过零点时每分钟的检查会把热度条与连续天数换到新的一天。
function subscribeMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}
const jstTodaySnapshot = () => tokyoParts().date;
const emptyTodaySnapshot = () => "";
function useJstToday() {
  return useSyncExternalStore(subscribeMinute, jstTodaySnapshot, emptyTodaySnapshot);
}

/** 总览的节奏带：连续天数、近 14 天热度、掌握阶段分布。全部由批次历史与进度推出。 */
export function TrainingPulse({ state, today: fixedToday }: { state: LanguageV2State; today?: string }) {
  const { t, label } = useTrainingMenu();
  const liveToday = useJstToday();
  const today = fixedToday ?? liveToday;
  const streak = useMemo(
    () => today ? trainingStreak(state.history, today) : { days: 0, status: "none" as const },
    [state.history, today],
  );
  const days = useMemo(() => today ? dailyTraining(state.history, 14, today) : [], [state.history, today]);
  const shares = useMemo(() => stageDistribution(state.progress), [state.progress]);
  const activeDays = (span: number) => days.slice(-span).filter((day) => day.batches > 0).length;
  const streakNote = streak.status === "done"
    ? t("今天已完成")
    : streak.status === "holding" ? t("保持中 · 今天还没练") : t("完成一批后开始计数");

  return (
    <section className="focus-language-pulse" aria-label={t("连续训练")}>
      <div className={`focus-pulse-streak ${streak.status}`}>
        <small>{t("连续训练")}</small>
        <p><CountUp as="strong" value={streak.days} /><span>{t("天")}</span></p>
        <em>{streakNote}</em>
      </div>
      <div className="focus-pulse-heat">
        <header>
          <small>{t("近 14 天")}</small>
          <span>{t("近 7 天 {week} 天 · 近 14 天 {fortnight} 天", { week: activeDays(7), fortnight: activeDays(14) })}</span>
        </header>
        <ol>
          {days.map((day, index) => (
            <li
              key={day.day}
              className={`level-${heatLevel(day)}${index === days.length - 1 ? " today" : ""}`}
              style={{ "--i": index } as CSSProperties}
              title={day.batches ? `${t("{day} · {batches} 批 · {items} 项", { day: day.day, batches: day.batches, items: day.items })} · ${t("命中 {count}", { count: day.hits })}` : day.day}
            >
              <span>{Number(day.day.slice(8))}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="focus-pulse-stages">
        <header><small>{t("掌握阶段分布")}</small><span>{state.progress.length}</span></header>
        <div className="focus-pulse-stage-bar" role="img" aria-label={shares.map((value) => `${label(STAGE_LABELS[value.stage])} ${value.count}`).join(" / ")}>
          {shares.filter((value) => value.count > 0).map((value) => (
            <i
              key={value.stage}
              style={{ flexGrow: value.count, background: STAGE_TONE[value.stage] }}
              title={`${label(STAGE_LABELS[value.stage])} ${value.count}`}
            />
          ))}
        </div>
        <ul>
          {shares.map((value) => (
            <li key={value.stage}>
              <i style={{ background: STAGE_TONE[value.stage] }} aria-hidden="true" />
              <span>{label(STAGE_LABELS[value.stage])}</span>
              <b>{value.count}</b>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function AbilityProfile({ state }: { state: LanguageV2State }) {
  const profile = state.curriculum!.profile;
  const stages = Object.keys(STAGE_LABELS) as LanguageTrainingStage[];
  return (
    <div className="focus-language-panel-page">
      <header><h2>能力画像</h2></header>
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
      <header><h2>跨面试复发模式</h2></header>
      <div className="focus-issue-map">
        {state.curriculum!.profile.topIssues.map((issue) => (
          <details key={issue.key}>
            <summary>
              <span>{KIND_LABELS[issue.kind]}</span><strong title={issue.label}>{ISSUE_DISPLAY_LABELS[issue.label] ?? issue.label}</strong>
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
  const { t, label: menuLabel } = useTrainingMenu();
  const [kind, setKind] = useState<LanguageLearningItemKind | "all">("all");
  const visible = items.filter((value) => kind === "all" || value.kind === kind);
  return (
    <div className="focus-language-panel-page">
      <header><h2>个人词汇、语法和面试表达</h2></header>
      <div className="focus-library-filters">
        <button className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>{t("全部")} {items.length}</button>
        {(Object.keys(KIND_LABELS) as LanguageLearningItemKind[]).map((key) => (
          <button key={key} className={kind === key ? "active" : ""} onClick={() => setKind(key)}>{menuLabel(KIND_LABELS[key])} {items.filter((value) => value.kind === key).length}</button>
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
  onCompleted,
  onVaultChanged,
}: {
  state: LanguageV2State;
  onState: (state: LanguageV2State) => void;
  onExit: () => void;
  onCompleted: (outcome: CompleteOutcome) => void;
  onVaultChanged: () => Promise<void>;
}) {
  const { t } = useTrainingMenu();
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
  const activeSessionStartedAt = useRef(0);
  // 结算等待的分步：save = 补存作答（服务端合并时同时本地判分），remote = complete 请求在途。
  const [settleStep, setSettleStep] = useState<"save" | "remote" | null>(null);
  const [settleSaved, setSettleSaved] = useState(0);
  const [settleStartedAt, setSettleStartedAt] = useState(0);
  const [showScanOverview, setShowScanOverview] = useState(false);
  const saveInFlight = useRef<Promise<void> | null>(null);
  // 卸载时补发要读到「最后一刻」的待保存内容；放进 effect 依赖会让每次按键都触发一次清理和补发。
  const pendingRef = useRef<LanguageBatchAction[]>([]);
  const cursorRef = useRef(batch.cursor);
  useEffect(() => {
    pendingRef.current = pending;
    cursorRef.current = cursor;
  }, [pending, cursor]);

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
    // 同一题在请求途中又被改过时 actionId 不变、at 变了：只按 actionId 清会把新改的内容一起丢掉。
    const sentKey = (action: LanguageBatchAction) => `${action.actionId}\u0000${action.at}`;
    const sentKeys = new Set(actions.map(sentKey));
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
        setPending((current) => current.filter((action) => !sentKeys.has(sentKey(action))));
        pendingRef.current = pendingRef.current.filter((action) => !sentKeys.has(sentKey(action)));
        // 只有换阶段才回到服务端给的位置（归零）。普通保存发出后人还在往前扫，
        // 回写请求发出时的旧 cursor 会把焦点卡片拽回几项之前。
        if (nextPhase) setCursor(result.state.currentBatch?.cursor ?? 0);
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
    if (!pending.length || busy) return;
    const timer = window.setTimeout(() => void checkpoint(pending, undefined, cursor, true), IDLE_SAVE_MS);
    return () => window.clearTimeout(timer);
  }, [pending, busy, checkpoint, cursor]);

  // 应用内切到别的视图时组件直接卸载，beforeunload 不会触发；这里补发最后一批。
  useEffect(() => {
    const batchId = batch.id;
    return () => {
      const unsaved = pendingRef.current;
      if (!unsaved.length) return;
      void fetch("/api/language/v2/batch/checkpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId, actions: unsaved, cursor: cursorRef.current }),
        keepalive: true,
      }).catch(() => undefined);
    };
  }, [batch.id]);

  // 只记起点；每秒刷新交给 BatchClock，免得整个工作区（200 行总览、20 个输入框）跟着每秒重绘。
  useEffect(() => {
    activeSessionStartedAt.current = Date.now();
  }, [batch.id]);

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
      // 按钮不算输入场景：鼠标点过判断按钮后焦点留在按钮上，1–4 和方向键照样要能用。
      // 抽屉、浮层打开时让出，免得在笔记抽屉里按数字把背后的扫描卡判掉。
      if (shortcutBlocked(event.target)) return;
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
    setSettleSaved(0);
    setSettleStep("save");
    const before = state;
    try {
      // ① 先把还没存的作答单独存一次：服务端合并时就做完本地判分，这两步的完成是真实可见的；
      //    complete 里只剩 Codex 批改与写入，等待清单不用伪造进度。
      if (saveInFlight.current) await saveInFlight.current;
      const unsaved = pendingRef.current;
      if (unsaved.length) {
        const saved = await api<{ state: LanguageV2State }>(
          "/api/language/v2/batch/checkpoint",
          { method: "POST", body: JSON.stringify({ batchId: batch.id, actions: unsaved, cursor: cursorRef.current }) },
        );
        const sentKeys = new Set(unsaved.map((action) => `${action.actionId}\u0000${action.at}`));
        pendingRef.current = pendingRef.current.filter((action) => !sentKeys.has(`${action.actionId}\u0000${action.at}`));
        setPending(pendingRef.current);
        setSettleSaved(unsaved.length);
        onState(saved.state);
      }
      // 「已等待」从 complete 请求发出时算，补存那一步不算进 Codex 的等待。
      setSettleStartedAt(Date.now());
      setSettleStep("remote");
      const result = await api<{ state: LanguageV2State; batch?: LanguageBatch; history?: LanguageBatchHistory }>(
        "/api/language/v2/batch/complete",
        // Codex 批改在桥里最长 120 秒，再加两次读库写库；通用的 20 秒读取上限会把正常的批改等成「失败」。
        { method: "POST", body: JSON.stringify({ batchId: batch.id, actions: pendingRef.current }), signal: AbortSignal.timeout(240_000) },
      );
      // 结算已经带走了全部作答，卸载时不该再往已完成的批次补发。
      pendingRef.current = [];
      // 先交结算数据再换 state：同一批次更新里父组件直接切到结算屏，不会先闪一下总览。
      onCompleted({ batchId: batch.id, before, response: result, elapsedMs: Date.now() - activeSessionStartedAt.current });
      onState(result.state);
    } catch (completeError) {
      setError(completeError instanceof Error ? completeError.message : "训练结算失败");
    } finally {
      setBusy("");
      setSettleStep(null);
    }
  };

  const phaseItems = batch.phase === "scan"
    ? batch.scanItemIds
    : batch.phase === "compile"
      ? batch.compileItemIds.slice(0, LANGUAGE_COMPILE_LIMIT)
      : batch.stressItemIds.slice(0, LANGUAGE_STRESS_LIMIT);
  const currentScanItem = itemById.get(batch.scanItemIds[cursor]);
  const currentScanJudgment = currentScanItem ? scanJudgments.get(currentScanItem.id) : undefined;
  const scanComplete = scanJudgments.size === batch.scanItemIds.length;
  const saveStatus = busy
    ? t("保存中")
    : error
      ? t("保存失败")
      : pending.length
        ? t("{count} 项待保存", { count: pending.length })
        : t("已保存");
  // 当前阶段内的完成比例：扫描看已判断，编译・压力看已填写。
  const phaseDone = batch.phase === "scan"
    ? scanJudgments.size
    : phaseItems.filter((id) => (answers[id] ?? "").trim()).length;
  const phaseRatio = phaseItems.length ? phaseDone / phaseItems.length : 0;
  const openAnswered = batch.stressItemIds
    .slice(0, LANGUAGE_STRESS_LIMIT)
    .filter((id) => itemById.get(id)?.kind === "answer_strategy" && (answers[id] ?? "").trim()).length;

  return (
    <div className="language-batch-workspace">
      <header className="language-batch-topbar">
        <div><span>語</span><div><small>DEEP WORK · <span aria-live="polite">{saveStatus}</span></small><strong>{batch.targetSize} 项集中训练</strong></div></div>
        <BatchClock startedAt={activeSessionStartedAt} />
        <div>
          <button disabled={Boolean(busy)} onClick={() => void checkpoint(pending)}>{t("保存")}</button>
          <button className="quiet" disabled={Boolean(busy)} onClick={async () => { await checkpoint(pending); onExit(); }}>{t("退出到总览")}</button>
        </div>
      </header>
      <div className="language-batch-progress">
        {(["scan", "compile", "stress"] as const).map((phase, index) => (
          <div key={phase} className={batch.phase === phase ? "active" : (["scan", "compile", "stress"].indexOf(batch.phase) > index ? "done" : "")}>
            <b>{index + 1}</b><span>{phase === "scan" ? t("快速扫描") : phase === "compile" ? t("集中编译") : t("压力测试")}</span>
            {batch.phase === phase && phaseItems.length > 0 && (
              <>
                <em>{phaseDone} / {phaseItems.length}</em>
                <i
                  className="language-batch-progress-fill"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={phaseItems.length}
                  aria-valuenow={phaseDone}
                  aria-label={phase === "scan" ? t("快速扫描") : phase === "compile" ? t("集中编译") : t("压力测试")}
                  style={{ transform: `scaleX(${phaseRatio})` }}
                />
              </>
            )}
          </div>
        ))}
      </div>
      {settleStep ? (
        <ol className="language-settle-steps" aria-live="polite" aria-label={t("正在结算本轮训练")}>
          <li className={settleStep === "save" ? "active" : "done"}>
            <b aria-hidden="true">{settleStep === "save" ? "" : "✓"}</b>
            <span>{t("保存作答")}</span>
            <small>{settleStep === "save" ? (pending.length ? t("{count} 项待保存", { count: pending.length }) : "") : settleSaved ? t("{count} 项", { count: settleSaved }) : t("没有待保存的作答")}</small>
          </li>
          <li className={settleStep === "save" ? "active" : "done"}>
            <b aria-hidden="true">{settleStep === "save" ? "" : "✓"}</b>
            <span>{t("本地判分")}</span>
          </li>
          <li className={settleStep === "remote" ? "active" : ""}>
            <b aria-hidden="true" />
            <span>{openAnswered ? t("回答结构题批改（可能较慢）") : t("本轮没有回答结构题，写入结算")}</span>
            {settleStep === "remote" && <SettleWaited since={settleStartedAt} />}
          </li>
        </ol>
      ) : (error || busy) && <div className={`focus-language-message ${error ? "error" : "working"}`}>{error || `${busy}…`}</div>}

      {batch.phase === "scan" && (
        <main className="language-scan-stage">
          <header>
            <div><h1>快速扫描</h1><details className="language-operation-help"><summary>操作说明</summary><p>按 1–4 判断后自动切换，也可使用 ← → 回看。</p></details></div>
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
          title="只精练一个词块或一处修正"
          description={`从犹豫和不会中选出 ${phaseItems.length} 个最高价值项目。不是重答面试题，也不用默写整段。`}
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
          description={`本轮最多 ${phaseItems.length} 项；普通题本地匹配，至多3个回答结构题由 Codex 批改2–3句日语短回答。`}
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

/** 计时单独成组件：每秒的刷新只重绘这一小块。 */
function BatchClock({ startedAt }: { startedAt: { readonly current: number } }) {
  const { t } = useTrainingMenu();
  const [elapsedMs, setElapsedMs] = useState(0);
  // 计时用 setInterval 而不是 CSS 动画：减弱动效会把动画压到近 0，计时不能跟着失效。
  // 子组件的 effect 先于父组件执行，起点要到下一拍才写好，所以首帧用 setTimeout 0。
  useEffect(() => {
    const update = () => {
      if (startedAt.current) setElapsedMs(Date.now() - startedAt.current);
    };
    const timer = window.setInterval(update, 1_000);
    const first = window.setTimeout(update, 0);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [startedAt]);
  const goal = goalRatio(elapsedMs);
  const goalText = t("一小时目标 {percent}%", { percent: Math.round(goal * 100) });
  return (
    <div className="language-batch-clock" title={goalText}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="track" cx="18" cy="18" r="15" pathLength={1} />
        <circle className="fill" cx="18" cy="18" r="15" pathLength={1} style={{ strokeDashoffset: 1 - goal }} />
      </svg>
      <div>
        <strong role="timer" aria-label={t("本次用时")}>{formatClock(elapsedMs)}</strong>
        <span>{goalText}</span>
      </div>
    </div>
  );
}

/** 结算请求在途时的真实等待秒数；同样自己计时，不让工作区每秒重绘。 */
function SettleWaited({ since }: { since: number }) {
  const { t } = useTrainingMenu();
  const [now, setNow] = useState(since);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return seconds >= 2 ? <small>{t("已等待 {seconds} 秒", { seconds })}</small> : null;
}

const MARK_GLYPH: Record<SettleMark, string> = { pass: "✓", fail: "×", blank: "–", ungraded: "?", unconfirmed: "?" };
const MARK_LABEL: Record<SettleMark, TrainingMenuKey> = {
  pass: "命中",
  fail: "未通过",
  blank: "未作答",
  ungraded: "未批改",
  unconfirmed: "待确认",
};

type TallySegment = { key: string; tone: string; label: TrainingMenuKey; count: number };

function PhaseTallyRow({ title, total, segments }: { title: string; total: number; segments: TallySegment[] }) {
  const { t } = useTrainingMenu();
  const shown = segments.filter((segment) => segment.count > 0);
  return (
    <article className="language-settle-phase">
      <header><strong>{title}</strong><span>{t("{count} 项", { count: total })}</span></header>
      <div className="language-settle-bar" aria-hidden="true">
        {shown.map((segment) => <i key={segment.key} className={`tone-${segment.tone}`} style={{ flexGrow: segment.count }} />)}
      </div>
      <p>
        {shown.length
          ? shown.map((segment) => (
              <span key={segment.key} className={`tone-${segment.tone}`}>{t(segment.label)} <b>{segment.count}</b></span>
            ))
          : <span>—</span>}
      </p>
    </article>
  );
}

function FullSettlementBody({ settlement, itemById }: { settlement: FullSettlement; itemById: Map<string, LanguageLearningItem> }) {
  const { t, label } = useTrainingMenu();
  const { answered, hits, pendingReview, rate } = settlement;
  const hitShare = answered ? hits / answered : 0;
  const pendingShare = answered ? pendingReview / answered : 0;
  const marksPresent = new Set(settlement.stressItems.map((item) => item.mark));
  const baselineNote = settlement.baseline === "batch"
    ? t("与本批开始时相比")
    : settlement.baseline === "session" ? t("与本次打开时相比") : t("没有比较基准");

  return (
    <>
      <div className="language-settle-grid">
        <div className="language-settle-score">
          <div className="language-settle-ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle className="track" cx="60" cy="60" r="52" pathLength={1} />
              {pendingShare > 0 && (
                <circle
                  className="pending"
                  cx="60" cy="60" r="52" pathLength={1}
                  style={{ strokeDashoffset: 1 - pendingShare, transform: `rotate(${hitShare * 360}deg)` }}
                />
              )}
              {hitShare > 0 && <circle className="hit" cx="60" cy="60" r="52" pathLength={1} style={{ strokeDashoffset: 1 - hitShare }} />}
            </svg>
            <div>
              {rate === null
                ? <strong>—</strong>
                : <p><CountUp as="strong" value={Math.round(rate * 100)} duration={900} /><span>%</span></p>}
              <small>{t("命中率")}</small>
            </div>
          </div>
          <div className="language-settle-score-copy">
            <strong>{t("命中 {hits} / 作答 {answered}", { hits, answered })}</strong>
            {pendingReview > 0 && <p>{t("{count} 题没有画成 ×", { count: pendingReview })}</p>}
          </div>
        </div>

        <div className="language-settle-phases">
          <h2>{t("各阶段")}</h2>
          <PhaseTallyRow
            title={t("快速扫描")}
            total={settlement.scan.total}
            segments={[
              { key: "known", tone: "pass", label: "已会", count: settlement.scan.known },
              { key: "uncertain", tone: "warn", label: "犹豫", count: settlement.scan.uncertain },
              { key: "unknown", tone: "fail", label: "不会", count: settlement.scan.unknown },
              { key: "reject", tone: "muted", label: "排除", count: settlement.scan.reject },
              { key: "unjudged", tone: "empty", label: "未判断", count: settlement.scan.unjudged },
            ]}
          />
          {(["compile", "stress"] as const).map((phase) => {
            const tally = settlement[phase];
            return (
              <PhaseTallyRow
                key={phase}
                title={phase === "compile" ? t("集中编译") : t("压力测试")}
                total={tally.total}
                segments={[
                  { key: "pass", tone: "pass", label: "命中", count: tally.pass },
                  { key: "fail", tone: "fail", label: "未通过", count: tally.fail },
                  { key: "unconfirmed", tone: "warn", label: "待确认", count: tally.unconfirmed },
                  { key: "ungraded", tone: "muted", label: "未批改", count: tally.ungraded },
                  { key: "blank", tone: "empty", label: "未作答", count: tally.blank },
                ]}
              />
            );
          })}
        </div>

        <div className="language-settle-stages">
          <h2>{t("本轮升阶")}</h2>
          <p className="language-settle-big">
            {settlement.baseline === "none"
              ? <strong>—</strong>
              : <><CountUp as="strong" value={settlement.promoted.length} /><span>{t("项")}</span></>}
          </p>
          <small>{baselineNote}</small>
          {settlement.demoted.length > 0 && <p className="language-settle-down">{t("回落 {count} 项", { count: settlement.demoted.length })}</p>}
          {settlement.promoted.length > 0 && (
            <details>
              <summary>{t("展开升阶条目")}</summary>
              <ul>
                {settlement.promoted.map((change) => {
                  const item = itemById.get(change.itemId);
                  return (
                    <li key={change.itemId}>
                      <strong lang="ja">{item?.targetJa ?? change.itemId}</strong>
                      <span>{label(STAGE_LABELS[change.from])} → <b>{label(STAGE_LABELS[change.to])}</b></span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      </div>

      {settlement.stressItems.length > 0 && (
        <section className="language-settle-reveal">
          <header>
            <h2>{t("压力测试逐题")}</h2>
            {(marksPresent.has("ungraded") || marksPresent.has("unconfirmed")) && (
              <p>
                {marksPresent.has("unconfirmed") && <span><b>?</b> {t("待确认")}：{t("待确认说明")}</span>}
                {marksPresent.has("ungraded") && <span><b>?</b> {t("未批改")}：{t("未批改说明")}</span>}
              </p>
            )}
          </header>
          <ol>
            {settlement.stressItems.map((entry, index) => {
              const item = itemById.get(entry.itemId);
              return (
                <li
                  key={entry.itemId}
                  className={`mark-${entry.mark}`}
                  style={{ "--i": index } as CSSProperties}
                  title={entry.mark === "ungraded" ? t("未批改说明") : entry.mark === "unconfirmed" ? t("待确认说明") : undefined}
                >
                  <b aria-hidden="true">{MARK_GLYPH[entry.mark]}</b>
                  <div>
                    <strong lang="ja">{item?.targetJa ?? entry.itemId}</strong>
                    {item && <small>{item.meaningZh}</small>}
                  </div>
                  <em>{t(MARK_LABEL[entry.mark])}</em>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </>
  );
}

export function BatchSettlementScreen({
  settlement,
  elapsedMs,
  items,
  leaving,
  onLeave,
}: {
  settlement: Settlement;
  elapsedMs: number;
  items: LanguageLearningItem[];
  leaving: boolean;
  onLeave: () => void;
}) {
  const { t } = useTrainingMenu();
  const itemById = useMemo(() => new Map(items.map((value) => [value.id, value])), [items]);
  const backRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  // 焦点直接落在「回到总览」上：键盘用户按 Enter 就走，不用先 Tab 找按钮。
  // 结算是在压力测试列表底部点出来的，页面还停在那个滚动位置；先把结算屏的标题拉回视野。
  useEffect(() => {
    sectionRef.current?.scrollIntoView?.({ block: "start" });
    backRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (shortcutBlocked(event.target)) return;
      // 焦点在按钮、链接、summary 上时 Enter 归它自己（例如展开升阶条目）。
      if ((event.target as Element | null)?.closest?.("button, a, summary")) return;
      event.preventDefault();
      if (!leaving) onLeave();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [leaving, onLeave]);

  return (
    <section ref={sectionRef} className="language-settle" aria-labelledby="language-settle-title">
      <header className="language-settle-head">
        <div>
          <small>ROUND COMPLETE · {t("本轮结算")}</small>
          <h1 id="language-settle-title">{settlement.date} · {t("{count} 项集中训练", { count: settlement.targetSize })}</h1>
        </div>
        <p>{t("本次专注 {time}", { time: formatClock(elapsedMs) })}</p>
      </header>

      {settlement.kind === "full" ? (
        <FullSettlementBody settlement={settlement} itemById={itemById} />
      ) : (
        <div className="language-settle-brief">
          <p>{t("这一批已经结算过")}</p>
          <dl>
            <div><dt>{t("完成项目")}</dt><CountUp as="dd" value={settlement.completedCount} /></div>
            <div><dt>{t("命中次数")}</dt><CountUp as="dd" value={settlement.successCount} /></div>
          </dl>
        </div>
      )}

      <footer className="language-settle-foot">
        <button ref={backRef} type="button" disabled={leaving} onClick={onLeave}>
          {leaving ? `${t("正在刷新资料")}…` : t("回到总览")}
          <kbd aria-hidden="true">Enter</kbd>
        </button>
      </footer>
    </section>
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
      <header><div><small>{phase === "compile" ? "PHASE 2 · COMPILE" : "PHASE 3 · STRESS"}</small><h1>{title}</h1></div><div><strong>{answered}</strong><span>/ {itemIds.length}</span></div></header>
      <details className="language-input-guide language-operation-help">
        <summary>操作与评分说明</summary>
        <p>{description}</p>
        {phase === "compile" ? (
          <>
            <strong>本阶段只做短项主动提取</strong>
            <p>使用日语输入法，根据中文功能输入一个日语词块；错误修正题只写修正后的表达。输入后再展开目标自查，不需要重新回答整道面试题。</p>
            <small>评分：忽略空格和标点，与目标词块或确认修正完全匹配。</small>
          </>
        ) : (
          <>
            <strong>压力测试分两种评分</strong>
            <p>普通题只输入目标词块，由本地匹配；“回答结构”题才用日语写2–3句，并由 Codex 检查题意覆盖、结论先行、自然度和事实安全。</p>
          </>
        )}
      </details>
      {!itemIds.length ? (
        <section className="language-no-input"><strong>这一阶段没有待处理项目</strong><p>扫描中没有标记“犹豫/不会”，系统会从“已会”中抽样进入压力测试。</p></section>
      ) : (
        <div className="language-input-list">
          {itemIds.map((id, index) => {
            const value = itemById.get(id);
            if (!value) return null;
            const result = resultFor(id);
            const open = phase === "stress" && value.kind === "answer_strategy";
            return (
              <article key={id}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <div className="prompt"><small>{KIND_LABELS[value.kind]}{value.pattern ? ` · ${ISSUE_DISPLAY_LABELS[value.pattern] ?? value.pattern}` : ""}</small><strong>{phase === "compile" && value.kind === "error_patch" ? value.promptZh : value.meaningZh}</strong>{phase === "compile" && value.originalJa && <code lang="ja">{value.originalJa}</code>}</div>
                <label>
                  {open ? (
                    <textarea rows={4} value={answers[id] ?? ""} onChange={(event) => onAnswer(id, phase, event.target.value)} placeholder="用日语写2–3句：先说结论，再给一个依据…" />
                  ) : (
                    <input lang="ja" value={answers[id] ?? ""} onChange={(event) => onAnswer(id, phase, event.target.value)} placeholder={phase === "compile" ? "只输入一个词块或修正表达" : "输入目标日语词块"} />
                  )}
                  {result && <span className={result.passed ? "pass" : "fail"}>{result.passed ? "✓ 已命中" : "× 继续复练"}</span>}
                </label>
                {phase === "compile" && (
                  <details className="answer">
                    <summary>输入后查看目标</summary>
                    <strong lang="ja">{value.correctedJa || value.targetJa}</strong>
                  </details>
                )}
              </article>
            );
          })}
        </div>
      )}
      <button className="language-stage-next" disabled={disabled} onClick={onNext}>{nextLabel} →</button>
    </main>
  );
}

// 外壳的 UI state（⌘K・overlay）变化时不重渲染整个视圖。props 都是稳定引用。
export default memo(JapaneseTraining);
