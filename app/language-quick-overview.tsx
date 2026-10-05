"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
import type {
  LanguageItemProgress,
  LanguageLearningItem,
  LanguageLearningItemKind,
  LanguageTrainingStage,
  LanguageV2State,
} from "@/lib/language/types";
import type { QuickItemBrief, QuickSettings, QuickSummary, QuickTopIssue } from "@/lib/language/quick-types";
import { QUICK_SET_SIZES } from "@/lib/language/quick-types";
import { quickDay } from "@/lib/language/quick-progress";
import { tokyoParts } from "@/lib/dojo/utils";
import { STRATEGY_TREND_META } from "@/lib/interview-trends.mjs";
import { dailyTraining, heatLevel, stageDistribution, trainingStreak, type StageShare } from "@/lib/training-rhythm";
import { CountUp } from "./count-up";
import { quickShortcutBlocked, yieldsToNative } from "./language-quick-drill";
import {
  QUICK_GROUP_COPY,
  quickDueSoonTotal,
  quickFreshLeft,
  quickMinutes,
  useQuickCopy,
  type QuickCopyKey,
} from "./language-quick-sync";

/*
 * 快练总览：入口卡、节奏带、今日两栏，以及「能力画像 / 问题地图 / 训练语料」三个洞察标签。
 * 「今日训练」只依赖轻量的 quick/summary；三个洞察标签要完整课程状态（约 1.5MB），第一次点开才取，
 * 练完一组后外壳把它作废，下次点开重取。能力画像的阶段格用 summary 的计数，与今日训练同一口径。
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

const STAGE_NOTES: Record<LanguageTrainingStage, QuickCopyKey> = {
  unseen: "未见过说明",
  recognized: "能识别说明",
  correctable: "能修正说明",
  retrievable: "能主动提取说明",
  transferable: "能迁移使用说明",
  stable: "训练稳定说明",
};

/**
 * 回答策略问题的中文名以 lib/interview-trends.mjs 为正本（复盘页也用它）；服务端已给中文时直接用服务端的。
 * 日文界面补一份日文名：这几项是英文 slug，原样显示等于没翻译。
 */
const STRATEGY_LABELS_JA: Record<string, string> = {
  "compound-question-miss": "複合質問の答え漏れ",
  "no-conclusion-first": "結論を先に言わない",
  "negative-oversharing": "不利な情報を自分から広げる",
  "weak-evidence": "根拠が弱い",
  "over-absolute": "言い切りが強すぎる",
  "role-mismatch": "職種への期待とずれる",
  "numbers-confusion": "数字の基準がぶれる",
};

const STRATEGY_META = STRATEGY_TREND_META as Record<string, { label: string; description: string }>;
const isSlug = (value: string) => /^[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(value);

/** 显示用的问题名：服务端给的中文优先；还是英文 slug 时按正本表翻译。 */
export function issueDisplayLabel(issue: Pick<QuickTopIssue, "key" | "label">, locale: string) {
  const slug = [issue.label, issue.key].find((value) => STRATEGY_META[value]);
  if (locale === "ja" && slug && STRATEGY_LABELS_JA[slug]) return STRATEGY_LABELS_JA[slug];
  if (!isSlug(issue.label)) return issue.label;
  return slug ? STRATEGY_META[slug].label : issue.label;
}

/** 策略类：服务端标了 kind，或者名字就是回答策略的 slug（旧服务端不给 kind）。 */
export function isStrategyIssue(issue: Pick<QuickTopIssue, "key" | "label" | "kind">) {
  if (issue.kind) return issue.kind === "strategy";
  return Boolean(STRATEGY_META[issue.key] || STRATEGY_META[issue.label]);
}

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

// 「今天」按练习日订阅而不是在渲染里直接读时钟：服务端快照为空，水合前后一致；
// 页面挂过 04:00 时每分钟的检查会把热度条与连续天数换到新的一天。
// 用练习日（日本时间 04:00 起算）而不是日历日：历史按练习日归日，0:30 练完的一组属于前一天，
// 按日历日算会在 0–4 点显示「今天还没练」、热度格落在空的一天上。
function subscribeMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}
const jstTodaySnapshot = () => quickDay(new Date().toISOString());
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
    : streak.status === "holding" ? t("保持中 · 今天还没练") : t("完成一组后开始计数");

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
              title={day.batches ? `${t("{day} · {sets} 组 · {items} 题", { day: day.day, sets: day.batches, items: day.items })} · ${t("答对 {count}", { count: day.hits })}` : day.day}
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

/** 入口卡的主句：有 nextSet 就写这一组的构成；旧服务端不给时退回「今天到期 · 新题额度」。 */
function startLine(summary: QuickSummary | null, settings: QuickSettings, t: ReturnType<typeof useQuickCopy>["t"]) {
  const next = summary?.nextSet;
  if (!next) {
    const fresh = summary ? quickFreshLeft(summary) : undefined;
    return t("到期 {due} · 新题 {fresh} · 约 {minutes} 分钟", { due: dash(summary?.due), fresh: dash(fresh), minutes: quickMinutes(settings.size) });
  }
  return t("本组 {total} 题＝复习 {review}＋新题 {fresh} · 约 {minutes} 分钟", {
    total: next.total,
    review: next.due + next.lapsed + next.early,
    fresh: next.fresh,
    minutes: quickMinutes(Math.max(1, next.total)),
  });
}

/** 本组不满 N 题时的原因：额度用完，还是确实没有更多可出的题。 */
function shortfallLine(summary: QuickSummary | null, settings: QuickSettings, t: ReturnType<typeof useQuickCopy>["t"]) {
  const next = summary?.nextSet;
  if (!summary || !next || next.total <= 0 || next.total >= settings.size) return "";
  // 题库里还有本组没放进来的新题、而今天剩下的额度不比本组的新题多：卡住的是额度，不是题源。
  const quotaSpent = summary.newAvailable > next.fresh && quickFreshLeft(summary) <= next.fresh;
  return t(quotaSpent ? "本组不满：额度" : "本组不满：没有更多", { count: next.total });
}

export function QuickStartCard({
  summary,
  settings,
  busy,
  exhausted,
  restored,
  onSettings,
  onStart,
  onTriage,
  onRestore,
}: {
  summary: QuickSummary | null;
  settings: QuickSettings;
  busy: boolean;
  exhausted: boolean;
  /** 本次打开里已经点过「恢复」的条目：汇总重取之前先从清单里拿掉。 */
  restored?: ReadonlySet<string>;
  onSettings: (patch: Partial<QuickSettings>) => void;
  onStart: (extra?: boolean) => void;
  onTriage?: () => void;
  onRestore?: (item: QuickItemBrief) => void;
}) {
  const { t, pick } = useQuickCopy();
  const fresh = summary ? quickFreshLeft(summary) : undefined;
  const seed = summary ? summary.seedRemaining.unknown + summary.seedRemaining.uncertain : undefined;
  // 额度用完、题库里还有新题：给一个明确的「再加一组新题」，而不是让「开始」默默只出复习。
  const extraAvailable = Boolean(summary && summary.newAvailable > 0 && (exhausted || summary.newToday >= summary.dailyNewLimit));
  const shortfall = shortfallLine(summary, settings, t);
  const triageLeft = summary?.triageRemaining ?? 0;
  const listed = summary?.suspended ?? [];
  const suspended = listed.filter((item) => !restored?.has(item.itemId));
  // 只扣掉「汇总里还列着、本地已点恢复」的那几条：保存应答带回的汇总已经不含刚恢复的条目，
  // 再按 restored.size 扣一次，总数会在重取汇总之前少一（只剩一条时整个清单闪没）。
  const suspendedCount = Math.max(0, (summary?.suspendedCount ?? listed.length) - (listed.length - suspended.length));

  return (
    <section className="quick-start" aria-labelledby="quick-start-title">
      <span className="quick-start-mark" aria-hidden="true">語</span>
      <div className="quick-start-copy">
        <small>{t("快练")}</small>
        <h2 id="quick-start-title">{t("开始快练")}</h2>
        <p className="quick-start-numbers">{startLine(summary, settings, t)}</p>
        {summary?.nextSet && (
          <p className="quick-start-quota">
            {t("今天还可学新题 {count}", { count: dash(fresh) })}
            {shortfall && <span> · {shortfall}</span>}
          </p>
        )}
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
        {onTriage && triageLeft > 0 && (
          <button type="button" className="quick-secondary quick-triage-entry" disabled={busy} title={t("快速过一遍说明")} onClick={onTriage}>
            {t("快速过一遍（还剩 {count} 条）", { count: triageLeft })}
          </button>
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
            <button
              type="button"
              role="switch"
              className="quick-switch"
              aria-checked={settings.autoAdvance}
              onClick={() => onSettings({ autoAdvance: !settings.autoAdvance })}
            >
              <i aria-hidden="true" /><span>{t("答对自动下一题")}</span>
            </button>
            <small>{t("答对自动下一题说明")}</small>
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
            {Boolean(summary?.glossed) && <small>{t("中文释义表补上 {count} 条", { count: summary!.glossed! })}</small>}
            <small>{t("単語文法帳 {count} 条", { count: dash(summary?.notebookParsed) })}</small>
            {Boolean(summary?.orphanEvents) && <small className="quick-warn">{t("{count} 条练习记录对不上", { count: summary!.orphanEvents! })}</small>}
          </dd>
        </div>
      </dl>
      {suspendedCount > 0 && (
        <details className="quick-excluded">
          <summary>{t("已排除 {count} 条", { count: suspendedCount })}</summary>
          <p>{t("已排除说明")}{suspendedCount > suspended.length && ` ${t("只列最近 {count} 条", { count: suspended.length })}`}</p>
          <ul>
            {suspended.map((item) => (
              <li key={item.itemId}>
                <span className="quick-excluded-group">{pick(QUICK_GROUP_COPY[item.group] ?? ["", ""])}</span>
                <strong lang="ja">{item.wrong ? <><s>{item.wrong}</s> → {item.ja}</> : item.ja}</strong>
                {item.meaning && <small>{item.meaning}</small>}
                <button type="button" className="quick-inline-action" disabled={!onRestore} onClick={() => onRestore?.(item)}>{t("恢复")}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** 最近练习行的时间：完成时刻的 JST「月-日 时:分」，没有时只写日期。 */
function historyTime(entry: { date: string; completedAt?: string }) {
  const at = entry.completedAt ? new Date(entry.completedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return entry.date.slice(5);
  const { date, time } = tokyoParts(at);
  return `${date.slice(5)} ${time.slice(0, 5)}`;
}

export function QuickTodayColumns({
  summary,
  busy = false,
  onFocus,
}: {
  summary: QuickSummary | null;
  busy?: boolean;
  /** 「练这个」：以该错误型取一组。 */
  onFocus?: (focus: string, label: string) => void;
}) {
  const { t, locale } = useQuickCopy();
  const recent = (summary?.history ?? []).slice(0, 5);
  const issues = (summary?.topIssues ?? []).slice(0, 8);
  const hasStrategy = issues.some(isStrategyIssue);
  return (
    <section className="focus-language-two-column">
      <div>
        <header><h2>{t("现在最值得修")}</h2></header>
        {issues.map((issue, index) => {
          const name = issueDisplayLabel(issue, locale);
          const strategy = isStrategyIssue(issue);
          return (
            <article className={`focus-issue-compact${strategy ? " is-strategy" : ""}`} key={issue.key}>
              <b>{String(index + 1).padStart(2, "0")}</b>
              <div>
                <strong title={issue.label}>{name}</strong>
                <span>
                  {strategy
                    ? t("{interviews} 场", { interviews: issue.interviewCount })
                    : t("{interviews} 场 · {count} 次证据", { interviews: issue.interviewCount, count: issue.occurrenceCount })}
                  {!strategy && issue.itemCount ? ` · ${t("可练 {count} 条", { count: issue.itemCount })}` : ""}
                </span>
              </div>
              {!strategy && issue.focus && onFocus && (
                <button
                  type="button"
                  className="quick-focus-button"
                  disabled={busy}
                  aria-label={t("练这个：{label}", { label: name })}
                  onClick={() => onFocus(issue.focus!, name)}
                >
                  {t("练这个")}
                </button>
              )}
            </article>
          );
        })}
        {hasStrategy && <p className="quick-strategy-note">{t("策略类说明")}</p>}
      </div>
      <div>
        <header><h2>{t("最近练习")}</h2></header>
        {recent.length ? recent.map((entry) => {
          const time = historyTime(entry);
          // 快练的 successCount＝这一组首答答对数（自评不算答对），gradedCount＝自动判分的首答数。
          const line = entry.gradedCount
            ? t("{time} · {count} 题 · 答对 {correct} / {graded}", { time, count: entry.completedCount, correct: entry.successCount, graded: entry.gradedCount })
            : t("{time} · {count} 题 · 答对 {correct}", { time, count: entry.completedCount, correct: entry.successCount });
          return (
            <article className="focus-history-row quick-history-row" key={entry.id}>
              <span>{line}</span>
            </article>
          );
        }) : <p className="focus-language-muted">{t("完成第一组后")}</p>}
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
  restored?: ReadonlySet<string>;
  onSettings: (patch: Partial<QuickSettings>) => void;
  onStart: (extra?: boolean) => void;
  onRebuild: () => void;
  onRetry: () => void;
  onTab: (tab: QuickTab) => void;
  onTriage?: () => void;
  onFocus?: (focus: string, label: string) => void;
  onRestore?: (item: QuickItemBrief) => void;
};

export function QuickOverview(props: QuickOverviewProps) {
  const { summary, loading, error, notice, busy, settings, exhausted, tab, fullState, stateLoading, stateError } = props;
  const { onStart, onTab } = props;
  const { t, label } = useQuickCopy();
  const ready = Boolean(summary?.ready);
  const canStart = ready && !busy;

  // 总览里 Enter 直接开始，但只在「今日训练」标签下：在训练语料里浏览时碰到 Enter 不该被带进一组题。
  // 焦点在按钮、链接、summary 上时 Enter 归它们自己。
  useEffect(() => {
    if (!canStart || tab !== "today") return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || quickShortcutBlocked(event) || yieldsToNative(event)) return;
      event.preventDefault();
      onStart(false);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [canStart, onStart, tab]);

  const stages = summary?.stageCounts;
  // 「已学会」＝至少有一天首答答对（correctable 及以上）。能主动提取、稳定要隔天多次答对，
  // 放在顶部的话练完一组四个数字几乎都不动，看不出这组练了什么；它们留在下面的阶段分布里。
  const learned = stages ? stages.correctable + stages.retrievable + stages.transferable + stages.stable : undefined;
  const pulseState = useMemo(() => ({ history: summary?.history ?? [], progress: [] as LanguageItemProgress[] }), [summary?.history]);
  // 「明天 0」会让人以为昨天练的题没进复习（它们按 3 天间隔排在后天）；有 7 天预告时改写 7 天内的总数。
  const dueAside = summary
    ? summary.dueSoon ? t("7 天内 {count}", { count: quickDueSoonTotal(summary) }) : t("明天 {count}", { count: summary.dueTomorrow ?? 0 })
    : "";

  return (
    <div className="focus-language-view quick-overview">
      <dl className="focus-language-glance page-stat-strip module-stat-strip" aria-label={t("日语训练摘要")}>
        <div>
          <dt>{t("今天已练")}</dt>
          <dd>{dash(summary?.answeredToday)}{summary && summary.answeredToday > 0 && <small>{t("答对 {count}", { count: summary.firstPassToday })}</small>}</dd>
        </div>
        <div title={t("至少有一天首答答对的条目")}><dt>{t("已学会")}</dt><dd>{dash(learned)}</dd></div>
        <div title={summary?.dueSoon ? t("未来 7 天到期") : undefined}>
          <dt>{t("待复习")}</dt>
          <dd>{dash(summary?.due)}{summary && <small>{dueAside}</small>}</dd>
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
                restored={props.restored}
                onSettings={props.onSettings}
                onStart={onStart}
                onTriage={props.onTriage}
                onRestore={props.onRestore}
              />
              <div className="focus-language-dashboard">
                <TrainingPulse state={pulseState} stageCounts={stages} today={props.today} />
                <QuickTodayColumns summary={summary} busy={!canStart} onFocus={props.onFocus} />
              </div>
            </>
          ) : (
            <>
              <section className="focus-language-resume" aria-label={t("开始快练")}>
                <span>{startLine(summary, settings, t)}</span>
                <button type="button" disabled={!canStart} onClick={() => onStart(false)}>
                  {t("开始快练")}<span aria-hidden="true"> →</span>
                </button>
              </section>
              {fullState?.curriculum ? (
                <>
                  {tab === "profile" && <AbilityProfile state={fullState} summary={summary} />}
                  {tab === "issues" && <IssueMap state={fullState} summary={summary} busy={!canStart} onFocus={props.onFocus} />}
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

// ── 洞察标签（只读完整课程状态；阶段数字与今日训练同一来源） ─────────────

function AbilityProfile({ state, summary }: { state: LanguageV2State; summary: QuickSummary | null }) {
  const { t, label } = useQuickCopy();
  const profile = state.curriculum!.profile;
  // 阶段格读 summary.stageCounts：完整状态的 progress 覆盖全部课程条目（含快练不出的），
  // 和今日训练写的数字对不上，本人无从知道哪个对。没有 summary 时才退回逐条进度。
  const counts = summary?.stageCounts;
  return (
    <div className="focus-language-panel-page">
      <header><h2>{t("能力画像")}</h2></header>
      <section className="focus-profile-summary">
        <div><strong>{profile.interviewCount}</strong><span>{t("结构化面试")}</span></div>
        <div><strong>{profile.learnerErrorCount}</strong><span>{t("已确认本人错误")}</span></div>
        <div><strong>{profile.reviewedBlockCount}</strong><span>{t("回答复盘块")}</span></div>
        <div><strong>{profile.listeningGapCount}</strong><span>{t("本人标记听解缺口")}</span></div>
      </section>
      {!profile.listeningGapCount && <p className="focus-evidence-note">{t("听解说明")}</p>}
      {summary && (
        <p className="quick-profile-scope">{t("能力画像范围", { drillable: summary.drillable, notebook: summary.notebookParsed })}</p>
      )}
      <section className="focus-stage-grid">
        {STAGE_ORDER.map((stage) => (
          <article key={stage}>
            <strong>{counts ? counts[stage] ?? 0 : state.progress.filter((value) => value.stage === stage).length}</strong>
            <span>{label(STAGE_LABELS[stage])}</span>
            <small>{t(STAGE_NOTES[stage])}</small>
          </article>
        ))}
      </section>
      {!!profile.staleReviewPaths.length && (
        <section className="focus-review-warning"><strong>{t("深度复盘晚于本人反馈")}</strong>{profile.staleReviewPaths.map((path) => <code key={path}>{path}</code>)}</section>
      )}
    </div>
  );
}

function IssueMap({
  state,
  summary,
  busy,
  onFocus,
}: {
  state: LanguageV2State;
  summary: QuickSummary | null;
  busy: boolean;
  onFocus?: (focus: string, label: string) => void;
}) {
  const { t, label, locale } = useQuickCopy();
  const items = new Map(state.curriculum!.items.map((value) => [value.id, value]));
  // 能不能针对练习由服务端的 topIssues 决定（它知道该错误型下有几条可出题）；课程画像本身不带这个信息。
  const focusByKey = new Map((summary?.topIssues ?? []).filter((issue) => issue.focus).map((issue) => [issue.key, issue]));
  return (
    <div className="focus-language-panel-page">
      <header><h2>{t("跨面试复发模式")}</h2></header>
      <div className="focus-issue-map">
        {state.curriculum!.profile.topIssues.map((issue) => {
          const name = issueDisplayLabel(issue, locale);
          const strategy = issue.kind === "answer_strategy" || isStrategyIssue({ key: issue.key, label: issue.label });
          const focus = strategy ? undefined : focusByKey.get(issue.key);
          return (
            <details key={issue.key}>
              <summary>
                <span>{label(KIND_LABELS[issue.kind])}</span><strong title={issue.label}>{name}</strong>
                <b>{strategy
                  ? t("{interviews} 场", { interviews: issue.interviewCount })
                  : t("{interviews} 场 / {count} 次", { interviews: issue.interviewCount, count: issue.occurrenceCount })}</b>
              </summary>
              <div>
                {focus?.focus && onFocus && (
                  <p className="quick-issue-actions">
                    {focus.itemCount ? <span>{t("可练 {count} 条", { count: focus.itemCount })}</span> : null}
                    <button
                      type="button"
                      className="quick-focus-button"
                      disabled={busy}
                      aria-label={t("练这个：{label}", { label: name })}
                      onClick={() => onFocus(focus.focus!, name)}
                    >
                      {t("练这个")}
                    </button>
                  </p>
                )}
                {strategy && <p className="quick-strategy-note">{t("策略类说明")}</p>}
                {issue.itemIds.slice(0, 12).map((id) => {
                  const value = items.get(id);
                  return value ? (
                    <article key={id}>
                      <code>{value.originalJa || value.titleZh}</code>
                      <span>→</span><strong lang="ja">{value.targetJa}</strong>
                      <small>{value.evidence.map((entry) => `${entry.sentenceId || entry.blockId || t("来源")} · ${entry.path}`).join(" / ")}</small>
                    </article>
                  ) : null;
                })}
              </div>
            </details>
          );
        })}
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
      <header><h2>{t("个人词汇、语法和面试表达")}</h2></header>
      <div className="focus-library-filters">
        <button className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>{t("全部")} {items.length}</button>
        {(Object.keys(KIND_LABELS) as LanguageLearningItemKind[]).map((key) => (
          <button key={key} className={kind === key ? "active" : ""} onClick={() => setKind(key)}>{menuLabel(KIND_LABELS[key])} {items.filter((value) => value.kind === key).length}</button>
        ))}
      </div>
      <div className="focus-language-table">
        <div className="head"><span>{t("类型")}</span><span>{t("日语")}</span><span>{t("中文功能")}</span><span>{t("状态")}</span></div>
        {visible.map((value) => (
          <article key={value.id}>
            <small>{menuLabel(KIND_LABELS[value.kind])}</small>
            <div><strong lang="ja">{value.targetJa}</strong>{value.reading && <span lang="ja">{value.reading}</span>}</div>
            <p>{value.meaningZh}</p>
            <b>{menuLabel(STAGE_LABELS[progress.get(value.id)?.stage ?? "unseen"])}</b>
          </article>
        ))}
      </div>
    </div>
  );
}
