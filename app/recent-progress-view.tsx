"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { type Note } from "@/lib/notes";
import { buildRecentProgress, type RecentProgressEntry } from "@/lib/recent-progress";
import { buildRecentProgressOverview, progressTone } from "@/lib/recent-progress-overview";
import { PROGRESS_SEGMENTS } from "@/lib/recent-progress-dashboard";
import { validActionDate } from "@/lib/todo-action-schema";
import { useUiLocale } from "./ui-locale";
import { URL_CHANGE_EVENT } from "./use-url-state";
import ProgressDashboard from "./progress-dashboard";
import "./styles/recent-progress.css";
import "./styles/progress-tones.css";

const categories = ["all", "company", "work", "blocker"] as const;
export type RecentProgressCategory = typeof categories[number];
type ProgressRange = "7d" | "30d" | "all";
type ProgressView = "overview" | "timeline";
const openGroups = ["current", "advancing", "rejected", "waiting", "work", "scope", "sources"] as const;
export type RecentProgressRoute = { category: RecentProgressCategory; id: string | null; range: ProgressRange; view: ProgressView; open: string[]; chart?: string };
type ListPosition = { route: RecentProgressRoute; id: string; scrollY: number; anchorId?: string };

export const progressZh = {
  title: "最近进展", kicker: "进展与记录", introduction: "回看企业动态、已记录的处理与仍在阻碍的事项。",
  all: "全部", company: "案件动态", work: "处理与准备", blocker: "仍有阻碍", filters: "进展分类", records: "进展记录",
  loading: "正在读取进展记录…", refreshing: "正在更新资料…", error: "进展资料读取失败，请稍后重新载入。", stale: "当前显示上次已读取的记录。",
  empty: "当前可信资料中暂无可展示的进展。", emptyCategory: "此分类暂无可展示的记录。", notFound: "当前资料中未找到这条进展。记录可能已移动，或尚未载入。",
  back: "返回进展列表", detail: "进展详情", scope: "时间与显示范围", fetched: "资料读取时间", unavailable: "尚未读取进展资料",
  scopeDescription: "发生日期、记录日期与核实日期分别标明；读取时间不代表企业有新回复。这里只汇总可追溯的现有记录，不会生成新的待办。",
  gaps: "部分记录因缺少可靠日期、尚未核实或格式不受支持而未展示。", gapUndated: "日期缺失", gapInvalid: "日期无效", gapFuture: "未来日期", gapUnreviewed: "尚未核实", gapUnsupported: "资料格式未覆盖",
  event: "发生日期", recorded: "记录日期", reviewed: "核实日期", recordedMeaning: "这是处理或同步记录的日期，不代表企业在当天发来回复。", reviewedMeaning: "这是现有事项的核实日期，不是新增义务的日期。", statusMeaning: "这是案件已记录的状态；未记载的历史变化不会自动补全。", workMeaning: "工作记录完成不代表外部申请或消息已发送。发送情况以明确的发送记录为准。",
  source: "依据与来源", sourceCount: "合并来源", sourceUnit: "条", openCase: "打开案件记录", openAction: "打开行动记录", external: "打开来源链接", jobExternal: "打开求人来源", noSource: "此条仅展示工作记录的结构化摘要。", sourceCaution: "求人来源用于核对岗位，不等于企业回复原文。",
  state: "记录状态", position: "相关岗位", actor: "执行者", action: "关联事项", reason: "记录说明", sourcesPrivate: "工作日志只展示结构化结果，内部正文不在此展开。",
  dueTextShort: "原文相对期限 · 见详情",
  noWrite: "查看进展不会完成事项、批准申请或发送消息。", allLink: "查看全部", summaryDescription: "按可靠日期回看最新记录", summaryEmpty: "尚无可展示的进展记录。", summaryGap: "部分资料待核实或尚未覆盖。",
  applicationSubmitted: "申请已提交", requiredAction: "仍需本人处理", workCompleted: "工作记录标为完成", workInProgress: "处理中", draft: "草稿", prepared: "已准备", awaitingApproval: "待批准", saved: "已保存", sent: "已发送", notSent: "尚未发送",
  case: "案件状态", aiApplication: "AI 代投记录", userAction: "已核实事项", applicationLog: "申请处理记录", platformSync: "平台同步记录", outboundDraft: "对外材料准备",
  statusUnapplied: "未申请", statusApplied: "已申请", statusPassed: "书类通过", statusInterview: "面试中", statusOffer: "录用", statusHold: "保留", statusRejected: "未采用",
  overview: "进展概览", timeline: "按日期查看", rangeLabel: "进展时间范围", range7d: "近 7 天", range30d: "近 30 天", rangeAll: "全部", inclusive: "首尾均含", until: "截至", current: "当前需要你处理", currentRange: "不受时间范围限制", advancing: "已确认的推进", advancingRange: "所选时间范围内", noCurrent: "当前没有已核实的本人必要动作。", noAdvancing: "所选范围内暂无已记录的推进。", more: "展开全部", less: "收起", rejectedGroup: "未采用", waitingGroup: "申请与保留记录", workGroup: "处理记录", companyUnit: "家公司", groupedByCompany: "按公司归并", groupsOverlap: "同一公司可能出现在不同组，各组公司数不可相加。", reviewData: "资料待核实", reviewMeaning: "仅表示资料待核，不是新回复或新增义务。", due: "明确期限", dueText: "原文期限", dueToday: "今天截止", overdue: "已过期限，请先核对有效性", scopeShort: "资料范围", waitingMeaning: "这里只汇总所选范围内的申请与保留记录，不表示这些公司目前都在等待回复。", timelineMeaning: "日期明细按所选范围筛选；仍有效的本人动作请查看进展概览。",
};

const progressJa: typeof progressZh = {
  title: "最近の進展", kicker: "進展と記録", introduction: "企業の動き、記録された対応、残っている支障を振り返ります。",
  all: "すべて", company: "案件の動き", work: "対応・準備", blocker: "残っている支障", filters: "進展の分類", records: "進展の記録",
  loading: "進展の記録を読み込んでいます…", refreshing: "データを更新しています…", error: "進展を読み込めませんでした。しばらくしてから再読み込みしてください。", stale: "前回読み込んだ記録を表示しています。",
  empty: "確認できる資料に、表示できる進展はまだありません。", emptyCategory: "この分類には表示できる記録がありません。", notFound: "読み込んだ資料にこの進展が見つかりません。移動済み、または未読込の可能性があります。",
  back: "進展一覧に戻る", detail: "進展の詳細", scope: "日時と表示範囲", fetched: "データ読込時刻", unavailable: "進展データは未読込です",
  scopeDescription: "発生日、記録日、確認日を区別します。読込時刻は企業からの新着返信を意味しません。既存の記録だけをまとめ、新しい TODO は作りません。",
  gaps: "確かな日付がない、未確認、または対応外の形式の記録は表示していません。", gapUndated: "日付なし", gapInvalid: "日付が無効", gapFuture: "未来の日付", gapUnreviewed: "未確認", gapUnsupported: "未対応の形式",
  event: "発生日", recorded: "記録日", reviewed: "確認日", recordedMeaning: "対応や同期の記録日です。その日に企業から返信があったことを意味しません。", reviewedMeaning: "既存事項の確認日です。新しい対応義務の発生日ではありません。", statusMeaning: "案件に記録されている状態です。未記録の履歴は自動では補いません。", workMeaning: "作業記録の完了は、外部への応募やメッセージの送信を意味しません。送信状況は明示された送信記録に基づきます。",
  source: "根拠と出典", sourceCount: "統合した出典", sourceUnit: "件", openCase: "案件の記録を開く", openAction: "対応の記録を開く", external: "出典リンクを開く", jobExternal: "求人の出典を開く", noSource: "この項目は作業記録の構造化された要約のみを表示します。", sourceCaution: "求人の出典は職種確認用で、企業からの返信原文ではありません。",
  state: "記録の状態", position: "関連職種", actor: "実行者", action: "関連する事項", reason: "記録の説明", sourcesPrivate: "作業ログは構造化された結果のみを表示し、内部本文は展開しません。",
  dueTextShort: "原文の相対期限・詳細へ",
  noWrite: "進展を開いても、対応完了、応募の承認、メッセージ送信にはなりません。", allLink: "すべて見る", summaryDescription: "確かな日付のある最新の記録", summaryEmpty: "表示できる進展はまだありません。", summaryGap: "未確認または未対応の資料があります。",
  applicationSubmitted: "応募を送信済み", requiredAction: "本人の対応が必要", workCompleted: "作業記録は完了", workInProgress: "対応中", draft: "下書き", prepared: "準備済み", awaitingApproval: "承認待ち", saved: "保存済み", sent: "送信済み", notSent: "未送信",
  case: "案件の状態", aiApplication: "AI による応募記録", userAction: "確認済みの事項", applicationLog: "応募対応の記録", platformSync: "サイト同期の記録", outboundDraft: "対外資料の準備",
  statusUnapplied: "未応募", statusApplied: "応募済", statusPassed: "書類通過", statusInterview: "面接中", statusOffer: "内定", statusHold: "保留", statusRejected: "不採用",
  overview: "進展の概要", timeline: "日付順で見る", rangeLabel: "進展の期間", range7d: "直近 7 日", range30d: "直近 30 日", rangeAll: "全期間", inclusive: "両端を含む", until: "まで", current: "現在あなたの対応が必要", currentRange: "期間の指定に関係なく表示", advancing: "確認できた進展", advancingRange: "選択した期間内", noCurrent: "現在、確認済みの本人対応はありません。", noAdvancing: "この期間には記録された進展がありません。", more: "すべて展開", less: "折りたたむ", rejectedGroup: "不採用", waitingGroup: "応募・保留の記録", workGroup: "対応の記録", companyUnit: "社", groupedByCompany: "会社ごとに集約", groupsOverlap: "同じ会社が複数の分類に含まれるため、各社数は合計できません。", reviewData: "資料の確認待ち", reviewMeaning: "資料が未確認という意味です。新着返信や新しい対応義務ではありません。", due: "指定期限", dueText: "原文の期限", dueToday: "本日期限", overdue: "期限経過・有効性を要確認", scopeShort: "資料の範囲", waitingMeaning: "選択期間の応募・保留の記録です。現在すべての会社からの返信を待っているという意味ではありません。", timelineMeaning: "日付明細は選択期間内の記録です。現在も有効な本人対応は進展の概要で確認できます。",
};

export function recentProgressCopy(locale: string) { return locale === "ja" ? progressJa : progressZh; }

export function recentProgressRoute(search = ""): RecentProgressRoute {
  const params = new URLSearchParams(search);
  const raw = params.get("activityKind");
  const category = categories.includes(raw as RecentProgressCategory) ? raw as RecentProgressCategory : "all";
  const range = params.get("activityRange");
  const view = params.get("activityView");
  const chart = params.get("activityChart");
  const validChart = chart?.startsWith("day:") ? validActionDate(chart.slice(4)) : chart === "group:waiting" || PROGRESS_SEGMENTS.some((key) => chart === `segment:${key}`);
  return { category, id: params.get("update") || null, range: range === "30d" || range === "all" ? range : "7d",
    // 旧分类深链继续进入原来的日期列表，新增入口默认使用概览。
    view: view === "timeline" || (!view && category !== "all") ? "timeline" : "overview",
    open: [...new Set((params.get("activityOpen") || "").split(",").filter((key) => openGroups.includes(key as typeof openGroups[number])))].sort(),
    ...(chart && validChart ? { chart } : {}) };
}

export function recentProgressHref(id: string | null = null, category: RecentProgressCategory = "all", options: Partial<Pick<RecentProgressRoute, "range" | "view" | "open" | "chart">> = {}) {
  const params = new URLSearchParams();
  if (category !== "all") params.set("activityKind", category);
  if (options.range && options.range !== "7d") params.set("activityRange", options.range);
  const view = options.view ?? (category === "all" ? "overview" : "timeline");
  if (view === "timeline" || category !== "all") params.set("activityView", view);
  const open = [...new Set(options.open ?? [])].filter((key) => openGroups.includes(key as typeof openGroups[number])).sort();
  if (open.length) params.set("activityOpen", open.join(","));
  if (options.chart) params.set("activityChart", options.chart);
  if (id) params.set("update", id);
  return `/activity${params.size ? `?${params}` : ""}`;
}

function routeHref(route: RecentProgressRoute) { return recentProgressHref(route.id, route.category, route); }

export function progressStateLabel(state: RecentProgressEntry["state"], copy: typeof progressZh) {
  const labels: Record<RecentProgressEntry["state"], string> = {
    "未応募": copy.statusUnapplied, "応募済": copy.statusApplied, "書類通過": copy.statusPassed, "面接中": copy.statusInterview, "内定": copy.statusOffer, "保留": copy.statusHold, "不採用": copy.statusRejected,
    "application-submitted": copy.applicationSubmitted, "required-action": copy.requiredAction, "work-completed": copy.workCompleted, "work-in-progress": copy.workInProgress,
    draft: copy.draft, prepared: copy.prepared, "awaiting-approval": copy.awaitingApproval, saved: copy.saved, sent: copy.sent, "not-sent": copy.notSent,
  };
  return labels[state];
}

export function progressSourceLabel(sourceType: RecentProgressEntry["sourceType"], copy: typeof progressZh) {
  return ({ case: copy.case, "ai-application": copy.aiApplication, "user-action": copy.userAction, "application-log": copy.applicationLog, "platform-sync": copy.platformSync, "outbound-draft": copy.outboundDraft })[sourceType];
}

function inCategory(item: RecentProgressEntry, category: RecentProgressCategory) {
  return category === "all" || (category === "company" ? item.kind === "status" || item.kind === "application" : category === "work" ? item.kind === "work" || item.kind === "draft" || item.kind === "application" : item.kind === "blocker");
}

function safeHref(value: string) {
  if (/\s/.test(value)) return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}

function savedPosition(state: unknown): ListPosition | null {
  if (!state || typeof state !== "object") return null;
  const raw = (state as Record<string, unknown>).__echoProgressList;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.scrollY !== "number" || !Number.isFinite(value.scrollY) || value.scrollY < 0) return null;
  if (value.route && typeof value.route === "object") {
    const route = value.route as RecentProgressRoute;
    if (categories.includes(route.category) && ["7d", "30d", "all"].includes(route.range) && ["overview", "timeline"].includes(route.view) && Array.isArray(route.open)) return { route, id: value.id, scrollY: value.scrollY, ...(typeof value.anchorId === "string" ? { anchorId: value.anchorId } : {}) };
  }
  // 重设计前保存在浏览器里的列表位置仍可读取。
  return categories.includes(value.category as RecentProgressCategory) ? { route: recentProgressRoute(`?activityView=timeline&activityKind=${value.category}`), id: value.id, scrollY: value.scrollY } : null;
}

const rowId = (id: string) => `progress-${encodeURIComponent(id)}`;

export function ProgressDetail({ item, onOpenSource, copy, today = "", sourcesOpen, onSourcesToggle }: { item: RecentProgressEntry; onOpenSource: (path: string) => void; copy: typeof progressZh; today?: string; sourcesOpen?: boolean; onSourcesToggle?: (open: boolean) => void }) {
  const links = item.externalSources.map(safeHref).filter((href): href is string => Boolean(href));
  const jobSource = item.sourceType === "case" || item.sourceType === "ai-application";
  return <article className="recent-progress-detail" data-progress-kind={item.kind} data-tone={progressTone(item, today)}>
    <div className="recent-progress-detail-heading"><span className={`recent-progress-state recent-progress-state-${item.kind}`}>{progressStateLabel(item.state, copy)}</span><h2>{item.company || progressSourceLabel(item.sourceType, copy)}</h2>
      {item.position && <p>{item.position}</p>}
    </div>
    <dl className="recent-progress-facts"><div><dt>{copy[item.dateBasis]}</dt><dd><time dateTime={item.date}>{item.date}</time></dd></div><div><dt>{copy.state}</dt><dd>{progressStateLabel(item.state, copy)}</dd></div>{item.actor && <div><dt>{copy.actor}</dt><dd>{item.actor}</dd></div>}</dl>
    {(item.due || item.dueText) && <p className="recent-progress-detail-due">{item.due ? <>{copy.due}：<time dateTime={item.due}>{item.due}</time>{item.due <= today && ` · ${item.due === today ? copy.dueToday : copy.overdue}`}</> : <>{copy.dueText}：{item.dueText}</>}</p>}
    {item.due && item.dueText && <p className="recent-progress-detail-due">{copy.dueText}：{item.dueText}</p>}
    {item.dateBasis !== "event" && <p className="recent-progress-note">{item.dateBasis === "recorded" ? copy.recordedMeaning : copy.reviewedMeaning}</p>}
    {item.kind === "status" && <p className="recent-progress-note">{copy.statusMeaning}</p>}
    {item.state === "work-completed" && <p className="recent-progress-note">{copy.workMeaning}</p>}
    {item.action && <section className="recent-progress-detail-text"><h3>{copy.action}</h3><p>{item.action}</p></section>}
    {item.summary && <section className="recent-progress-detail-text"><h3>{copy.reason}</h3><p>{item.summary}</p></section>}
    {item.actionPath && <a className="recent-progress-action-link" href={`/actions?action=${encodeURIComponent(item.actionPath)}`}>{copy.openAction} →</a>}
    <details className="recent-progress-sources" open={sourcesOpen} onToggle={onSourcesToggle ? (event) => onSourcesToggle(event.currentTarget.open) : undefined}><summary>{copy.source}<span>{item.sourceCount} {copy.sourceUnit}</span></summary>
      <p>{progressSourceLabel(item.sourceType, copy)} · {copy.sourceCount} {item.sourceCount} {copy.sourceUnit}</p>
      <ul>{item.sourcePaths.map((path) => <li key={path}><button type="button" onClick={() => onOpenSource(path)}>{path === item.actionPath ? copy.openAction : copy.openCase}</button></li>)}
        {links.map((href) => <li key={href}><a href={href} target="_blank" rel="noopener noreferrer">{jobSource ? copy.jobExternal : copy.external} ↗</a></li>)}</ul>
      {jobSource && links.length > 0 && <p className="recent-progress-note">{copy.sourceCaution}</p>}
      {!item.sourcePaths.length && !links.length && <p className="recent-progress-note">{copy.noSource}</p>}
    </details>
  </article>;
}

export type RecentProgressViewProps = { notes: Note[]; today: string; loading: boolean; fetchedAt: number | null; error?: string | null; onOpenSource: (path: string) => void; embedded?: boolean };

export function ProgressListRow({ item, route, copy, onSelect, today, compact = false, hideCompany = false, anchorSuffix = "" }: {
  item: RecentProgressEntry; route: RecentProgressRoute; copy: typeof progressZh; today: string; compact?: boolean; hideCompany?: boolean; anchorSuffix?: string;
  onSelect: (event: MouseEvent<HTMLAnchorElement>, item: RecentProgressEntry) => void;
}) {
  return <li><a id={`${rowId(item.id)}${anchorSuffix}`} className={`recent-progress-row${compact ? " recent-progress-row-compact" : ""}`} href={recentProgressHref(item.id, route.category, route)} onClick={(event) => onSelect(event, item)} data-progress-kind={item.kind} data-tone={progressTone(item, today)}>
    <span className="recent-progress-row-main"><strong>{hideCompany ? item.position || item.company : item.company || progressSourceLabel(item.sourceType, copy)}</strong>{!hideCompany && <span>{item.action || item.position || progressSourceLabel(item.sourceType, copy)}</span>}</span>
    <span className="recent-progress-row-meta"><span className="recent-progress-state">{progressStateLabel(item.state, copy)}</span>{item.kind === "blocker" && (item.due || item.dueText) ? <small className="recent-progress-due">{item.due ? <>{item.due <= today ? item.due === today ? copy.dueToday : copy.overdue : copy.due} <time dateTime={item.due}>{item.due}</time></> : compact ? copy.dueTextShort : `${copy.dueText} ${item.dueText}`}</small> : <small><time dateTime={item.date}>{item.date}</time> · {copy[item.dateBasis]}</small>}</span><span className="recent-progress-arrow" aria-hidden="true">→</span>
  </a></li>;
}

type Overview = ReturnType<typeof buildRecentProgressOverview>;
type OverviewProps = { overview: Overview; route: RecentProgressRoute; copy: typeof progressZh; today: string; locale: string; onToggle: (key: string) => void; onChartSelection: (selection: string | undefined) => void; onSelect: (event: MouseEvent<HTMLAnchorElement>, item: RecentProgressEntry) => void };

function ProgressOverview({ overview, route, copy, today, locale, onToggle, onSelect, onChartSelection }: OverviewProps) {
  const currentLimit = 2;
  const advancingLimit = Math.max(1, 3 - Math.min(currentLimit, overview.current.length));
  const priorities = [
    { key: "current", title: copy.current, note: copy.currentRange, entries: overview.current, limit: currentLimit, empty: copy.noCurrent, tone: "action" },
    { key: "advancing", title: copy.advancing, note: copy.advancingRange, entries: overview.advancing, limit: advancingLimit, empty: copy.noAdvancing, tone: "positive" },
  ].filter((group) => group.key !== "current" || group.entries.length > 0);
  const explore = (key: string) => {
    if (!route.open.includes(key)) onToggle(key);
    window.requestAnimationFrame(() => document.getElementById(`progress-${key}-records`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };
  return <div className="recent-progress-overview">
    <ProgressDashboard overview={overview} locale={locale} onToggle={explore} selection={route.chart} onSelection={onChartSelection} renderRow={(item) => <ProgressListRow key={item.id} item={item} route={route} copy={copy} today={today} compact anchorSuffix="-chart" onSelect={onSelect} />} />
    <div className={`recent-progress-priorities${overview.current.length ? "" : " recent-progress-priorities-single"}`}>{priorities.map((group) => <section className="recent-progress-priority" key={group.key} data-priority={group.key} data-tone={group.tone}>
      <header><div><h2>{group.title}<span>{group.entries.length}</span></h2><p>{group.note}</p></div>{group.entries.length > group.limit && <button type="button" className="recent-progress-text-button" aria-expanded={route.open.includes(group.key)} aria-controls={`progress-${group.key}-records`} onClick={() => onToggle(group.key)}>{route.open.includes(group.key) ? copy.less : `${copy.more} (${group.entries.length})`}</button>}</header>
      {group.entries.length ? <ul className="recent-progress-list" id={`progress-${group.key}-records`}>{(route.open.includes(group.key) ? group.entries : group.entries.slice(0, group.limit)).map((item) => <ProgressListRow key={item.id} item={item} route={route} copy={copy} today={today} compact onSelect={onSelect} />)}</ul> : <p className="recent-progress-priority-empty">{group.empty}</p>}
    </section>)}</div>
    <div className="recent-progress-group-stack">{([
      { key: "rejected", title: copy.rejectedGroup, groups: overview.rejected, tone: "muted" },
      { key: "waiting", title: copy.waitingGroup, groups: overview.waiting, tone: "neutral" },
    ] as const).map((group) => <section key={group.key} className="recent-progress-group" data-group={group.key} data-tone={group.tone}>
      <button type="button" className="recent-progress-group-toggle" aria-expanded={route.open.includes(group.key)} aria-controls={`progress-${group.key}-records`} onClick={() => onToggle(group.key)}><span>{group.title}<strong>{group.groups.length} {copy.companyUnit}</strong></span><span className="recent-progress-group-meta">{copy.groupedByCompany}<span aria-hidden="true">{route.open.includes(group.key) ? "−" : "+"}</span></span></button>
      {route.open.includes(group.key) && <div className="recent-progress-group-content" id={`progress-${group.key}-records`}>{group.key === "waiting" && <p className="recent-progress-note">{copy.waitingMeaning}</p>}{group.groups.length ? <ul className="recent-progress-companies">{group.groups.map((company) => <li key={company.key}><h3>{company.company}</h3><ul className="recent-progress-list">{company.entries.map((item) => <ProgressListRow key={item.id} item={item} route={route} copy={copy} today={today} compact hideCompany onSelect={onSelect} />)}</ul></li>)}</ul> : <p className="recent-progress-priority-empty">{copy.emptyCategory}</p>}</div>}
    </section>)}
      <section className="recent-progress-group" data-group="work" data-tone="neutral"><button type="button" className="recent-progress-group-toggle" aria-expanded={route.open.includes("work")} aria-controls="progress-work-records" onClick={() => onToggle("work")}><span>{copy.workGroup}<strong>{overview.work.length} {copy.sourceUnit}</strong></span><span className="recent-progress-group-meta"><span aria-hidden="true">{route.open.includes("work") ? "−" : "+"}</span></span></button>
        {route.open.includes("work") && <div className="recent-progress-group-content" id="progress-work-records">{overview.work.length ? <ul className="recent-progress-list">{overview.work.map((item) => <ProgressListRow key={item.id} item={item} route={route} copy={copy} today={today} compact onSelect={onSelect} />)}</ul> : <p className="recent-progress-priority-empty">{copy.emptyCategory}</p>}</div>}
      </section>
    </div>
    <p className="recent-progress-group-footnote">{copy.groupsOverlap}</p>
  </div>;
}

export default function RecentProgressView({ notes, today, loading, fetchedAt, error, onOpenSource, embedded = false }: RecentProgressViewProps) {
  const { locale } = useUiLocale();
  const copy = recentProgressCopy(locale);
  const result = useMemo(() => buildRecentProgress(notes, today), [notes, today]);
  const [route, setRoute] = useState<RecentProgressRoute>(() => recentProgressRoute(typeof window === "undefined" ? "" : window.location.search));
  const { category, id, range, view } = route;
  const overview = useMemo(() => buildRecentProgressOverview(result.entries, today, range), [result.entries, today, range]);
  const loaded = fetchedAt !== null && Number.isFinite(fetchedAt);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ kind: "detail" } | { kind: "list"; position: ListPosition | null } | null>(route.id ? { kind: "detail" } : null);
  const selected = result.entries.find((entry) => entry.id === id);
  const items = overview.entries.filter((entry) => inCategory(entry, category));
  const dates = [...new Set(items.map((entry) => entry.date))];
  const hasGaps = Object.values(result.gaps).some((count) => count > 0);

  useEffect(() => {
    const sync = () => {
      if (window.location.pathname.replace(/\/+$/, "") !== "/activity") return;
      const next = recentProgressRoute(window.location.search);
      if (routeHref(next) === routeHref(route)) return;
      pending.current = next.id ? { kind: "detail" } : { kind: "list", position: savedPosition(window.history.state) };
      setRoute(next);
    };
    window.addEventListener("popstate", sync);
    window.addEventListener(URL_CHANGE_EVENT, sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener(URL_CHANGE_EVENT, sync); };
  }, [route]);

  useEffect(() => {
    if (!loaded || !pending.current) return;
    const navigation = pending.current;
    pending.current = null;
    const restore = () => {
      if (navigation.kind === "detail") { detailRef.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }
      else {
        const saved = navigation.position;
        const position = saved && routeHref({ ...saved.route, id: null }) === routeHref({ ...route, id: null }) ? saved : null;
        const target = position ? document.getElementById(position.anchorId || rowId(position.id)) : null;
        (target || listRef.current)?.focus({ preventScroll: true });
        window.scrollTo({ top: position?.scrollY ?? 0, left: 0, behavior: "instant" });
      }
    };
    restore();
    const timer = window.setTimeout(restore, 0);
    return () => window.clearTimeout(timer);
  }, [route, loaded]);

  const changeRoute = (next: RecentProgressRoute) => {
    if (typeof window !== "undefined") window.history.replaceState({ ...(window.history.state ?? {}), ...(!next.id ? { __echoProgressList: null, __echoProgressDetail: null } : {}) }, "", routeHref(next));
    setRoute(next);
  };
  const setRange = (value: ProgressRange) => {
    const next = { ...route, range: value };
    delete next.chart;
    changeRoute(next);
  };
  const setOpen = (key: string, open: boolean) => {
    if (route.open.includes(key) === open) return;
    changeRoute({ ...route, open: open ? [...route.open, key].sort() : route.open.filter((value) => value !== key) });
  };
  const openDetail = (event: MouseEvent<HTMLAnchorElement>, item: RecentProgressEntry) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const position = { route: { ...route, id: null }, id: item.id, scrollY: window.scrollY, ...(event.currentTarget?.id ? { anchorId: event.currentTarget.id } : {}) };
    window.history.replaceState({ ...(window.history.state ?? {}), __echoProgressList: position }, "");
    window.history.pushState({ ...(window.history.state ?? {}), __echoProgressDetail: item.id }, "", recentProgressHref(item.id, category, route));
    pending.current = { kind: "detail" };
    setRoute({ ...route, id: item.id });
  };
  const backToList = () => {
    const position = savedPosition(window.history.state);
    if (window.history.state?.__echoProgressDetail === id && position) { window.history.back(); return; }
    const next = { ...route, id: null };
    window.history.replaceState({ ...(window.history.state ?? {}), __echoProgressDetail: null }, "", routeHref(next));
    pending.current = { kind: "list", position };
    setRoute(next);
  };

  return <section className={`recent-progress-view${embedded ? " recent-progress-view-embedded" : ""}`} aria-label={copy.title}>
    <header className="recent-progress-header">{!embedded && <div><span className="recent-progress-kicker">{copy.kicker}</span><h1>{copy.title}</h1></div>}<div className="recent-progress-header-controls"><nav className="recent-progress-range" aria-label={copy.rangeLabel}>{(["7d", "30d", "all"] as const).map((value) => <button type="button" key={value} aria-pressed={range === value} onClick={() => setRange(value)}>{value === "7d" ? copy.range7d : value === "30d" ? copy.range30d : copy.rangeAll}</button>)}</nav><p className="recent-progress-range-dates">{overview.start ? <><time dateTime={overview.start}>{overview.start}</time> — <time dateTime={overview.end}>{overview.end}</time> · {copy.inclusive}</> : <>{copy.rangeAll} · {copy.until} <time dateTime={overview.end}>{overview.end}</time></>} · JST</p>{embedded && !id && <button type="button" className="recent-progress-embedded-toggle" onClick={() => changeRoute({ ...route, view: view === "overview" ? "timeline" : "overview" })}>{view === "overview" ? copy.timeline : locale === "ja" ? "概要に戻る" : "返回概览"}<span aria-hidden="true">{view === "overview" ? " →" : " ↩"}</span></button>}</div></header>
    <div className="recent-progress-scope-bar"><details className="recent-progress-scope" open={route.open.includes("scope")} onToggle={(event) => setOpen("scope", event.currentTarget.open)}><summary>{copy.scopeShort}{loaded && hasGaps && <span>{copy.summaryGap}</span>}</summary><p>{copy.scopeDescription}</p><p>{loaded ? <>{copy.fetched}：<time dateTime={new Date(fetchedAt).toISOString()}>{new Intl.DateTimeFormat(locale, { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(fetchedAt)} JST</time></> : copy.unavailable}</p>
      {loaded && hasGaps && <><p>{copy.gaps}</p><ul>{([["undated", "gapUndated"], ["invalidDates", "gapInvalid"], ["futureDates", "gapFuture"], ["unreviewed", "gapUnreviewed"], ["unsupportedRecords", "gapUnsupported"]] as const).filter(([key]) => result.gaps[key] > 0).map(([key, label]) => <li key={key}>{copy[label]}：{result.gaps[key]}</li>)}</ul></>}
    </details>{loaded && result.gaps.unreviewed > 0 && <a className="recent-progress-review-link" href={`/actions?category=review`} title={copy.reviewMeaning}>{copy.reviewData} {result.gaps.unreviewed} →</a>}</div>
    {error && <p className="recent-progress-message" role="alert">{copy.error}{loaded && ` ${copy.stale}`}</p>}
    {loading && !error && <p className="recent-progress-message" role="status">{loaded ? copy.refreshing : copy.loading}</p>}
    {!loaded && !loading && !error && <p className="recent-progress-message" role="status">{copy.unavailable}</p>}
    {loaded && <>
      {id ? <div ref={detailRef} tabIndex={-1} aria-label={copy.detail} className="recent-progress-detail-view"><div className="recent-progress-detail-toolbar"><button type="button" onClick={backToList}>← {copy.back}</button><span>{copy.detail}</span></div>
        {selected ? <ProgressDetail item={selected} onOpenSource={onOpenSource} copy={copy} today={today} sourcesOpen={route.open.includes("sources")} onSourcesToggle={(open) => setOpen("sources", open)} /> : <p className="recent-progress-empty" role="status">{copy.notFound}</p>}
        <p className="recent-progress-note">{copy.noWrite}</p>
      </div> : <>
        {!embedded && <nav className="recent-progress-view-switch" aria-label={copy.records}><button type="button" aria-pressed={view === "overview"} onClick={() => changeRoute({ ...route, view: "overview" })}>{copy.overview}</button><button type="button" aria-pressed={view === "timeline"} onClick={() => changeRoute({ ...route, view: "timeline" })}>{copy.timeline}</button></nav>}
        <div id="recent-progress-records" ref={listRef} tabIndex={-1} aria-label={copy.records} data-progress-category={category} data-progress-view={view}>
          {view === "overview" ? result.entries.length ? <ProgressOverview overview={overview} route={route} copy={copy} today={today} locale={locale} onSelect={openDetail} onToggle={(key) => setOpen(key, !route.open.includes(key))} onChartSelection={(chart) => changeRoute({ ...route, chart })} /> : <p className="recent-progress-empty">{copy.empty}{hasGaps && <span>{copy.summaryGap}</span>}</p> : <>
            <p className="recent-progress-timeline-note">{copy.timelineMeaning}</p>
            <nav className="recent-progress-filters" aria-label={copy.filters}>{categories.map((key) => <button key={key} type="button" aria-pressed={key === category} aria-controls="recent-progress-records" onClick={() => changeRoute({ ...route, category: key })}>{copy[key]}<span>{overview.entries.filter((entry) => inCategory(entry, key)).length}</span></button>)}</nav>
            {items.length ? dates.map((date) => <section className="recent-progress-date-group" key={date} aria-labelledby={`progress-date-${date}`}><h2 id={`progress-date-${date}`}><time dateTime={date}>{date}</time></h2><ul className="recent-progress-list">{items.filter((entry) => entry.date === date).map((item) => <ProgressListRow key={item.id} item={item} route={route} copy={copy} today={today} onSelect={openDetail} />)}</ul></section>) : <p className="recent-progress-empty">{copy.emptyCategory}{hasGaps && <span>{copy.summaryGap}</span>}</p>}
          </>}
        </div>
      </>}
    </>}
  </section>;
}
