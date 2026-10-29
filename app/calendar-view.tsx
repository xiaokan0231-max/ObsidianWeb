"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { type Note } from "@/lib/notes";
import type { CalendarModel } from "@/lib/calendar-snapshot";
import type { CalendarPulseSummary } from "@/lib/calendar-pulse-summary";
import type { CalendarDaySummary } from "@/lib/calendar-query-model";
import type { CalendarProjection } from "./use-calendar-projection";
import ReadModelSyncStatus from "./read-model-sync-status";
import { type UiLocale } from "@/lib/ui-locale";
import { useUiLocale } from "./ui-locale";
import CalendarApplicationPanel, { CalendarApplicationTrigger, ApplicationProgressBar, type OpenApplicationDay } from "./calendar-application-panel";
import { buildCalendarEventOrigins, type CalendarEventOrigin } from "@/lib/calendar-event-origin";
import { CalendarOriginBadge, CalendarOriginLegend } from "./calendar-origin-badge";
import { enumCodec, useInitialUrlSearch, useUrlState, type UrlStateCodec } from "./use-url-state";
import { isTypingTarget } from "@/lib/keyboard";
import { calendarMonthDays } from "@/lib/calendar-month";
import { buildCalendarWeek, calendarWeekDays, calendarWeekRangeLabel, calendarWeekStart, jstClock, minutesLabel, stepWeekSelection } from "@/lib/calendar-week";
import { buildAiApplicationDays, summarizeAiApplicationDays } from "@/lib/calendar-applications";
import { calendarConflicts } from "@/lib/calendar-conflicts";
import { isInterviewEvent, resolveCalendarInterviewDestinations, type CalendarInterviewDestinations, type CalendarInterviewTarget } from "@/lib/calendar-interview";
import { buildCalendarCompanyRatings, type CalendarCompanyRating } from "@/lib/calendar-company-rating";
import { CalendarCompanyRatingBadge } from "./calendar-company-rating";
import { CalendarInterviewLinks } from "./calendar-interview-links";
import { calendarInterviewScore, type CalendarInterviewScore } from "@/lib/calendar-interview-score";
import { calendarProgress, isCalendarHistoricalProgress, type CalendarProgress } from "@/lib/calendar-progress";
import { buildCalendarSummary, calendarDayOffset, isCalendarLiveEvent, shiftCalendarDay } from "@/lib/calendar-summary";
import { calendarRoundBadge, interviewRound, interviewRoundLabelJa } from "@/lib/interview-round";
import {
  calendarEventTime,
  localDateKey,
  type CalendarEvent,
} from "@/lib/memory-atlas-data";

type ProgressTone = CalendarProgress["tone"];

const WAITING_FOR_JA: Record<string, string> = { self: "本人", company: "企業", agent: "エージェント", platform: "媒体" };

const calendarZh = {
  calendar: "日历",
  timezone: "日本时间（JST）",
  progressLegend: "日程状态图例",
  progress: {
    active: "进行中", waiting: "等回复", closed: "已结束", paused: "暂停推进", neutral: "历史记录", unknown: "关联冲突",
  } satisfies Record<ProgressTone, string>,
  // 中文是 lib 里的正本：aria-label 和 title 依赖原句（含 waiting_label 原文）。
  progressDetail: (progress: CalendarProgress) => progress.detail,
  focusTone: (label: string) => `只高亮「${label}」的日程，再点一次取消`,
  pending: "待进行",
  offer: "已获内定",
  previousMonth: "上一个月",
  nextMonth: "下一个月",
  today: "今天",
  weekdays: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
  rounds: "面试轮次",
  roundHelp: "面试轮次说明",
  roundLegend: "面试轮次：0 轻松面谈，1、2、3 等数字为正式轮次，终为最终面试，猎为猎头面谈，问号为轮次待确认",
  casual: "轻松面谈",
  numbered: "… 正式轮次",
  numberedRound: (mark: string) => `第 ${mark} 轮面试`,
  final: "最终面试",
  finalShort: "终面",
  finalMark: "终",
  agent: "猎头面谈",
  agentShort: "猎头",
  agentMark: "猎",
  agentDetail: "猎头面谈，不计入正式选考轮次",
  unknownRound: "轮次待确认",
  unknownShort: "待确认",
  unknownDetail: "轮次待确认：本场资料未明确选考阶段",
  interview: "面试",
  meeting: "面谈",
  // 场次 label 本身就是中文正本，原样显示。
  eventLabel: (label: string) => label,
  review: "面试复盘",
  // 月格卡片只有约 83px 宽，长文案会被省略号截掉箭头；中文本身够短，两处同文。
  reviewShort: "面试复盘",
  score: (points: string) => `${points}分`,
  localScore: (points: string) => `局部${points}分`,
  schedule: "查看安排",
  source: "查看原始记录",
  sourceShort: "原始记录",
  conflict: "时间冲突",
  more: (count: number) => `另有 ${count} 项`,
  collapse: "收起",
  countdown: (days: number) => days === 0 ? "今天" : days === 1 ? "明天" : days > 1 ? `${days} 天后` : `${-days} 天前`,
  upcomingWeek: "未来 7 天",
  upcomingEmpty: "未来七天没有已确认的安排。",
  later: "稍后安排",
  recent: "最近记录",
  history: "历史事实",
  historyEmpty: "还没有历史日程。",
  nextUp: "下一场",
  nextNone: "暂无",
  stats: "日历态势",
  statWeek: "未来 7 天场次",
  statWaiting: "等回复案件",
  // 面板标题与 aria-label；数字格要写清计数对象，不能拿面板名当标签，读起来像「9 条待处理的说明」。
  statHistorical: "历史状态说明",
  // 不写「未关联」：后续未记载的两类场次有关联正本，只是读不到当前状态。
  statHistoricalCount: "无当前状态的历史场次",
  // 分母是全部已发生场次，免得把子集读成历史总数。
  historicalScope: (total: number) => `/ ${total} 场 · 不限月份`,
  historicalExplanation: "这些是日程记录，不是本人待办；当轮结果不代表当前选考状态。",
  historicalScopeExplanation: "只列出读不到当前案件状态、需单独说明当轮结果或关联情况的已发生场次；已关联当前案件的场次按其当前状态显示，不在此列。分母是全部已发生场次，不限当前显示的月份或周。",
  historicalEmpty: "暂无需要补充状态说明的历史场次。",
  historicalOpen: "查看无当前状态的历史场次及原始来源",
  historicalClose: "收起历史状态说明",
  historicalRejected: "当轮未通过",
  historicalPassed: "当轮通过",
  historicalMeetingCompleted: "面谈已完成",
  historicalResult: "当轮结果已记录",
  historicalMissing: "历史关联缺失",
  historicalUnrecorded: "后续未记载",
  associationConflicts: (count: number) => `关联冲突 ${count} 场`,
  associationExplanation: "这些记录存在明确的关联冲突，需要核对来源后才能判断进展；不计为本人待办。",
  statMonthAi: "本月 AI 代投",
  selectDay: (label: string) => `${label} · 查看当日详情`,
  dayDetail: (label: string) => `${label} · 当日`,
  dayEmpty: "这一天没有已确认的安排。",
  closeDay: "收起当日详情",
  aiApplications: "AI 代投",
  aiShort: "代投",
  aiApplicationsToday: "今天 AI 代投",
  applicationCompanyUnit: "家公司",
  applicationCompanyShort: "家",
  applicationPositionCount: (count: number) => `${count} 个岗位`,
  applicationDayLabel: (date: string, companies: number, positions: number) => `${date} JST · AI 代投 ${companies} 家公司 · ${positions} 个岗位 · 展开申请详情`,
  applicationNoPosition: "岗位未记载",
  applicationSubmission: (agent: string) => `由 ${agent} 提交`,
  applicationRecord: "查看记录",
  applicationRecordLabel: (date: string, company: string, position: string, agent: string) => `${date} JST · ${company} · ${position} · 由 ${agent} 提交 · 查看申请记录`,
  applicationsLoading: "正在读取申请记录…",
  applicationsEmpty: "今天暂无已确认的 AI 代投。",
  monthApplicationsEmpty: "当前月份暂无已确认的 AI 代投。",
  calendarGuide: "图例",
  viewSwitch: "日历视图",
  viewMonth: "月",
  viewWeek: "周",
  previousWeek: "上一周",
  nextWeek: "下一周",
  thisWeek: "本周",
  allDay: "全天",
  allDayHint: "未写具体时刻，不占时间段",
  weekGrid: (range: string) => `${range} · 周视图（日本时间）`,
  weekKeys: "← → 逐日选择 · [ ] 翻周 · T 回到今天 · Enter 打开当日第一场",
};
type CalendarCopy = typeof calendarZh;

// buildCalendarEvents 的固定兜底词；轮次类 label 交给 interviewRoundLabelJa，其余未知写法原样显示。
const EVENT_LABEL_JA = new Map([["招聘说明会", "採用説明会"], ["面试", "面接"], ["面谈", "面談"]]);

function japaneseEventLabel(label: string) {
  // 只换逐字等于中文正本轮次词的 label：轮次解析会把「カジュアル面談（原文）」这类带补充的原文也认成轮次，
  // 直接换词会吞掉括号里的补充；认不全的写法按原文显示。
  const canonicalRound = label === "猎头面谈" || calendarRoundBadge(label)?.label === label;
  return (canonicalRound && interviewRoundLabelJa(label)) || EVENT_LABEL_JA.get(label) || label;
}

function japaneseProgressDetail(progress: CalendarProgress) {
  const waitingNote = progress.waitingLabel ? `：${progress.waitingLabel}` : "";
  switch (progress.code) {
    case "rejected": return "この案件は不採用と記録されており、選考は終了しています。";
    case "paused": return `この案件は保留中で、当面は進めません。${progress.reason ? `記録された理由：${progress.reason}。` : ""}`;
    case "offer": return "この案件は内定と記録されています。";
    case "meeting-closed": return "この面談の後続は終了と明記されています。";
    case "scheduled": return "確定済みの予定で、まだ完了の記録はありません。";
    case "waiting-case": return `予定は過ぎ、この案件は${WAITING_FOR_JA[progress.waitingFor ?? ""] ?? "相手"}からの返信待ちです${waitingNote}。`;
    case "active-self": return "予定は過ぎ、案件は進行中です。記録上の待機先は本人ですが、具体的な対応は確認済み TODO に基づきます。";
    case "active-case": return "予定は過ぎ、案件はまだ選考中です。";
    case "meeting-waiting": return `予定は過ぎ、この面談は後続の返信待ちです${waitingNote}。`;
    case "recorded-rejected": return "元の振り返りには、この回の結果が不採用と記録されています。現在の案件との対応関係は確認されていないため、現在の選考状況は推測しません。";
    case "recorded-passed": return "元の振り返りには、この回を通過したと記録されています。現在の案件との対応関係は確認されていないため、現在も選考中とは判断しません。";
    case "recorded-meeting-completed": return "元の振り返りには、この面談を実施したと記録されています。その後の選考終了や本人の対応義務を意味しません。";
    case "historical-result": return "元の記録に当時の結果が残っています。詳しくは元の記録で確認できます。現在の選考状況を示すものではありません。";
    case "historical-unlinked": return "この回の記録は残っていますが、現在の案件とは関連付けられていません。過去の記録として表示し、本人の対応事項には数えません。";
    case "association-missing": return "明記された関連先を読み込んだ資料から確認できません。現在の状況は推測せず、元の記録を残しています。";
    case "association-conflict": return "案件または面談の関連付けが矛盾しているため、現在の進捗を確定できません。本人の対応事項には数えません。";
    case "meeting-unrecorded": return "この面談は過去の記録ですが、その後の状態は明記されていません。完了済みの準備作業から、企業の選考結果は推測しません。";
    case "unrecorded": return "この予定の後続状況は記録されていません。過去の記録として残し、本人の対応事項には数えません。";
  }
}

const CALENDAR_COPY: Record<UiLocale, CalendarCopy> = {
  "zh-CN": calendarZh,
  ja: {
    calendar: "カレンダー", timezone: "日本時間（JST）", progressLegend: "予定の状態の凡例",
    progress: { active: "進行中", waiting: "返信待ち", closed: "終了", paused: "一時保留", neutral: "過去の記録", unknown: "関連付けの矛盾" },
    progressDetail: japaneseProgressDetail,
    focusTone: (label) => `「${label}」の予定だけを強調（もう一度押すと解除）`,
    pending: "実施予定", offer: "内定獲得",
    previousMonth: "前の月", nextMonth: "次の月", today: "今日",
    weekdays: ["月", "火", "水", "木", "金", "土", "日"],
    rounds: "面接の段階", roundHelp: "面接の段階の説明",
    roundLegend: "面接の段階：0 はカジュアル面談、1、2、3 などの数字は正式な面接回数、終は最終面接、エはエージェント面談、疑問符は段階未確認",
    casual: "カジュアル面談", numbered: "… 正式な面接", numberedRound: (mark) => `${mark} 次面接`,
    final: "最終面接", finalShort: "最終面接", finalMark: "終",
    agent: "エージェント面談", agentShort: "エージェント", agentMark: "エ", agentDetail: "エージェント面談：正式な選考回数には含まれません",
    unknownRound: "段階未確認", unknownShort: "未確認", unknownDetail: "段階未確認：この記録では選考段階が明示されていません",
    interview: "面接", meeting: "面談", eventLabel: japaneseEventLabel, review: "面接の振り返り", reviewShort: "振り返り", score: (points) => `${points}点`, localScore: (points) => `部分${points}点`, schedule: "予定を見る", source: "元の記録を見る", sourceShort: "元の記録",
    conflict: "時間が重複",
    more: (count) => `ほか ${count} 件`, collapse: "閉じる",
    countdown: (days) => days === 0 ? "今日" : days === 1 ? "明日" : days > 1 ? `${days} 日後` : `${-days} 日前`,
    upcomingWeek: "今後 7 日間", upcomingEmpty: "今後 7 日間に確定した予定はありません。",
    later: "その後の予定", recent: "最近の記録", history: "過去の記録", historyEmpty: "過去の予定はまだありません。",
    nextUp: "次の予定", nextNone: "なし",
    stats: "カレンダーの状況", statWeek: "今後 7 日間の予定", statWaiting: "返信待ちの案件",
    statHistorical: "過去の状態の説明", statHistoricalCount: "現在の状態がない過去の予定", historicalScope: (total) => `/ ${total} 件 · 期間を問わず`, historicalExplanation: "予定の記録であり、本人の TODO ではありません。その回の結果は現在の選考状況とは区別します。",
    historicalScopeExplanation: "現在の案件の状態を読み取れず、その回の結果や関連付けを個別に説明する必要がある実施済みの予定だけを表示します。現在の案件に関連付いた予定は現在の状態で表示し、ここには含めません。分母は実施済みの全予定で、表示中の月や週には限定しません。", historicalEmpty: "状態の補足説明が必要な過去の予定はありません。", historicalOpen: "現在の状態がない過去の予定と元の記録を見る", historicalClose: "過去の状態説明を閉じる",
    historicalRejected: "当該回は不採用", historicalPassed: "当該回は通過", historicalMeetingCompleted: "面談実施済み", historicalResult: "当時の結果は記録済み", historicalMissing: "過去の関連先が不明", historicalUnrecorded: "後続の記載なし", associationConflicts: (count) => `関連付けの矛盾 ${count} 件`, associationExplanation: "明記された関連付けに矛盾があり、進捗の判断には元の記録の確認が必要です。本人の TODO には数えません。",
    statMonthAi: "今月のAI代行応募",
    selectDay: (label) => `${label} · この日の詳細を見る`, dayDetail: (label) => `${label} · この日`,
    dayEmpty: "この日に確定した予定はありません。", closeDay: "この日の詳細を閉じる",
    aiApplications: "AI代行応募", aiShort: "代行", aiApplicationsToday: "今日のAI代行応募", applicationCompanyUnit: "社",
    applicationCompanyShort: "社",
    applicationPositionCount: (count) => `${count} 求人`,
    applicationDayLabel: (date, companies, positions) => `${date} JST · AI代行応募 ${companies} 社 · ${positions} 求人 · 応募の詳細を開く`,
    applicationNoPosition: "職種未記載", applicationSubmission: (agent) => `${agent} が提出`, applicationRecord: "記録を見る",
    applicationRecordLabel: (date, company, position, agent) => `${date} JST · ${company} · ${position} · ${agent} が提出 · 応募記録を見る`,
    applicationsLoading: "応募記録を読み込み中…", applicationsEmpty: "今日の確認済みAI代行応募はありません。",
    monthApplicationsEmpty: "対象月に確認済みのAI代行応募はありません。",
    calendarGuide: "凡例",
    viewSwitch: "カレンダーの表示", viewMonth: "月", viewWeek: "週",
    previousWeek: "前の週", nextWeek: "次の週", thisWeek: "今週",
    allDay: "終日", allDayHint: "時刻の記載がなく、時間帯を占めません",
    weekGrid: (range) => `${range} · 週表示（日本時間）`,
    weekKeys: "← → 日を選択 · [ ] 週を移動 · T 今日に戻る · Enter その日の最初の予定を開く",
  },
};

type CalendarMode = "month" | "week";
const CALENDAR_MODE_CODEC = enumCodec<CalendarMode>(["month", "week"]);
/** 手改成周中某天也落到那周的周一，链接里写哪天都指向同一周。 */
const WEEK_START_CODEC: UrlStateCodec<string> = {
  parse: (raw) => /^20\d{2}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(`${raw}T00:00:00Z`)) ? calendarWeekStart(raw) : null,
};

/** 侧栏每组默认露出的条数；更多的折进「另有 N 项」，首屏不被一长串议程推走。 */
const AGENDA_LIMIT = 5;

/** short 只给月格卡片：那里放不下「面接の振り返り →」，右栏议程和 aria-label 仍用完整文案。 */
function interviewDestination(target: CalendarInterviewTarget, copy: CalendarCopy, short = false) {
  return target.view === "review" ? short ? copy.reviewShort : copy.review : copy.schedule;
}

type CalendarBadge = NonNullable<ReturnType<typeof calendarRoundBadge>> | {
  mark: string;
  label: string;
  kind: "unknown" | "agent";
};

function eventRoundBadge(event: CalendarEvent, copy: CalendarCopy): CalendarBadge | null {
  if (!isInterviewEvent(event)) return null;
  const round = calendarRoundBadge(event.label);
  if (round) return {
    ...round,
    mark: round.kind === "final" ? copy.finalMark : round.mark,
    label: round.kind === "casual" ? copy.casual : round.kind === "final" ? copy.final : copy.numberedRound(round.mark),
  };
  return interviewRound(event.label) === "agent"
    ? { mark: copy.agentMark, label: copy.agentDetail, kind: "agent" }
    : { mark: "?", label: copy.unknownDetail, kind: "unknown" };
}

function RoundBadge({ round }: { round: CalendarBadge }) {
  return <span className={`calendar-round-badge round-${round.kind}`} title={round.label} aria-hidden="true">{round.mark}</span>;
}

function RoundLegend({ copy }: { copy: CalendarCopy }) {
  return (
    <div className="calendar-round-legend" role="note" aria-label={copy.roundLegend}>
      <span className="calendar-round-legend-title">{copy.rounds}</span>
      <span className="calendar-round-legend-item"><RoundBadge round={{ mark: "0", label: copy.casual, kind: "casual" }} />{copy.casual}</span>
      <span className="calendar-round-legend-item">
        <span className="calendar-round-sequence" aria-hidden="true">
          {["1", "2", "3"].map((mark) => <RoundBadge key={mark} round={{ mark, label: copy.numberedRound(mark), kind: "numbered" }} />)}
        </span>
        <span>{copy.numbered}</span>
      </span>
      <span className="calendar-round-legend-item"><RoundBadge round={{ mark: copy.finalMark, label: copy.final, kind: "final" }} />{copy.finalShort}</span>
      <span className="calendar-round-legend-item"><RoundBadge round={{ mark: copy.agentMark, label: copy.agent, kind: "agent" }} />{copy.agentShort}</span>
      <span className="calendar-round-legend-item"><RoundBadge round={{ mark: "?", label: copy.unknownRound, kind: "unknown" }} />{copy.unknownShort}</span>
    </div>
  );
}

/** 轮次说明收进工具栏的「?」：常驻一整行会把月格往下推，而它只在第一次看不懂徽标时才需要。 */
function RoundHelp({ copy }: { copy: CalendarCopy }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <details className="calendar-round-help" ref={ref} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={copy.roundHelp} title={copy.roundHelp}>?</summary>
      <RoundLegend copy={copy} />
    </details>
  );
}

function progressLabel(progress: CalendarProgress, copy: CalendarCopy) {
  const historical = { "recorded-rejected": copy.historicalRejected, "recorded-passed": copy.historicalPassed, "recorded-meeting-completed": copy.historicalMeetingCompleted, "historical-result": copy.historicalResult, "association-missing": copy.historicalMissing, "meeting-unrecorded": copy.historicalUnrecorded, unrecorded: copy.historicalUnrecorded };
  if (progress.code in historical) return historical[progress.code as keyof typeof historical];
  return progress.code === "scheduled" ? copy.pending : progress.code === "offer" ? copy.offer : copy.progress[progress.tone];
}

function scoreText(score: CalendarInterviewScore | null | undefined, copy: CalendarCopy) {
  if (!score) return "";
  const points = score.scores.join("/");
  return score.kind === "overall" ? copy.score(points) : copy.localScore(points);
}

function InterviewScoreBadge({ score, copy, compact = false }: { score?: CalendarInterviewScore | null; copy: CalendarCopy; compact?: boolean }) {
  if (!score) return null;
  const band = score.kind === "local" ? "local" : score.scores[0] < 65 ? "attention" : "standard";
  // 标签属于原生面试按钮，整块支持触控、Enter和Space，不另塞嵌套按钮。
  return <span className="calendar-interview-score" data-kind={score.kind} data-band={band} data-compact={compact || undefined} title={scoreText(score, copy)} aria-hidden="true">{compact ? score.scores.join("/") : scoreText(score, copy)}</span>;
}

function eventActionLabel(event: CalendarEvent, progress: CalendarProgress, copy: CalendarCopy, target?: CalendarInterviewTarget, conflict = false, score?: CalendarInterviewScore | null) {
  const round = eventRoundBadge(event, copy);
  const context = [event.date, calendarEventTime(event), "JST", event.company, copy.eventLabel(event.label),
    round?.kind === "unknown" ? copy.unknownRound : ""].filter(Boolean).join(" · ");
  return `${context} · ${progressLabel(progress, copy)}：${copy.progressDetail(progress)} · ${score ? `${scoreText(score, copy)} · ` : ""}${target ? interviewDestination(target, copy) : copy.source}${conflict ? ` · ${copy.conflict}` : ""}`;
}

export function CalendarRecordExplanationList({ events, progressByEvent, interviewTargets, interviewDestinations, copy, onOpen, onInterview }: {
  events: CalendarEvent[];
  progressByEvent: ReadonlyMap<string, CalendarProgress>;
  interviewTargets: ReadonlyMap<string, CalendarInterviewTarget>;
  interviewDestinations?: ReadonlyMap<string, CalendarInterviewDestinations>;
  copy: CalendarCopy;
  onOpen: (note: Note) => void;
  onInterview: (event: CalendarEvent, view?: CalendarInterviewTarget["view"]) => void;
}) {
  return <ul className="calendar-record-explanations">{events.map((event) => {
    const progress = progressByEvent.get(event.id)!;
    const target = interviewTargets.get(event.id);
    return <li key={event.id} className={`calendar-record-explanation status-${progress.tone}`}>
      <div className="calendar-record-explanation-heading"><time dateTime={event.date}>{event.date}</time><strong>{event.company}</strong><span>{progressLabel(progress, copy)}</span></div>
      <p>{copy.progressDetail(progress)}</p>
      <div className="calendar-record-explanation-links">{interviewDestinations ? <CalendarInterviewLinks targets={interviewDestinations.get(event.id)} onNavigate={(view) => onInterview(event, view)} /> : target?.view === "review" && <button type="button" onClick={() => onInterview(event)} aria-label={`${event.date} · ${event.company} · ${copy.review}`}>{copy.review} →</button>}
        <button type="button" onClick={() => onOpen(event.note)} aria-label={`${event.date} · ${event.company} · ${copy.source}`}>{copy.source}</button>
      </div>
    </li>;
  })}</ul>;
}

function monthOf(date: string) {
  const [year, monthNumber] = date.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1);
}

function monthKeyOf(month: Date) {
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
}

function CalendarView({
  events,
  notes,
  today,
  onOpen,
  interviewTargets,
  onInterview,
  loading = false,
  fetchedAt,
  onOpenCompany,
  model,
  initialSummary,
  projection,
  onOpenPath,
}: {
  events: CalendarEvent[];
  notes: Note[];
  onOpen: (note: Note) => void;
  interviewTargets: ReadonlyMap<string, CalendarInterviewTarget>;
  onInterview: (event: CalendarEvent, view?: CalendarInterviewTarget["view"]) => void;
  loading?: boolean;
  fetchedAt?: number | null;
  onOpenCompany?: (company: string, contextNote: Note) => void;
  model?: CalendarModel | null;
  initialSummary?: CalendarPulseSummary | null;
  projection?: CalendarProjection;
  onOpenPath?: (path: string, revision?: string) => void;
  /** 「今日」は殻が持つ。memo 越しなので中で求めると日付を跨いでも昨日のままになる。 */
  today: string;
}) {
  const { locale } = useUiLocale();
  const copy = CALENDAR_COPY[locale];
  const openSource = (note: Note) => projection && onOpenPath ? onOpenPath(note.path, projection.revision) : onOpen(note);
  const sectionRef = useRef<HTMLElement>(null);
  const initialSearch = useInitialUrlSearch();
  const [month, setMonth] = useState(() => {
    const requested = new URLSearchParams(initialSearch).get("month") ?? "";
    return /^20\d{2}-\d{2}$/.test(requested) ? monthOf(`${requested}-01`) : monthOf(today);
  });
  // 只记录用户翻月的方向；首次进入不带方向，入场交给视图转场，不和月格滑入叠在一起。
  const [monthDir, setMonthDir] = useState<"prev" | "next" | "">("");
  // 空串＝没有主动选中：键盘与「今天」以 today 为起点，但侧栏不常驻一块与「未来 7 天」重复的当日详情。
  const [selectedDay, setSelectedDay] = useState("");
  const [applicationDate, setApplicationDate] = useState("");
  const applicationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const openApplications: OpenApplicationDay = (day, trigger) => {
    applicationTriggerRef.current = trigger;
    setApplicationDate(day.date);
    if (projection) void projection.loadApplications(day.date);
  };
  const closeApplications = () => {
    setApplicationDate("");
    projection?.closeApplications();
    const trigger = applicationTriggerRef.current;
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    else sectionRef.current?.querySelector<HTMLButtonElement>(`[data-ai-date="${applicationDate}"]`)?.focus({ preventScroll: true });
  };
  const [focusTone, setFocusTone] = useState<ProgressTone | "">("");
  const [historyExplanationOpen, setHistoryExplanationOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  // 月／周存进 URL：刷新或从别页返回时停在原来的看法上；默认月视图，链接里不出现参数。
  const [calView, setCalView] = useUrlState("calview", "month", CALENDAR_MODE_CODEC);
  // 空串＝「本周」：默认值不随 today 变，跨过午夜或周一时链接里不会凭空冒出一个 calweek，
  // 停在本周的人也会跟着进入新的一周。
  const currentWeek = calendarWeekStart(today);
  const [weekParam, setWeekParam] = useUrlState("calweek", "", WEEK_START_CODEC);
  const weekStart = weekParam || currentWeek;
  const setWeekStart = (next: string) => setWeekParam(next === currentWeek ? "" : next);
  const [weekDir, setWeekDir] = useState<"prev" | "next" | "">("");
  // 实时刻度线只在挂载后由 effect 写入：渲染期取当前时刻会让 SSR 与客户端对不上。
  const [nowClock, setNowClock] = useState<ReturnType<typeof jstClock> | null>(null);
  const focusDayRef = useRef("");
  const monthKey = monthKeyOf(month);
  const monthLabel = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
  }).format(month);
  const dayFormatter = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" });
  const dayLabel = (key: string) => dayFormatter.format(new Date(`${key}T00:00:00+09:00`));
  const days = calendarMonthDays(month).map((date, index) => ({
    date,
    key: localDateKey(date),
    inMonth: date.getMonth() === month.getMonth(),
    weekend: index % 7 >= 5,
  }));
  const weeks = Array.from({ length: days.length / 7 }, (_, index) => days.slice(index * 7, index * 7 + 7));
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((event) => map.set(event.date, [...(map.get(event.date) ?? []), event]));
    return map;
  }, [events]);
  const fullApplicationDays = useMemo(() => projection ? [] : model?.applicationDays ?? buildAiApplicationDays(notes, today), [model, notes, today, projection]);
  const applicationDays = projection?.applicationDays ?? fullApplicationDays;
  const overviewMonth = calView === "week" ? weekStart.slice(0, 7) : monthKey;
  const monthApplications = useMemo(() => summarizeAiApplicationDays(fullApplicationDays, overviewMonth), [fullApplicationDays, overviewMonth]);
  const interviewDestinations = useMemo(() => model?.interviewDestinations ?? new Map(events.map(event => [event.id, resolveCalendarInterviewDestinations(event, notes)])), [model, events, notes]);
  const companyRatingByEvent = useMemo(() => model?.companyRatingByEvent ?? buildCalendarCompanyRatings(events, notes, interviewTargets), [model, events, notes, interviewTargets]);
  const originByEvent = useMemo(() => model?.originByEvent ?? buildCalendarEventOrigins(events, notes), [model, events, notes]);
  const applicationsByDate = useMemo(() => new Map(applicationDays.map((day) => [day.date, day])), [applicationDays]);
  const progressByEvent = useMemo(() => model?.progressByEvent ?? new Map(events.map((event) => [
    event.id, calendarProgress(event, notes, interviewTargets.get(event.id)),
  ])), [model, events, notes, interviewTargets]);
  // 已结束案件残留的旧预约不算撞期：拒信之后那一格不会再去。
  const conflicts = useMemo(() => calendarConflicts(events.filter((event) =>
    progressByEvent.get(event.id)?.tone !== "closed")), [events, progressByEvent]);
  const summary = useMemo(() => buildCalendarSummary({ events, progressByEvent, applicationDays: fullApplicationDays, today }),
    [events, progressByEvent, fullApplicationDays, today]);
  // 说明列表与统计共用同一判定，并按场次去重；翻月不能让这个数字换口径。
  const historicalEvents = useMemo(() => [...new Map(events.filter((event) => {
    const progress = progressByEvent.get(event.id);
    return progress && isCalendarHistoricalProgress(progress) && (!projection || projection.history.eventIds.has(event.id));
  }).map((event) => [event.id, event])).values()].sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id)), [events, progressByEvent, projection]);
  const associationConflicts = useMemo(() => [...new Map(events.filter((event) => progressByEvent.get(event.id)?.code === "association-conflict").map((event) => [event.id, event])).values()], [events, progressByEvent]);
  const horizon = shiftCalendarDay(today, 6);
  // 与态势条「下一场」「未来 7 天场次」同一口径（lib/calendar-summary.ts），侧栏和数字不会各说各的。
  const upcomingAll = events.filter((event) => isCalendarLiveEvent(event, progressByEvent.get(event.id), today));
  const upcomingWeek = upcomingAll.filter((event) => event.date <= horizon);
  const upcomingLater = upcomingAll.filter((event) => event.date > horizon);
  // 当天已面完的场次已退出「未来 7 天」，要在这里接住，不能两边都消失。
  // 不在这里截断：计数要是真实总数，默认只露几条交给 AgendaGroup 的 limit 与展开。
  const recent = events
    .filter((event) => event.phase === "past" || progressByEvent.get(event.id)?.occurred)
    .sort((left, right) => right.date.localeCompare(left.date) || right.time.localeCompare(left.time));
  const recentDisplayed = projection ? projection.recent.loaded ? recent.filter((event) => projection.recent.eventIds.has(event.id)) : recent.slice(0, 6) : recent;
  // 首屏汇总可先于详情到达；只借用同一天、同月份的结果，翻月或详情齐全后不能沿用旧数字。
  const authoritativeSummary = projection?.summary ?? initialSummary;
  const pulseSummary = (projection || loading) && authoritativeSummary?.today === today && authoritativeSummary.month === overviewMonth ? authoritativeSummary : null;
  const statsLoading = projection ? !pulseSummary : loading && !pulseSummary;
  const displayedApplications = pulseSummary?.applications ?? monthApplications;
  const displayedWaitingCount = pulseSummary?.waitingCount ?? summary.waitingCount;
  const displayedHistoricalCount = pulseSummary?.historicalCount ?? summary.historicalCount;
  const displayedHistoricalTotal = pulseSummary?.historicalTotal ?? recent.length;
  const selectedEvents = selectedDay ? eventsByDate.get(selectedDay) ?? [] : [];
  const selectedApplications = selectedDay && selectedDay !== today ? applicationsByDate.get(selectedDay) : undefined;

  const rangeFrom = calView === "week" ? weekStart : days[0].key;
  const rangeTo = calView === "week" ? shiftCalendarDay(weekStart, 6) : days.at(-1)!.key;
  const onRangeChange = projection?.onRangeChange;
  useEffect(() => { if (onRangeChange) void onRangeChange({ from: rangeFrom, to: rangeTo, month: overviewMonth }); }, [onRangeChange, rangeFrom, rangeTo, overviewMonth]);
  const loadHistory = projection?.loadHistory;
  const historyLoaded = projection?.history.loaded;
  const historyLoading = projection?.history.loading;
  const historyError = projection?.history.error;
  const projectionRevision = projection?.revision;
  useEffect(() => { if (historyExplanationOpen && projectionRevision && loadHistory && !historyLoaded && !historyLoading && !historyError) void loadHistory(); }, [historyExplanationOpen, projectionRevision, loadHistory, historyLoaded, historyLoading, historyError]);
  const loadApplications = projection?.loadApplications;
  const loadedApplicationDate = projection?.applications.date;
  useEffect(() => { if (applicationDate && projectionRevision && loadApplications && loadedApplicationDate !== applicationDate) void loadApplications(applicationDate); }, [applicationDate, projectionRevision, loadApplications, loadedApplicationDate]);
  const loadRecent = projection?.loadRecent;
  const recentLoaded = projection?.recent.loaded;
  const recentLoading = projection?.recent.loading;
  const recentError = projection?.recent.error;
  useEffect(() => { if (recentOpen && projectionRevision && loadRecent && !recentLoaded && !recentLoading && !recentError) void loadRecent(); }, [recentOpen, projectionRevision, loadRecent, recentLoaded, recentLoading, recentError]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("month", monthKeyOf(month));
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
  }, [month]);

  // 刻度线每分钟对齐到整分刷新一次；只在周视图挂着时走表，月视图不需要。
  useEffect(() => {
    if (calView !== "week") return;
    let timer = 0;
    const tick = () => {
      const now = Date.now();
      setNowClock(jstClock(now));
      timer = window.setTimeout(tick, 60000 - (now % 60000) + 50);
    };
    timer = window.setTimeout(tick, 0);
    return () => window.clearTimeout(timer);
  }, [calView]);

  // 键盘跨月移动时月格整块重挂，焦点会掉回 body；渲染后把焦点还给新选中的那一天。
  useLayoutEffect(() => {
    const key = focusDayRef.current;
    if (!key) return;
    focusDayRef.current = "";
    sectionRef.current?.querySelector<HTMLButtonElement>(`[data-day="${key}"] :is(.calendar-day-select, .cw-day-select)`)?.focus();
  });

  const goToMonth = (target: Date) => {
    const next = new Date(target.getFullYear(), target.getMonth(), 1);
    if (monthKeyOf(next) === monthKey) return;
    setMonthDir(next > month ? "next" : "prev");
    setMonth(next);
  };
  const moveMonth = (offset: number) => goToMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));
  const goToday = () => {
    goToMonth(monthOf(today));
    setSelectedDay("");
  };
  const selectDay = (key: string, focus = false) => {
    setSelectedDay(key);
    goToMonth(monthOf(key));
    if (focus) focusDayRef.current = key;
  };
  const toggleFocusTone = (tone: ProgressTone) => setFocusTone((current) => current === tone ? "" : tone);
  const scoreByEvent = useMemo(() => model?.scoreByEvent ?? new Map(events.map(event => [event.id, calendarInterviewScore(event, interviewTargets.get(event.id), notes)])), [model, events, interviewTargets, notes]);
  const openEvent = (event: CalendarEvent) => interviewTargets.get(event.id) ? onInterview(event) : openSource(event.note);

  const goToWeek = (target: string) => {
    const next = calendarWeekStart(target);
    if (next === weekStart) return;
    setWeekDir(next > weekStart ? "next" : "prev");
    setWeekStart(next);
  };
  const moveWeek = (offset: number) => goToWeek(shiftCalendarDay(weekStart, offset * 7));
  const goThisWeek = () => {
    goToWeek(today);
    setSelectedDay("");
  };
  // 两种看法之间切换时带上「正在看的那段」：月→周落到选中日／今天／该月 1 日所在周，
  // 周→月落到选中日／今天／周四所在月（周四定月份，跨月的一周归给占天数多的那个月）。
  const switchView = (next: CalendarMode) => {
    if (next === calView) return;
    if (next === "week") {
      const anchor = selectedDay || (monthKey === today.slice(0, 7) ? today : `${monthKey}-01`);
      setWeekDir("");
      setWeekStart(calendarWeekStart(anchor));
    } else {
      const visible = calendarWeekDays(weekStart);
      const anchor = visible.includes(selectedDay) ? selectedDay : visible.includes(today) ? today : visible[3];
      const target = monthOf(anchor);
      if (monthKeyOf(target) !== monthKey) {
        setMonthDir("");
        setMonth(target);
      }
      // 月视图用不到所在周；留着会让月视图的链接带一个看不见作用的参数。
      setWeekParam("");
    }
    setCalView(next);
  };
  const onCalendarKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
    const section = sectionRef.current;
    const target = event.target;
    const fromPage = target === document.body || target === document.documentElement;
    // 申请面板内部（搜索、筛选、关闭）由本地控件处理按键，不能在输入／筛选时翻动背后日历。
    if (target instanceof Element && target.closest(".calendar-application-panel")) return;
    // 面板开着时，触发按钮和 body 上的翻页键也不能把背后的月／周翻走。面板关闭后焦点会回到触发按钮，
    // 这时 [ ] T 和方向键必须照常交给日历；Esc 由按钮自己的 onKeyDown 处理。
    if (applicationDate && (fromPage || (target instanceof Element && target.closest("[data-ai-date]")))) return;
    // 抽屉、⌘K 等浮层里的按键不归日历管；R / ⌘K / Esc 都留给外壳。
    if (!section || (!fromPage && !(target instanceof Node && section.contains(target)))) return;
    // 浮层开着而焦点掉回 body 时（关掉内层阅读层之类），方向键不能在浮层背后翻日历。
    if (section.closest("[inert]") || document.querySelector('[aria-modal="true"]')) return;
    const key = event.key;
    if (calView === "week") {
      // 周视图：← → 在一周里逐日移动选中日（越过周一／周日就翻到相邻周），[ ] 仍整周翻页，
      // T 回到本周并选中今天，Enter 打开选中日的第一场。选中日联动侧栏「当日详情」。
      if (key === "[" || key === "]") {
        event.preventDefault();
        moveWeek(key === "[" ? -1 : 1);
      } else if (key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        const next = stepWeekSelection(weekStart, selectedDay, today, key === "ArrowLeft" ? -1 : 1);
        goToWeek(next);
        setSelectedDay(next);
        // 跨周时整块周格按 key 重挂，焦点会掉回 body；渲染后还给新选中那天的日期按钮。
        focusDayRef.current = next;
      } else if (key.toLowerCase() === "t") {
        event.preventDefault();
        // 按钮「本周」只是回到本周；键盘还要接着用方向键走，所以顺手选中今天作为起点。
        goToWeek(today);
        setSelectedDay(today);
      } else if (key === "Enter" && selectedDay && calendarWeekDays(weekStart).includes(selectedDay)) {
        // 与月视图同一条规则：Tab 到另一天的日期按钮上按 Enter 是「选中那一天」，交给按钮自己的 click。
        const focusedDay = fromPage ? selectedDay
          : target instanceof Element && target.classList.contains("cw-day-select")
            ? target.closest("[data-day]")?.getAttribute("data-day") : null;
        if (focusedDay !== selectedDay) return;
        const first = eventsByDate.get(selectedDay)?.[0];
        if (!first) return;
        event.preventDefault();
        openEvent(first);
      }
      return;
    }
    if (key === "[" || key === "]") {
      event.preventDefault();
      moveMonth(key === "[" ? -1 : 1);
    } else if (key.toLowerCase() === "t") {
      event.preventDefault();
      goToday();
    } else if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      const step = key === "ArrowLeft" ? -1 : 1;
      if (selectedDay) selectDay(shiftCalendarDay(selectedDay, step), true);
      else moveMonth(step);
    } else if ((key === "ArrowUp" || key === "ArrowDown") && selectedDay) {
      event.preventDefault();
      selectDay(shiftCalendarDay(selectedDay, key === "ArrowUp" ? -7 : 7), true);
    } else if (key === "Enter" && selectedDay) {
      // Tab 到另一天的日期按钮上按 Enter 是「选中那一天」，交给按钮自己的 click；
      // 只有焦点就在已选中那天（或在 body）时，Enter 才是「打开当日第一场」。
      const focusedDay = fromPage ? selectedDay
        : target instanceof Element && target.classList.contains("calendar-day-select")
          ? target.closest("[data-day]")?.getAttribute("data-day") : null;
      if (focusedDay !== selectedDay) return;
      const first = eventsByDate.get(selectedDay)?.[0];
      if (!first) return;
      event.preventDefault();
      openEvent(first);
    }
  };
  // 每次渲染换成最新闭包，监听只挂一次：免得依赖表漏项时按键读到旧的选中日。
  const keyHandler = useRef(onCalendarKey);
  useLayoutEffect(() => {
    keyHandler.current = onCalendarKey;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const weekLabel = calendarWeekRangeLabel(weekStart, today.slice(0, 4));

  return (
    <section className="calendar-view" ref={sectionRef} data-focus-tone={focusTone || undefined}>
      <h1 className="sr-only">{copy.calendar}</h1>
      {projection?.error && <div className="calendar-query-status" role="alert"><p>{projection.summary ? (locale === "ja" ? "カレンダーを読み込めませんでした。前回の資料を保持しています。" : "日历读取失败，保留上次完整资料。") : (locale === "ja" ? "カレンダーを読み込めませんでした。もう一度お試しください。" : "日历读取失败，请重试。")}</p><button type="button" onClick={() => void projection.refresh()}>{locale === "ja" ? "再試行" : "重试"}</button></div>}
      {projection?.loading && <p className="calendar-query-status" role="status">{locale === "ja" ? "カレンダーを読み込み中…" : "正在读取日历…"}</p>}
      {projection && <ReadModelSyncStatus state={projection.syncState} />}
      <div className="calendar-pulse" role="region" aria-label={copy.stats} aria-busy={statsLoading || undefined}>
        <div className="calendar-month-applications">
          <div className="calendar-month-metric"><span>{copy.statMonthAi}<time>{overviewMonth}</time></span>
            {statsLoading ? <i className="skeleton calendar-stat-skeleton" aria-hidden="true" /> : <div><strong>{displayedApplications.companyCount}</strong><span>{copy.applicationCompanyUnit}</span>
              {displayedApplications.positionCount !== displayedApplications.companyCount && <small> · {copy.applicationPositionCount(displayedApplications.positionCount)}</small>}
            </div>}
          </div>
          <div className="calendar-month-graphic">
            {statsLoading ? <p className="calendar-month-empty">{copy.applicationsLoading}</p> : displayedApplications.companyCount
              ? <ApplicationProgressBar bucketCounts={displayedApplications.bucketCounts} legend="labels" />
              : <p className="calendar-month-empty">{copy.monthApplicationsEmpty}</p>}
          </div>
        </div>
        <div className="calendar-pulse-actions">
          <button type="button" className="calendar-pulse-action status-waiting" aria-pressed={focusTone === "waiting"} title={copy.focusTone(copy.progress.waiting)} disabled={loading} onClick={() => toggleFocusTone("waiting")}>
            <i className="calendar-status-dot" aria-hidden="true" /><span>{copy.statWaiting}</span>{!statsLoading && <strong>{displayedWaitingCount}</strong>}
          </button>
          <button type="button" className="calendar-pulse-action status-neutral" aria-label={statsLoading ? copy.statHistoricalCount : `${copy.statHistoricalCount} ${displayedHistoricalCount} ${copy.historicalScope(displayedHistoricalTotal)}`} aria-expanded={historyExplanationOpen} aria-controls="calendar-historical-explanation" title={copy.historicalOpen} disabled={loading} onClick={() => { if (!historyExplanationOpen && projection && !projection.history.loaded) void projection.loadHistory(); setHistoryExplanationOpen((open) => !open); }}>
            <span>{copy.statHistorical}</span>{!statsLoading && <><strong>{displayedHistoricalCount}</strong><small>{copy.historicalScope(displayedHistoricalTotal)}</small></>}
          </button>
        </div>
      </div>
      {historyExplanationOpen && <section className="calendar-historical-explanation" id="calendar-historical-explanation" aria-label={copy.statHistorical}>
        <header><div><h2>{copy.statHistorical}</h2><p>{copy.historicalScopeExplanation}</p></div><button type="button" onClick={() => setHistoryExplanationOpen(false)} aria-label={copy.historicalClose}>×</button></header>
        <p className="calendar-history-meaning">{copy.historicalExplanation}</p>
        {historicalEvents.length ? <CalendarRecordExplanationList events={historicalEvents} progressByEvent={progressByEvent} interviewTargets={interviewTargets} interviewDestinations={interviewDestinations} copy={copy} onOpen={openSource} onInterview={onInterview} /> : !projection || projection.history.loaded && !projection.history.loading && !projection.history.error ? <p className="agenda-empty">{copy.historicalEmpty}</p> : null}
        {projection?.history.loading && <p role="status">{locale === "ja" ? "過去の予定を読み込み中…" : "正在读取历史场次…"}</p>}
        {projection?.history.error && <div role="alert"><p>{locale === "ja" ? "過去の予定を読み込めませんでした。" : "历史场次读取失败。"}</p><button type="button" onClick={() => void projection.loadHistory()}>{locale === "ja" ? "再試行" : "重试"}</button></div>}
        {projection?.history.loaded && projection.history.nextOffset !== null && <button type="button" disabled={projection.history.loading} onClick={() => void projection.loadHistory()}>{locale === "ja" ? "さらに12件を表示" : "再显示 12 场"}</button>}
      </section>}
      {!loading && associationConflicts.length > 0 && <details className="calendar-association-conflicts">
        <summary>{copy.associationConflicts(associationConflicts.length)}</summary><p>{copy.associationExplanation}</p>
        <CalendarRecordExplanationList events={associationConflicts} progressByEvent={progressByEvent} interviewTargets={interviewTargets} interviewDestinations={interviewDestinations} copy={copy} onOpen={openSource} onInterview={onInterview} />
      </details>}
      <div className="calendar-layout">
        <div className="calendar-board">
          <div className="calendar-toolbar">
            <h2>
              {calView === "week"
                ? <span className="calendar-month-label" key={`week-${weekStart}`} data-dir={weekDir || undefined}>{weekLabel}</span>
                : <span className="calendar-month-label" key={monthKey} data-dir={monthDir || undefined}>{monthLabel}</span>}
              <small className="calendar-timezone">{copy.timezone}</small>
            </h2>
            <div className="calendar-tools">
              <div className="cw-switch" role="group" aria-label={copy.viewSwitch}>
                {([["month", copy.viewMonth], ["week", copy.viewWeek]] as const).map(([mode, label]) => (
                  <button type="button" key={mode} aria-pressed={calView === mode} onClick={() => switchView(mode)}>{label}</button>
                ))}
              </div>
              <RoundHelp copy={copy} />
              {calView === "week" ? (
                <div className="calendar-actions">
                  <button type="button" onClick={() => moveWeek(-1)} aria-label={copy.previousWeek} aria-keyshortcuts="[">←</button>
                  <button type="button" onClick={goThisWeek} aria-keyshortcuts="T">{copy.thisWeek}</button>
                  <button type="button" onClick={() => moveWeek(1)} aria-label={copy.nextWeek} aria-keyshortcuts="]">→</button>
                </div>
              ) : (
                <div className="calendar-actions">
                  <button type="button" onClick={() => moveMonth(-1)} aria-label={copy.previousMonth} aria-keyshortcuts="[">←</button>
                  <button type="button" onClick={goToday} aria-keyshortcuts="T">{copy.today}</button>
                  <button type="button" onClick={() => moveMonth(1)} aria-label={copy.nextMonth} aria-keyshortcuts="]">→</button>
                </div>
              )}
            </div>
          </div>
          <div className="calendar-visual-guide">
            <CalendarOriginLegend locale={locale} />
            <details className="calendar-status-guide"><summary>{copy.calendarGuide} · {copy.progressLegend}</summary>
            <ul className="calendar-legend calendar-progress-legend" aria-label={copy.progressLegend}>
              {(Object.keys(copy.progress) as ProgressTone[]).filter((tone) => tone !== "unknown" || associationConflicts.length > 0).map((tone) => (
                <li className={`calendar-legend-item status-${tone}`} key={tone}>
                  <button type="button" aria-pressed={focusTone === tone} title={copy.focusTone(copy.progress[tone])} onClick={() => toggleFocusTone(tone)}>
                    <i className="calendar-status-dot" aria-hidden="true" />
                    {copy.progress[tone]}
                  </button>
                </li>
              ))}
            </ul>
            </details>
          </div>
          {calView === "week" ? (
            <WeekBoard
              key={weekStart}
              weekStart={weekStart}
              dir={weekDir}
              label={weekLabel}
              events={events}
              today={today}
              nowClock={nowClock}
              selectedDay={selectedDay}
              progressByEvent={progressByEvent}
              conflicts={conflicts}
              interviewTargets={interviewTargets}
              scoreByEvent={scoreByEvent}
              originByEvent={originByEvent}
              companyRatingByEvent={companyRatingByEvent}
              interviewDestinations={interviewDestinations}
              applicationsByDate={applicationsByDate}
              copy={copy}
              dayLabel={dayLabel}
              onSelectDay={(key) => setSelectedDay((current) => current === key ? "" : key)}
              onShowApplications={openApplications}
              applicationDate={applicationDate}
              onOpenEvent={openEvent}
              onInterview={onInterview}
            />
          ) : (
          <div className="calendar-grid-scroll">
            <div className="calendar-grid-frame">
              <div className="calendar-grid" role="grid" aria-label={monthLabel} key={monthKey} data-dir={monthDir || undefined}>
                <div className="calendar-week" role="row">
                  {copy.weekdays.map((weekday) => (
                    <div className="calendar-weekday" role="columnheader" key={weekday}>{weekday}</div>
                  ))}
                </div>
                {weeks.map((week) => (
                  <div className="calendar-week" role="row" key={week[0].key}>
                    {week.map((day) => {
                      const dayEvents = eventsByDate.get(day.key) ?? [];
                      const applications = applicationsByDate.get(day.key);
                      const isToday = day.key === today;
                      const className = ["calendar-day", !day.inMonth && "outside", isToday && "today",
                        day.key < today && "past", day.weekend && "weekend", selectedDay === day.key && "selected"].filter(Boolean).join(" ");
                      return (
                        <div className={className} key={day.key} role="gridcell" data-day={day.key} aria-current={isToday ? "date" : undefined}>
                          <div className="calendar-day-number">
                            <button
                              type="button"
                              className="calendar-day-select"
                              aria-pressed={selectedDay === day.key}
                              aria-label={copy.selectDay(dayLabel(day.key))}
                              onClick={() => selectedDay === day.key ? setSelectedDay("") : selectDay(day.key)}
                            >
                              <time dateTime={day.key}>{day.date.getDate()}</time>
                            </button>
                            {isToday && <span>{copy.today}</span>}
                          </div>
                          <div className="calendar-day-events">
                            {dayEvents.slice(0, 3).map((event) => {
                              const target = interviewTargets.get(event.id);
                              const progress = progressByEvent.get(event.id)!;
                              const round = eventRoundBadge(event, copy);
                              const conflict = conflicts.has(event.id);
                              const stage = !round || round.kind === "unknown" ? copy.eventLabel(event.label)
                                : round.kind === "casual" || round.kind === "agent" ? copy.meeting : copy.interview;
                              const actionLabel = eventActionLabel(event, progress, copy, target, conflict, scoreByEvent.get(event.id));
                              return (
                                <div className="calendar-event-item" key={event.id}><button
                                  className={`calendar-event ${event.phase} kind-${event.kind} status-${progress.tone}${conflict ? " conflict" : ""}`}
                                  onClick={() => openEvent(event)}
                                  title={actionLabel}
                                  aria-label={actionLabel}
                                >
                                  <span className="calendar-event-heading">
                                    {event.time ? <time className="calendar-event-time" dateTime={`${event.date}T${event.time}+09:00`}>{event.time}</time> : <span className="calendar-event-stage">{stage}</span>}
                                    {round && <RoundBadge round={round} />}
                                    <span className="calendar-status-dot" aria-hidden="true" />
                                  </span>
                                  <strong>{compactCompany(event.company)}</strong>
                                  <span className="calendar-month-signals">
                                    <CalendarOriginBadge origin={originByEvent.get(event.id)} compact locale={locale} className="calendar-origin-label" />
                                    <InterviewScoreBadge score={scoreByEvent.get(event.id)} copy={copy} compact />
                                    <CalendarCompanyRatingBadge rating={companyRatingByEvent.get(event.id)} compact />
                                  </span>
                                </button><CalendarInterviewLinks targets={interviewDestinations.get(event.id)} compact icons onNavigate={(view) => onInterview(event, view)} /></div>
                              );
                            })}
                            {dayEvents.length > 3 && (
                              <button className="calendar-more" onClick={() => selectDay(day.key)}>
                                {copy.more(dayEvents.length - 3)}
                              </button>
                            )}
                          </div>
                          {applications && (
                            <CalendarApplicationTrigger day={applications} expanded={applicationDate === applications.date} onOpen={openApplications} className="calendar-ai-applications" showCounts
                              label={copy.applicationDayLabel(day.key, applications.companyCount, applications.positionCount)}>
                              <strong>{copy.aiShort} {applications.companyCount}{copy.applicationCompanyShort}</strong>
                              {applications.positionCount !== applications.companyCount && <small>{copy.applicationPositionCount(applications.positionCount)}</small>}
                            </CalendarApplicationTrigger>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
          )}
        </div>

        <aside className="calendar-agenda">
          {selectedDay && (
            <AgendaGroup
              className="calendar-day-detail"
              title={copy.dayDetail(dayLabel(selectedDay))}
              empty={selectedApplications ? "" : copy.dayEmpty}
              events={selectedEvents}
              progressByEvent={progressByEvent}
              conflicts={conflicts}
              today={today}
              detailed
              onOpen={openSource}
              interviewTargets={interviewTargets}
              scoreByEvent={scoreByEvent}
              originByEvent={originByEvent}
              companyRatingByEvent={companyRatingByEvent}
              interviewDestinations={interviewDestinations}
              onInterview={onInterview}
              action={<button type="button" className="calendar-day-close" onClick={() => setSelectedDay("")} aria-label={copy.closeDay}>×</button>}
            >
              {selectedApplications && <CalendarApplicationTrigger day={selectedApplications} expanded={applicationDate === selectedApplications.date} onOpen={openApplications} className="calendar-application-open"
                label={copy.applicationDayLabel(selectedApplications.date, selectedApplications.companyCount, selectedApplications.positionCount)}>{copy.aiApplications} · {selectedApplications.companyCount}{copy.applicationCompanyShort} · {copy.applicationPositionCount(selectedApplications.positionCount)} →</CalendarApplicationTrigger>}
            </AgendaGroup>
          )}
          <AgendaGroup
            title={copy.upcomingWeek}
            empty={copy.upcomingEmpty}
            events={upcomingWeek}
            progressByEvent={progressByEvent}
            conflicts={conflicts}
            today={today}
            limit={AGENDA_LIMIT}
            onOpen={openSource}
            interviewTargets={interviewTargets}
            scoreByEvent={scoreByEvent}
            originByEvent={originByEvent}
            companyRatingByEvent={companyRatingByEvent}
            interviewDestinations={interviewDestinations}
            nextEventId={summary.next?.event.id}
            onInterview={onInterview}
          />
          {upcomingLater.length > 0 && (
            <AgendaGroup
              title={copy.later}
              empty=""
              events={upcomingLater}
              progressByEvent={progressByEvent}
              conflicts={conflicts}
              today={today}
              limit={AGENDA_LIMIT}
              onOpen={openSource}
              interviewTargets={interviewTargets}
              scoreByEvent={scoreByEvent}
              originByEvent={originByEvent}
              companyRatingByEvent={companyRatingByEvent}
              interviewDestinations={interviewDestinations}
              nextEventId={summary.next?.event.id}
              onInterview={onInterview}
            />
          )}
          <details className="calendar-history" open={recentOpen} onToggle={(event) => { const open = event.currentTarget.open; setRecentOpen(open); if (open && projection && !projection.recent.loaded) void projection.loadRecent(); }}>
            <summary>
              <span>{copy.recent}</span>
              <strong>{projection ? pulseSummary?.historicalTotal ?? "—" : recent.length}</strong>
            </summary>
            <AgendaGroup
              title={copy.history}
              empty={copy.historyEmpty}
              events={recentDisplayed}
              progressByEvent={progressByEvent}
              conflicts={conflicts}
              today={today}
              // 默认露出最近 6 条（与原先一致），其余用组内「另有 N 项」展开。
              limit={projection?.recent.loaded ? undefined : 6}
              onOpen={openSource}
              interviewTargets={interviewTargets}
              scoreByEvent={scoreByEvent}
              originByEvent={originByEvent}
              companyRatingByEvent={companyRatingByEvent}
              interviewDestinations={interviewDestinations}
              onInterview={onInterview}
            />
            {projection?.recent.loading && <p role="status">{locale === "ja" ? "最近の予定を読み込み中…" : "正在读取最近记录…"}</p>}
            {projection?.recent.error && <div role="alert"><p>{locale === "ja" ? "最近の予定を読み込めませんでした。" : "最近记录读取失败。"}</p><button type="button" onClick={() => void projection.loadRecent()}>{locale === "ja" ? "再試行" : "重试"}</button></div>}
            {projection?.recent.loaded && projection.recent.nextOffset !== null && <button type="button" disabled={projection.recent.loading} onClick={() => void projection.loadRecent()}>{locale === "ja" ? "さらに12件を表示" : "再显示 12 场"}</button>}
          </details>
        </aside>
      </div>
      {applicationDate && <CalendarApplicationPanel key={applicationDate} date={applicationDate} day={projection ? projection.applications.date === applicationDate ? projection.applications.day ?? undefined : undefined : fullApplicationDays.find((day) => day.date === applicationDate)} fetchedAt={projection ? projection.applications.fetchedAt : fetchedAt}
        summary={applicationsByDate.get(applicationDate)} loading={projection ? projection.applications.date !== applicationDate || projection.applications.loading : false} error={projection?.applications.date === applicationDate ? projection.applications.error : ""} onRetry={projection ? () => void projection.loadApplications(applicationDate) : undefined}
        onClose={closeApplications} onOpen={openSource} onOpenCompany={onOpenCompany} />}
    </section>
  );
}

/** 日历卡片只显示公司简称，完整名称保留在按钮提示和读屏说明中。 */
function compactCompany(name: string) {
  const trimmed = name.trim();
  return trimmed.replace(/^(株式会社|有限会社|合同会社)\s*|\s*(株式会社|有限会社|合同会社)$/gu, "").trim() || trimmed;
}

function eventStage(event: CalendarEvent, round: CalendarBadge | null, copy: CalendarCopy) {
  return !round || round.kind === "unknown" ? copy.eventLabel(event.label)
    : round.kind === "casual" || round.kind === "agent" ? copy.meeting : copy.interview;
}

/**
 * 周视图：周一到周日 7 列 + 左侧 JST 时间刻度。
 *
 * 数据与月格是同一份 events、同一套进展与冲突判定；这里只决定摆放。
 * 没写具体时刻的场次进顶部「全天」行，不在时间轴上画出一段并不存在的占用。
 * 位置全用百分比：时间轴高度由 --cw-hours 决定，块的 top/height 跟着刻度范围走，不写死像素。
 */
function WeekBoard({
  weekStart, dir, label, events, today, nowClock, selectedDay, progressByEvent, conflicts,
  interviewTargets, scoreByEvent, originByEvent, companyRatingByEvent, interviewDestinations, onInterview, applicationsByDate, copy, dayLabel, onSelectDay, onShowApplications, applicationDate, onOpenEvent,
}: {
  weekStart: string;
  dir: "prev" | "next" | "";
  label: string;
  events: CalendarEvent[];
  today: string;
  nowClock: ReturnType<typeof jstClock> | null;
  selectedDay: string;
  progressByEvent: ReadonlyMap<string, CalendarProgress>;
  conflicts: ReadonlySet<string>;
  interviewTargets: ReadonlyMap<string, CalendarInterviewTarget>;
  scoreByEvent: ReadonlyMap<string, CalendarInterviewScore | null>;
  originByEvent: ReadonlyMap<string, CalendarEventOrigin>;
  companyRatingByEvent: ReadonlyMap<string, CalendarCompanyRating>;
  interviewDestinations: ReadonlyMap<string, CalendarInterviewDestinations>;
  applicationsByDate: ReadonlyMap<string, CalendarDaySummary>;
  copy: CalendarCopy;
  dayLabel: (key: string) => string;
  onSelectDay: (key: string) => void;
  onShowApplications: OpenApplicationDay;
  applicationDate: string;
  onOpenEvent: (event: CalendarEvent) => void;
  onInterview: (event: CalendarEvent, view?: CalendarInterviewTarget["view"]) => void;
}) {
  const week = useMemo(() => buildCalendarWeek(weekStart, events), [weekStart, events]);
  const { start, end } = week.range;
  const total = end - start;
  const hours = Array.from({ length: total / 60 }, (_, index) => start + index * 60);
  const percent = (minutes: number) => `${((minutes - start) / total) * 100}%`;
  const hasAllDay = week.days.some((day) => day.allDay.length > 0);
  const nowTop = nowClock && nowClock.date === today && nowClock.minutes >= start && nowClock.minutes <= end
    ? percent(nowClock.minutes) : null;
  const eventButton = (event: CalendarEvent, className: string, style?: CSSProperties) => {
    const short = className.includes("cw-short");
    const target = interviewTargets.get(event.id);
    const progress = progressByEvent.get(event.id)!;
    const round = eventRoundBadge(event, copy);
    const conflict = conflicts.has(event.id);
    const actionLabel = eventActionLabel(event, progress, copy, target, conflict, scoreByEvent.get(event.id));
    // 分数一律排进 meta 行末，公司名才拿得回整宽（30 分钟的短块也一样：第一行时刻＋轮次＋分数，第二行公司名）。
    // 排进 meta 行时只写开始时刻：起止＋轮次＋分数放不进一行，结束时刻仍由块的高度与 title 表达。
    const scoreInMeta = Boolean(scoreByEvent.get(event.id));
    const score = <InterviewScoreBadge score={scoreByEvent.get(event.id)} copy={copy} />;
    return (
      <div className={`cw-event-shell${className.includes("cw-block") ? " timed" : ""}`} key={event.id} style={style}><button
        type="button"
        className={`${className} ${event.phase} status-${progress.tone}${conflict ? " conflict" : ""}`}
        onClick={() => onOpenEvent(event)}
        title={actionLabel}
        aria-label={actionLabel}
        data-ranged={event.time && event.endTime ? "" : undefined}
      >
        <span className="cw-block-meta">
          {event.time && <time className="cw-block-time" dateTime={`${event.date}T${event.time}+09:00`}>{scoreInMeta || short ? event.time : calendarEventTime(event)}</time>}
          {round && <RoundBadge round={round} />}
          <span className="cw-block-stage">{eventStage(event, round, copy)}</span>
          {scoreInMeta && score}
        </span>
        <span className="cw-block-title"><strong className="cw-block-company">{compactCompany(event.company)}</strong>{!scoreInMeta && score}{short && <CalendarCompanyRatingBadge rating={companyRatingByEvent.get(event.id)} compact />}</span>
        {!short && <span className="cw-rating-footer"><CalendarCompanyRatingBadge rating={companyRatingByEvent.get(event.id)} compact /></span>}
        <CalendarOriginBadge origin={originByEvent.get(event.id)} compact />
      </button><CalendarInterviewLinks targets={interviewDestinations.get(event.id)} compact onNavigate={(view) => onInterview(event, view)} /></div>
    );
  };
  return (
    <div
      className="calendar-week-view"
      role="group"
      aria-label={copy.weekGrid(label)}
      data-dir={dir || undefined}
      style={{ "--cw-hours": total / 60 } as CSSProperties}
    >
      <div className="cw-head">
        <span className="cw-corner" aria-hidden="true">JST</span>
        {week.days.map((day, index) => {
          const applications = applicationsByDate.get(day.date);
          const className = ["cw-day-head", day.date === today && "today", day.date < today && "past",
            index >= 5 && "weekend", selectedDay === day.date && "selected"].filter(Boolean).join(" ");
          return (
            <div className={className} key={day.date} data-day={day.date} aria-current={day.date === today ? "date" : undefined}>
              <button
                type="button"
                className="cw-day-select"
                aria-pressed={selectedDay === day.date}
                aria-label={copy.selectDay(dayLabel(day.date))}
                // 方向键与 Enter 由日历统一监听（见 onCalendarKey），这里只负责告诉读屏与悬停提示。
                aria-keyshortcuts="ArrowLeft ArrowRight Enter"
                title={copy.weekKeys}
                onClick={() => onSelectDay(day.date)}
              >
                <span className="cw-weekday">{copy.weekdays[index]}</span>
                <time dateTime={day.date}>{Number(day.date.slice(8))}</time>
              </button>
              {applications && (
                <CalendarApplicationTrigger day={applications} expanded={applicationDate === applications.date} onOpen={onShowApplications} className="cw-ai"
                  label={copy.applicationDayLabel(day.date, applications.companyCount, applications.positionCount)}>
                  {copy.aiShort} {applications.companyCount}{copy.applicationCompanyShort}
                </CalendarApplicationTrigger>
              )}
            </div>
          );
        })}
      </div>
      {hasAllDay && (
        <div className="cw-allday">
          <span className="cw-gutter-label" title={copy.allDayHint}>{copy.allDay}</span>
          {week.days.map((day) => (
            <div className={`cw-allday-cell${day.date === today ? " today" : ""}${selectedDay === day.date ? " selected" : ""}`} key={day.date}>
              {day.allDay.map((event) => eventButton(event, "cw-chip"))}
            </div>
          ))}
        </div>
      )}
      <div className="cw-body">
        <div className="cw-times" aria-hidden="true">
          {hours.map((minutes) => <span key={minutes}>{minutesLabel(minutes)}</span>)}
          <span className="cw-time-end">{minutesLabel(end)}</span>
        </div>
        {week.days.map((day, index) => (
          <div
            className={["cw-col", day.date === today && "today", index >= 5 && "weekend", selectedDay === day.date && "selected"].filter(Boolean).join(" ")}
            key={day.date}
            data-day={day.date}
          >
            {/* 每小时 48px，不到 50 分钟的块放不下两行：改成「时刻＋公司」单行，公司名不被挤出可见区。 */}
            {day.blocks.map((block) => eventButton(block.event, block.end - block.start < 50 ? "cw-block cw-short" : "cw-block", {
              top: percent(block.start),
              height: `${((block.end - block.start) / total) * 100}%`,
              left: `calc(${(block.column / block.columns) * 100}% + 2px)`,
              width: `calc(${100 / block.columns}% - 4px)`,
            }))}
            {nowTop && day.date === today && <i className="cw-now" style={{ top: nowTop }} aria-hidden="true" />}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgendaGroup({
  title,
  empty,
  events,
  progressByEvent,
  conflicts,
  today,
  limit,
  detailed = false,
  className,
  action,
  children,
  onOpen,
  interviewTargets,
  scoreByEvent,
  originByEvent,
  companyRatingByEvent,
  interviewDestinations,
  nextEventId,
  onInterview,
}: {
  title: string;
  empty: string;
  events: CalendarEvent[];
  progressByEvent: ReadonlyMap<string, CalendarProgress>;
  conflicts: ReadonlySet<string>;
  today: string;
  limit?: number;
  /** 当日详情：每场下面直接写出进展原因，不用悬停 title 才看得到。 */
  detailed?: boolean;
  className?: string;
  action?: ReactNode;
  children?: ReactNode;
  onOpen: (note: Note) => void;
  interviewTargets: ReadonlyMap<string, CalendarInterviewTarget>;
  scoreByEvent: ReadonlyMap<string, CalendarInterviewScore | null>;
  originByEvent: ReadonlyMap<string, CalendarEventOrigin>;
  companyRatingByEvent: ReadonlyMap<string, CalendarCompanyRating>;
  interviewDestinations: ReadonlyMap<string, CalendarInterviewDestinations>;
  nextEventId?: string;
  onInterview: (event: CalendarEvent, view?: CalendarInterviewTarget["view"]) => void;
}) {
  const { locale } = useUiLocale();
  const copy = CALENDAR_COPY[locale];
  const [expanded, setExpanded] = useState(false);
  const monthFormatter = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "Asia/Tokyo" });
  const shown = limit && !expanded ? events.slice(0, limit) : events;
  return (
    <section className={className ? `agenda-group ${className}` : "agenda-group"}>
      <div className="agenda-heading"><h2>{title}</h2><span>{events.length}</span>{action}</div>
      <div className="agenda-list">
        {shown.map((event) => {
          const target = interviewTargets.get(event.id);
          const progress = progressByEvent.get(event.id)!;
          const round = eventRoundBadge(event, copy);
          const conflict = conflicts.has(event.id);
          const actionLabel = eventActionLabel(event, progress, copy, target, conflict, scoreByEvent.get(event.id));
          const offset = calendarDayOffset(today, event.date);
          return (
            <div className={`agenda-item ${event.phase} kind-${event.kind} status-${progress.tone}${conflict ? " conflict" : ""}`} key={event.id} data-next={event.id === nextEventId ? "" : undefined}>
              <button
                className="agenda-main"
                onClick={() => target ? onInterview(event) : onOpen(event.note)}
                title={actionLabel}
                aria-label={actionLabel}
              >
                <time className="agenda-date" dateTime={event.date}>
                  <span>{monthFormatter.format(new Date(`${event.date}T00:00:00+09:00`))}</span>
                  <strong>{event.date.slice(8)}</strong>
                </time>
                <span className="agenda-copy">
                  <span className="agenda-context">
                    {event.id === nextEventId && <span className="agenda-next-label">{copy.nextUp}</span>}
                    {offset !== null && <span className="agenda-when" data-soon={offset === 0 || offset === 1 ? "" : undefined}>{copy.countdown(offset)}</span>}
                  </span>
                  <strong>{compactCompany(event.company)}</strong>
                  <span className="agenda-event-meta">
                    {event.time && <span className="agenda-time">{calendarEventTime(event)}</span>}
                    {round && <RoundBadge round={round} />}
                    <InterviewScoreBadge score={scoreByEvent.get(event.id)} copy={copy} />
                    <small>{copy.eventLabel(event.label)}</small>
                  </span>
                </span>
                <span className="calendar-status-dot" aria-hidden="true" />
              </button>
              <div className="agenda-signals calendar-card-footer"><CalendarOriginBadge origin={originByEvent.get(event.id)} locale={locale} /><CalendarCompanyRatingBadge rating={companyRatingByEvent.get(event.id)} /></div>
              {detailed && (
                <p className="agenda-progress-detail">
                  <b>{progressLabel(progress, copy)}</b>{copy.progressDetail(progress)}
                </p>
              )}
              <div className="agenda-actions">
                <CalendarInterviewLinks targets={interviewDestinations.get(event.id)} onNavigate={(view) => onInterview(event, view)} />
                {target && (
                  <button
                    className="agenda-source"
                    onClick={() => onOpen(event.note)}
                    aria-label={`${event.date} · ${event.company} · ${copy.eventLabel(event.label)} · ${copy.source}`}
                  >
                    {copy.sourceShort}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {events.length === 0 && empty && <p className="agenda-empty">{empty}</p>}
        {limit !== undefined && events.length > limit && (
          <button type="button" className="agenda-more" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? copy.collapse : copy.more(events.length - limit)}
          </button>
        )}
        {children}
      </div>
    </section>
  );
}

// 外壳的 UI state（⌘K・overlay・移动端菜单）变化时不重渲染整个视圖。
// props 都是稳定引用（notes 整体替换・useCallback 回调・原始值），memo 直接命中。
export default memo(CalendarView);
