"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import type {
  LanguageItemProgress,
  LanguageLearningItem,
  LanguageLearningItemKind,
  LanguageTrainingStage,
  LanguageV2State,
} from "@/lib/language/types";
import type { QuickSettings, QuickSummary } from "@/lib/language/quick-types";
import { QUICK_SET_SIZES } from "@/lib/language/quick-types";
import { tokyoParts } from "@/lib/dojo/utils";
import { dailyTraining, heatLevel, stageDistribution, trainingStreak, type StageShare } from "@/lib/training-rhythm";
import { CountUp } from "./count-up";
import { quickShortcutBlocked, yieldsToNative } from "./language-quick-drill";
import { quickFreshLeft, quickMinutes, useQuickCopy } from "./language-quick-sync";

/*
 * 快练总览：入口卡、节奏带、今日两栏，以及「能力画像 / 问题地图 / 训练语料」三个洞察标签。
 * 「今日训练」只依赖轻量的 quick/summary；三个洞察标签要完整课程状态（约 1.5MB），第一次点开才取。
 */

export type QuickTab = "today" | "profile" | "issues" | "library";

export const KIND_LABELS: Record<LanguageLearningItemKind, string> = {
  active_chunk: "主动词块",
  error_patch: "错误修正",
  interviewer_phrase: "面试官表达",
  answer_strategy: "回答结构",
  technical_term: "岗位技术",
  fact_anchor: "事实口径",
};

export const STAGE_LABELS: Record<LanguageTrainingStage, string> = {
  unseen: "未见过",
  recognized: "能识别",
  correctable: "能修正",
  retrievable: "能主动提取",
  transferable: "能迁移使用",
  stable: "训练稳定",
};

export const ISSUE_DISPLAY_LABELS: Record<string, string> = {
  "compound-question-miss": "复合问题漏答",
  "weak-evidence": "回答缺少事实证据",
  "over-absolute": "表述过于绝对",
  "negative-oversharing": "负面信息展开过多",
};

const STAGE_ORDER = Object.keys(STAGE_LABELS) as LanguageTrainingStage[];

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

function sharesFromCounts(counts: Record<LanguageTrainingStage, number>): StageShare[] {
  const total = STAGE_ORDER.reduce((sum, stage) => sum + (counts[stage] ?? 0), 0);
  return STAGE_ORDER.map((stage) => {
    const count = counts[stage] ?? 0;
    return { stage, count, share: total ? count / total : 0 };
  });
}

/**
 * 总览的节奏带：连续天数、近 14 天热度、掌握阶段分布。
 * 快练的 summary 只给阶段计数、不给逐条进度，所以多一个可选的 stageCounts；不给时仍按 progress 算。
 */
export function TrainingPulse({
  state,
  today: fixedToday,
  stageCounts,
}: {
  state: Pick<LanguageV2State, "history" | "progress">;
  today?: string;
  stageCounts?: Record<LanguageTrainingStage, number>;
}) {
  const { t, label } = useQuickCopy();
  const liveToday = useJstToday();
  const today = fixedToday ?? liveToday;
  const streak = useMemo(
    () => today ? trainingStreak(state.history, today) : { days: 0, status: "none" as const },
    [state.history, today],
  );
  const days = useMemo(() => today ? dailyTraining(state.history, 14, today) : [], [state.history, today]);
  const shares = useMemo(
    () => stageCounts ? sharesFromCounts(stageCounts) : stageDistribution(state.progress),
    [stageCounts, state.progress],
  );
  const total = stageCounts ? shares.reduce((sum, value) => sum + value.count, 0) : state.progress.length;
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
        <header><small>{t("掌握阶段分布")}</small><span>{total}</span></header>
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
        <p className="focus-pulse-stage-note">{t("阶段条件说明")}</p>
      </div>
    </section>
  );
}

/** 首次读取前数字显示「—」，不先闪一排 0。 */
const dash = (value: number | undefined) => value === undefined ? "—" : value;

export function QuickStartCard({
  summary,
  settings,
  busy,
  exhausted,
  onSettings,
  onStart,
}: {
  summary: QuickSummary | null;
  settings: QuickSettings;
  busy: boolean;
  exhausted: boolean;
  onSettings: (patch: Partial<QuickSettings>) => void;
  onStart: (extra?: boolean) => void;
}) {
  const { t } = useQuickCopy();
  const fresh = summary ? quickFreshLeft(summary) : undefined;
  const seed = summary ? summary.seedRemaining.unknown + summary.seedRemaining.uncertain : undefined;
  // 额度用完、题库里还有新题：给一个明确的「再加一组新题」，而不是让「开始」默默只出复习。
  const extraAvailable = Boolean(summary && summary.newAvailable > 0 && (exhausted || summary.newToday >= summary.dailyNewLimit));

  return (
    <section className="quick-start" aria-labelledby="quick-start-title">
      <span className="quick-start-mark" aria-hidden="true">語</span>
      <div className="quick-start-copy">
        <small>{t("快练")}</small>
        <h2 id="quick-start-title">{t("开始快练")}</h2>
        <p className="quick-start-numbers">
          {t("到期 {due} · 新题 {fresh} · 约 {minutes} 分钟", { due: dash(summary?.due), fresh: dash(fresh), minutes: quickMinutes(settings.size) })}
        </p>
      </div>
      <div className="quick-size" role="group" aria-label={t("每组")}>
        {QUICK_SET_SIZES.map((size) => (
          <button key={size} type="button" aria-pressed={settings.size === size} onClick={() => onSettings({ size })}>
            {t("{count} 题", { count: size })}
          </button>
        ))}
      </div>
      <div className="quick-start-actions">
        <button
          type="button"
          className="quick-primary"
          disabled={busy || !summary?.ready}
          aria-keyshortcuts="Enter"
          onClick={() => onStart(false)}
        >
          {t("开始 {count} 题", { count: settings.size })}<kbd aria-hidden="true">Enter</kbd>
        </button>
        {extraAvailable && (
          <button type="button" className="quick-secondary" disabled={busy} onClick={() => onStart(true)}>{t("再加一组新题")}</button>
        )}
      </div>
      <dl className="quick-start-facts">
        <div>
          <dt>{t("设置")}</dt>
          <dd>
            <button
              type="button"
              role="switch"
              className="quick-switch"
              aria-checked={settings.typing}
              onClick={() => onSettings({ typing: !settings.typing })}
            >
              <i aria-hidden="true" /><span>{t("打字题")}</span>
            </button>
            <small>{t("打字题说明")}</small>
          </dd>
        </div>
        <div>
          <dt>{t("首批优先")}</dt>
          <dd>
            {summary && seed === 0
              ? t("首批优先已做完")
              : t("首批优先剩余", { total: dash(seed), unknown: dash(summary?.seedRemaining.unknown), uncertain: dash(summary?.seedRemaining.uncertain) })}
          </dd>
        </div>
        <div>
          <dt>{t("暂不出题")}</dt>
          <dd>
            {t("待补中文释义 {count} 条", { count: dash(summary?.excludedJaMeaning) })}
            <small>{t("単語文法帳 {count} 条", { count: dash(summary?.notebookParsed) })}</small>
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function QuickTodayColumns({ summary }: { summary: QuickSummary | null }) {
  const { t } = useQuickCopy();
  const recent = (summary?.history ?? []).slice(0, 5);
  return (
    <section className="focus-language-two-column">
      <div>
        <header><h2>{t("现在最值得修")}</h2></header>
        {(summary?.topIssues ?? []).slice(0, 8).map((issue, index) => (
          <article className="focus-issue-compact" key={issue.key}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            <div>
              <strong title={issue.label}>{ISSUE_DISPLAY_LABELS[issue.label] ?? issue.label}</strong>
              <span>{t("{interviews} 场 · {count} 次证据", { interviews: issue.interviewCount, count: issue.occurrenceCount })}</span>
            </div>
          </article>
        ))}
      </div>
      <div>
        <header><h2>{t("最近练习")}</h2></header>
        {recent.length ? recent.map((entry) => (
          <article className="focus-history-row quick-history-row" key={entry.id}>
            <time>{entry.date}</time>
            <strong>{entry.completedCount} / {entry.targetSize}</strong>
            {/* 快练的 successCount＝这一组首答答对数（自评不算答对）。 */}
            <em>{t("命中 {count}", { count: entry.successCount })}</em>
          </article>
        )) : <p className="focus-language-muted">{t("完成第一组后")}</p>}
      </div>
    </section>
  );
}

function PanelSkeleton({ label }: { label: string }) {
  return (
    <div className="focus-language-loading" role="status">
      <p>{label}</p>
      <div className="focus-language-skeleton" aria-hidden="true">
        <i className="skeleton now" />
        <span className="columns"><i className="skeleton" /><i className="skeleton" /></span>
      </div>
    </div>
  );
}

export type QuickOverviewProps = {
  summary: QuickSummary | null;
  loading: boolean;
  error: string;
  notice: string;
  busy: string;
  settings: QuickSettings;
  exhausted: boolean;
  tab: QuickTab;
  fullState: LanguageV2State | null;
  stateLoading: boolean;
  stateError: string;
  today?: string;
  onSettings: (patch: Partial<QuickSettings>) => void;
  onStart: (extra?: boolean) => void;
  onRebuild: () => void;
  onRetry: () => void;
  onTab: (tab: QuickTab) => void;
};

export function QuickOverview(props: QuickOverviewProps) {
  const { summary, loading, error, notice, busy, settings, exhausted, tab, fullState, stateLoading, stateError } = props;
  const { onStart, onTab } = props;
  const { t, label } = useQuickCopy();
  const ready = Boolean(summary?.ready);
  const canStart = ready && !busy;

  // 总览里 Enter 直接开始；焦点在按钮、链接、summary 上时 Enter 归它们自己。
  useEffect(() => {
    if (!canStart) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || quickShortcutBlocked(event) || yieldsToNative(event)) return;
      event.preventDefault();
      onStart(false);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [canStart, onStart]);

  const stages = summary?.stageCounts;
  // 「已学会」＝至少有一天首答答对（correctable 及以上）。能主动提取、稳定要隔天多次答对，
  // 放在顶部的话练完一组四个数字几乎都不动，看不出这组练了什么；它们留在下面的阶段分布里。
  const learned = stages ? stages.correctable + stages.retrievable + stages.transferable + stages.stable : undefined;
  const fresh = summary ? quickFreshLeft(summary) : undefined;
  const pulseState = useMemo(() => ({ history: summary?.history ?? [], progress: [] as LanguageItemProgress[] }), [summary?.history]);

  return (
    <div className="focus-language-view quick-overview">
      <dl className="focus-language-glance page-stat-strip module-stat-strip" aria-label={t("日语训练摘要")}>
        <div>
          <dt>{t("今天已练")}</dt>
          <dd>{dash(summary?.answeredToday)}{summary && summary.answeredToday > 0 && <small>{t("答对 {count}", { count: summary.firstPassToday })}</small>}</dd>
        </div>
        <div title={t("至少有一天首答答对的条目")}><dt>{t("已学会")}</dt><dd>{dash(learned)}</dd></div>
        <div>
          <dt>{t("待复习")}</dt>
          <dd>{dash(summary?.due)}{summary && <small>{t("明天 {count}", { count: summary.dueTomorrow ?? 0 })}</small>}</dd>
        </div>
        <div><dt>{t("未练新题")}</dt><dd>{dash(summary?.newAvailable)}</dd></div>
      </dl>

      {(error || notice || busy) && (
        <div className={`focus-language-message ${error ? "error" : busy ? "working" : "success"}`} role={error ? "alert" : "status"}>
          {error || (busy ? `${busy}…` : notice)}
          {error && !summary && <button type="button" className="quick-inline-action" onClick={props.onRetry}>{t("重试")}</button>}
        </div>
      )}

      {summary && !summary.ready ? (
        <section className="focus-language-empty">
          <b>語</b>
          <div>
            <small>FIRST INDEX</small>
            <h2>{t("从已有面试复盘建立第一份课程")}</h2>
            <p>{t("建立说明")}</p>
          </div>
          <button type="button" disabled={Boolean(busy)} onClick={props.onRebuild}>{t("建立训练画像")}</button>
        </section>
      ) : summary || loading ? (
        <>
          {summary?.stale && (
            <section className="focus-language-stale">
              <div><strong>{t("面试或岗位资料已经更新")}</strong><span>{t("更新后新证据才会出题")}</span></div>
              <button type="button" disabled={Boolean(busy)} onClick={props.onRebuild}>{t("更新训练画像")}</button>
            </section>
          )}

          <nav className="focus-language-tabs" aria-label={t("日语训练")}>
            {([
              ["today", "今日训练"],
              ["profile", "能力画像"],
              ["issues", "问题地图"],
              ["library", "训练语料"],
            ] as const).map(([key, name]) => (
              <button key={key} type="button" className={tab === key ? "active" : ""} aria-pressed={tab === key} onClick={() => onTab(key)}>{label(name)}</button>
            ))}
          </nav>

          {tab === "today" ? (
            <>
              <QuickStartCard
                summary={summary}
                settings={settings}
                busy={Boolean(busy) || !summary}
                exhausted={exhausted}
                onSettings={props.onSettings}
                onStart={onStart}
              />
              <div className="focus-language-dashboard">
                <TrainingPulse state={pulseState} stageCounts={stages} today={props.today} />
                <QuickTodayColumns summary={summary} />
              </div>
            </>
          ) : (
            <>
              <section className="focus-language-resume" aria-label={t("开始快练")}>
                <span>{t("到期 {due} · 新题 {fresh}", { due: dash(summary?.due), fresh: dash(fresh) })}</span>
                <button type="button" disabled={!canStart} onClick={() => onStart(false)}>
                  {t("开始快练")}<span aria-hidden="true"> →</span>
                </button>
              </section>
              {fullState?.curriculum ? (
                <>
                  {tab === "profile" && <AbilityProfile state={fullState} />}
                  {tab === "issues" && <IssueMap state={fullState} />}
                  {tab === "library" && <LanguageLibrary items={fullState.curriculum.items} progress={fullState.progress} />}
                </>
              ) : stateError ? (
                <div className="focus-language-message error" role="alert">
                  {stateError}
                  <button type="button" className="quick-inline-action" onClick={() => onTab(tab)}>{t("重试")}</button>
                </div>
              ) : stateLoading || !fullState ? (
                <PanelSkeleton label={t("正在读取训练画像")} />
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

// ── 洞察标签（从旧集中训练原样搬来；只读完整课程状态） ─────────────────

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
  progress: progressList,
}: {
  items: LanguageLearningItem[];
  progress: LanguageItemProgress[];
}) {
  const { t, label: menuLabel } = useQuickCopy();
  const [kind, setKind] = useState<LanguageLearningItemKind | "all">("all");
  const progress = useMemo(() => new Map(progressList.map((value) => [value.itemId, value])), [progressList]);
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
