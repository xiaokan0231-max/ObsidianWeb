"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { type Note } from "@/lib/notes";
import { type UiLocale } from "@/lib/ui-locale";
import { useUiLocale } from "./ui-locale";
import { CountUp } from "./count-up";
import { enumCodec, useUrlState, type UrlStateCodec } from "./use-url-state";
import { isTypingTarget } from "@/lib/keyboard";
import { calendarMonthDays } from "@/lib/calendar-month";
import { buildCalendarWeek, calendarWeekDays, calendarWeekRangeLabel, calendarWeekStart, jstClock, minutesLabel } from "@/lib/calendar-week";
import { buildAiApplicationDays, type AiApplicationDay } from "@/lib/calendar-applications";
import { calendarConflicts } from "@/lib/calendar-conflicts";
import { isInterviewEvent, type CalendarInterviewTarget } from "@/lib/calendar-interview";
import { calendarProgress, type CalendarProgress } from "@/lib/calendar-progress";
import { buildCalendarSummary, calendarDayOffset, shiftCalendarDay } from "@/lib/calendar-summary";
import { calendarRoundBadge, interviewRound } from "@/lib/interview-round";
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
  progressLegend: "当前进展图例",
  progress: {
    active: "进行中", waiting: "等回复", closed: "已结束", paused: "暂停推进", unknown: "资料待核对",
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
  review: "面试复盘",
  schedule: "查看安排",
  source: "查看原始记录",
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
  statUnknown: "资料待核对",
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
  viewSwitch: "日历视图",
  viewMonth: "月",
  viewWeek: "周",
  previousWeek: "上一周",
  nextWeek: "下一周",
  thisWeek: "本周",
  allDay: "全天",
  allDayHint: "未写具体时刻，不占时间段",
  weekGrid: (range: string) => `${range} · 周视图（日本时间）`,
};
type CalendarCopy = typeof calendarZh;

function japaneseProgressDetail(progress: CalendarProgress) {
  const waitingNote = progress.waitingLabel ? `：${progress.waitingLabel}` : "";
  switch (progress.code) {
    case "rejected": return "この案件は不採用と記録されており、選考は終了しています。";
    case "paused": return `この案件は保留中で、当面は進めません。${progress.reason ? `記録された理由：${progress.reason}。` : ""}`;
    case "offer": return "この案件は内定と記録されています。";
    case "meeting-closed": return "この面談の後続は終了と明記されています。";
    case "scheduled": return "確定済みの予定で、まだ完了の記録はありません。";
    case "waiting-case": return `予定は過ぎ、この案件は${WAITING_FOR_JA[progress.waitingFor ?? ""] ?? "相手"}からの返信待ちです${waitingNote}。`;
    case "active-self": return "予定は過ぎ、案件は進行中です。次の対応は本人側です。";
    case "active-case": return "予定は過ぎ、案件はまだ選考中です。";
    case "meeting-waiting": return `予定は過ぎ、この面談は後続の返信待ちです${waitingNote}。`;
    case "unrecorded": return "この予定の後続状況が記録されていないため、現在の進捗を判断するには資料の確認が必要です。";
  }
}

const CALENDAR_COPY: Record<UiLocale, CalendarCopy> = {
  "zh-CN": calendarZh,
  ja: {
    calendar: "カレンダー", timezone: "日本時間（JST）", progressLegend: "現在の進捗",
    progress: { active: "進行中", waiting: "返信待ち", closed: "終了", paused: "一時保留", unknown: "資料の確認が必要" },
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
    interview: "面接", meeting: "面談", review: "面接の振り返り", schedule: "予定を見る", source: "元の記録を見る",
    conflict: "時間が重複",
    more: (count) => `ほか ${count} 件`, collapse: "閉じる",
    countdown: (days) => days === 0 ? "今日" : days === 1 ? "明日" : days > 1 ? `${days} 日後` : `${-days} 日前`,
    upcomingWeek: "今後 7 日間", upcomingEmpty: "今後 7 日間に確定した予定はありません。",
    later: "その後の予定", recent: "最近の記録", history: "過去の記録", historyEmpty: "過去の予定はまだありません。",
    nextUp: "次の予定", nextNone: "なし",
    stats: "カレンダーの状況", statWeek: "今後 7 日間の予定", statWaiting: "返信待ちの案件",
    statUnknown: "資料の確認が必要", statMonthAi: "今月のAI代行応募",
    selectDay: (label) => `${label} · この日の詳細を見る`, dayDetail: (label) => `${label} · この日`,
    dayEmpty: "この日に確定した予定はありません。", closeDay: "この日の詳細を閉じる",
    aiApplications: "AI代行応募", aiShort: "代行", aiApplicationsToday: "今日のAI代行応募", applicationCompanyUnit: "社",
    applicationCompanyShort: "社",
    applicationPositionCount: (count) => `${count} 求人`,
    applicationDayLabel: (date, companies, positions) => `${date} JST · AI代行応募 ${companies} 社 · ${positions} 求人 · 応募の詳細を開く`,
    applicationNoPosition: "職種未記載", applicationSubmission: (agent) => `${agent} が提出`, applicationRecord: "記録を見る",
    applicationRecordLabel: (date, company, position, agent) => `${date} JST · ${company} · ${position} · ${agent} が提出 · 応募記録を見る`,
    applicationsLoading: "応募記録を読み込み中…", applicationsEmpty: "今日の確認済みAI代行応募はありません。",
    viewSwitch: "カレンダーの表示", viewMonth: "月", viewWeek: "週",
    previousWeek: "前の週", nextWeek: "次の週", thisWeek: "今週",
    allDay: "終日", allDayHint: "時刻の記載がなく、時間帯を占めません",
    weekGrid: (range) => `${range} · 週表示（日本時間）`,
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

function interviewDestination(target: CalendarInterviewTarget, copy: CalendarCopy) {
  return target.view === "review" ? copy.review : copy.schedule;
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
  return progress.code === "scheduled" ? copy.pending : progress.code === "offer" ? copy.offer : copy.progress[progress.tone];
}

function eventActionLabel(event: CalendarEvent, progress: CalendarProgress, copy: CalendarCopy, target?: CalendarInterviewTarget, conflict = false) {
  const round = eventRoundBadge(event, copy);
  const context = [event.date, calendarEventTime(event), "JST", event.company, event.label,
    round?.kind === "unknown" ? copy.unknownRound : ""].filter(Boolean).join(" · ");
  return `${context} · ${progressLabel(progress, copy)}：${copy.progressDetail(progress)} · ${target ? interviewDestination(target, copy) : copy.source}${conflict ? ` · ${copy.conflict}` : ""}`;
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
}: {
  events: CalendarEvent[];
  notes: Note[];
  onOpen: (note: Note) => void;
  interviewTargets: ReadonlyMap<string, CalendarInterviewTarget>;
  onInterview: (event: CalendarEvent) => void;
  loading?: boolean;
  /** 「今日」は殻が持つ。memo 越しなので中で求めると日付を跨いでも昨日のままになる。 */
  today: string;
}) {
  const { locale } = useUiLocale();
  const copy = CALENDAR_COPY[locale];
  const sectionRef = useRef<HTMLElement>(null);
  const [month, setMonth] = useState(() => {
    const requested = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("month") ?? "";
    return /^20\d{2}-\d{2}$/.test(requested) ? monthOf(`${requested}-01`) : monthOf(today);
  });
  // 只记录用户翻月的方向；首次进入不带方向，入场交给视图转场，不和月格滑入叠在一起。
  const [monthDir, setMonthDir] = useState<"prev" | "next" | "">("");
  // 空串＝没有主动选中：键盘与「今天」以 today 为起点，但侧栏不常驻一块与「未来 7 天」重复的当日详情。
  const [selectedDay, setSelectedDay] = useState("");
  const [focusTone, setFocusTone] = useState<ProgressTone | "">("");
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
  const applicationDays = useMemo(() => buildAiApplicationDays(notes, today), [notes, today]);
  const applicationsByDate = useMemo(() => new Map(applicationDays.map((day) => [day.date, day])), [applicationDays]);
  const progressByEvent = useMemo(() => new Map(events.map((event) => [
    event.id, calendarProgress(event, notes, interviewTargets.get(event.id)),
  ])), [events, notes, interviewTargets]);
  // 已结束案件残留的旧预约不算撞期：拒信之后那一格不会再去。
  const conflicts = useMemo(() => calendarConflicts(events.filter((event) =>
    progressByEvent.get(event.id)?.tone !== "closed")), [events, progressByEvent]);
  const summary = useMemo(() => buildCalendarSummary({ events, progressByEvent, applicationDays, today }),
    [events, progressByEvent, applicationDays, today]);
  const horizon = shiftCalendarDay(today, 6);
  const upcomingAll = events.filter((event) => event.phase === "upcoming");
  const upcomingWeek = upcomingAll.filter((event) => event.date <= horizon);
  const upcomingLater = upcomingAll.filter((event) => event.date > horizon);
  const recent = events
    .filter((event) => event.phase === "past")
    .sort((left, right) => right.date.localeCompare(left.date) || right.time.localeCompare(left.time))
    .slice(0, 6);
  const selectedEvents = selectedDay ? eventsByDate.get(selectedDay) ?? [] : [];
  const selectedApplications = selectedDay && selectedDay !== today ? applicationsByDate.get(selectedDay) : undefined;

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
    sectionRef.current?.querySelector<HTMLButtonElement>(`[data-day="${key}"] .calendar-day-select`)?.focus();
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
  const openEvent = (event: CalendarEvent) => interviewTargets.get(event.id) ? onInterview(event) : onOpen(event.note);

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
  // 今天的 AI 代投已在侧栏「今日 AI 代投」里列出，当日详情不再重复一份；
  // 点今天的代投标记时把那一块带进视野，免得点了看不出任何变化。
  const showWeekApplications = (key: string) => {
    if (selectedDay !== key) setSelectedDay(key);
    if (key === today) sectionRef.current?.querySelector(".calendar-application-summary")?.scrollIntoView({ block: "nearest" });
  };

  const onCalendarKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
    const section = sectionRef.current;
    const target = event.target;
    const fromPage = target === document.body || target === document.documentElement;
    // 抽屉、⌘K 等浮层里的按键不归日历管；R / ⌘K / Esc 都留给外壳。
    if (!section || (!fromPage && !(target instanceof Node && section.contains(target)))) return;
    // 浮层开着而焦点掉回 body 时（关掉内层阅读层之类），方向键不能在浮层背后翻日历。
    if (section.closest("[inert]") || document.querySelector('[aria-modal="true"]')) return;
    const key = event.key;
    if (calView === "week") {
      // 周视图里没有「格子间移动」：左右与方括号都是整周翻页，T 回到本周。
      if (key === "[" || key === "]" || key === "ArrowLeft" || key === "ArrowRight") {
        event.preventDefault();
        moveWeek(key === "[" || key === "ArrowLeft" ? -1 : 1);
      } else if (key.toLowerCase() === "t") {
        event.preventDefault();
        goThisWeek();
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

  const nextProgress = summary.next ? progressByEvent.get(summary.next.event.id) : undefined;
  const weekLabel = calendarWeekRangeLabel(weekStart, today.slice(0, 4));

  return (
    <section className="calendar-view" ref={sectionRef} data-focus-tone={focusTone || undefined}>
      <h1 className="sr-only">{copy.calendar}</h1>
      <div className="calendar-stat page-stat-strip module-stat-strip" role="group" aria-label={copy.stats} aria-busy={loading || undefined}>
        <div className="calendar-stat-tile">
          <span>{copy.statWeek}</span>
          {loading ? <i className="skeleton calendar-stat-skeleton" aria-hidden="true" /> : <CountUp as="strong" value={summary.weekCount} />}
        </div>
        <div className="calendar-stat-tile calendar-stat-next" data-urgent={summary.next && summary.next.days <= 1 ? "" : undefined}>
          <span>{copy.nextUp}</span>
          {loading ? <i className="skeleton calendar-stat-skeleton" aria-hidden="true" /> : summary.next ? (
            <>
              <strong>{copy.countdown(summary.next.days)}</strong>
              <small>{summary.next.event.company}</small>
            </>
          ) : <strong>{copy.nextNone}</strong>}
        </div>
        {([["waiting", copy.statWaiting, summary.waitingCount], ["unknown", copy.statUnknown, summary.unknownCount]] as const).map(([tone, label, count]) => (
          <button
            key={tone}
            type="button"
            className={`calendar-stat-tile status-${tone}`}
            aria-pressed={focusTone === tone}
            title={copy.focusTone(copy.progress[tone])}
            disabled={loading}
            onClick={() => toggleFocusTone(tone)}
          >
            <span>{label}</span>
            {loading ? <i className="skeleton calendar-stat-skeleton" aria-hidden="true" /> : <CountUp as="strong" value={count} />}
          </button>
        ))}
        <div className="calendar-stat-tile">
          <span>{copy.statMonthAi}</span>
          {loading ? <i className="skeleton calendar-stat-skeleton" aria-hidden="true" /> : (
            <><CountUp as="strong" value={summary.monthAiCompanies} /><small>{copy.applicationCompanyUnit}</small></>
          )}
        </div>
      </div>
      <div className="calendar-layout">
        <div className="calendar-board">
          <div className="calendar-toolbar">
            <h2>
              {calView === "week"
                ? <span className="calendar-month-label" key={`week-${weekStart}`} data-dir={weekDir || undefined}>{weekLabel}</span>
                : <span className="calendar-month-label" key={monthKey} data-dir={monthDir || undefined}>{monthLabel}</span>}
              <small className="calendar-timezone">{copy.timezone}</small>
            </h2>
            <ul className="calendar-legend calendar-progress-legend" aria-label={copy.progressLegend}>
              {(Object.keys(copy.progress) as ProgressTone[]).map((tone) => (
                <li className={`calendar-legend-item status-${tone}`} key={tone}>
                  <button type="button" aria-pressed={focusTone === tone} title={copy.focusTone(copy.progress[tone])} onClick={() => toggleFocusTone(tone)}>
                    <i className="calendar-status-dot" aria-hidden="true" />
                    {copy.progress[tone]}
                  </button>
                </li>
              ))}
            </ul>
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
              applicationsByDate={applicationsByDate}
              copy={copy}
              dayLabel={dayLabel}
              onSelectDay={(key) => setSelectedDay((current) => current === key ? "" : key)}
              onShowApplications={showWeekApplications}
              onOpenEvent={openEvent}
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
                              const stage = !round || round.kind === "unknown" ? event.label
                                : round.kind === "casual" || round.kind === "agent" ? copy.meeting : copy.interview;
                              const actionLabel = eventActionLabel(event, progress, copy, target, conflict);
                              return (
                                <button
                                  className={`calendar-event ${event.phase} kind-${event.kind} status-${progress.tone}${conflict ? " conflict" : ""}`}
                                  key={event.id}
                                  onClick={() => openEvent(event)}
                                  title={actionLabel}
                                  aria-label={actionLabel}
                                >
                                  <span className="calendar-status-dot" aria-hidden="true" />
                                  <span className="calendar-event-heading">
                                    {round && <RoundBadge round={round} />}
                                    <span className="calendar-event-stage">{stage}</span>
                                  </span>
                                  {event.time && <time className="calendar-event-time" dateTime={`${event.date}T${event.time}+09:00`}>{calendarEventTime(event)}</time>}
                                  <strong>{event.company}</strong>
                                  {target && <span className="calendar-interview-destination" aria-hidden="true">{interviewDestination(target, copy)} →</span>}
                                </button>
                              );
                            })}
                            {dayEvents.length > 3 && (
                              <button className="calendar-more" onClick={() => selectDay(day.key)}>
                                {copy.more(dayEvents.length - 3)}
                              </button>
                            )}
                          </div>
                          {applications && (
                            <details className="calendar-ai-applications">
                              <summary
                                aria-label={copy.applicationDayLabel(day.key, applications.companyCount, applications.positionCount)}
                                data-heat={Math.min(applications.companyCount, 4)}
                                onClick={() => setSelectedDay(day.key)}
                              >
                                <strong>{copy.aiShort} {applications.companyCount}{copy.applicationCompanyShort}</strong>
                                <small>{copy.applicationPositionCount(applications.positionCount)}</small>
                              </summary>
                              <ApplicationList day={applications} onOpen={onOpen} copy={copy} />
                            </details>
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
          {summary.next && nextProgress && (
            <NextHero
              event={summary.next.event}
              days={summary.next.days}
              progress={nextProgress}
              target={interviewTargets.get(summary.next.event.id)}
              copy={copy}
              locale={locale}
              onOpen={onOpen}
              onInterview={onInterview}
            />
          )}
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
              onOpen={onOpen}
              interviewTargets={interviewTargets}
              onInterview={onInterview}
              action={<button type="button" className="calendar-day-close" onClick={() => setSelectedDay("")} aria-label={copy.closeDay}>×</button>}
            >
              {selectedApplications && <ApplicationList day={selectedApplications} onOpen={onOpen} copy={copy} />}
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
            onOpen={onOpen}
            interviewTargets={interviewTargets}
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
              onOpen={onOpen}
              interviewTargets={interviewTargets}
              onInterview={onInterview}
            />
          )}
          <section className="calendar-application-summary" aria-label={copy.aiApplicationsToday}>
            <h2>{copy.aiApplicationsToday}</h2>
            <time dateTime={today}>{today} · JST</time>
            {loading ? <p className="agenda-empty">{copy.applicationsLoading}</p> : (
              <>
                <p className="calendar-application-count"><CountUp as="strong" value={applicationsByDate.get(today)?.companyCount ?? 0} /> {copy.applicationCompanyUnit} · {copy.applicationPositionCount(applicationsByDate.get(today)?.positionCount ?? 0)}</p>
                {applicationsByDate.has(today)
                  ? <ApplicationList day={applicationsByDate.get(today)!} onOpen={onOpen} copy={copy} limit={AGENDA_LIMIT} />
                  : <p className="agenda-empty">{copy.applicationsEmpty}</p>}
              </>
            )}
          </section>
          <details className="calendar-history">
            <summary>
              <span>{copy.recent}</span>
              <strong>{recent.length}</strong>
            </summary>
            <AgendaGroup
              title={copy.history}
              empty={copy.historyEmpty}
              events={recent}
              progressByEvent={progressByEvent}
              conflicts={conflicts}
              today={today}
              onOpen={onOpen}
              interviewTargets={interviewTargets}
              onInterview={onInterview}
            />
          </details>
        </aside>
      </div>
    </section>
  );
}

function eventStage(event: CalendarEvent, round: CalendarBadge | null, copy: CalendarCopy) {
  return !round || round.kind === "unknown" ? event.label
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
  interviewTargets, applicationsByDate, copy, dayLabel, onSelectDay, onShowApplications, onOpenEvent,
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
  applicationsByDate: ReadonlyMap<string, AiApplicationDay>;
  copy: CalendarCopy;
  dayLabel: (key: string) => string;
  onSelectDay: (key: string) => void;
  onShowApplications: (key: string) => void;
  onOpenEvent: (event: CalendarEvent) => void;
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
    const target = interviewTargets.get(event.id);
    const progress = progressByEvent.get(event.id)!;
    const round = eventRoundBadge(event, copy);
    const conflict = conflicts.has(event.id);
    const actionLabel = eventActionLabel(event, progress, copy, target, conflict);
    return (
      <button
        type="button"
        className={`${className} ${event.phase} status-${progress.tone}${conflict ? " conflict" : ""}`}
        key={event.id}
        style={style}
        onClick={() => onOpenEvent(event)}
        title={actionLabel}
        aria-label={actionLabel}
      >
        <span className="cw-block-meta">
          {event.time && <time className="cw-block-time" dateTime={`${event.date}T${event.time}+09:00`}>{calendarEventTime(event)}</time>}
          {round && <RoundBadge round={round} />}
          <span className="cw-block-stage">{eventStage(event, round, copy)}</span>
        </span>
        <strong className="cw-block-company">{event.company}</strong>
      </button>
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
                onClick={() => onSelectDay(day.date)}
              >
                <span className="cw-weekday">{copy.weekdays[index]}</span>
                <time dateTime={day.date}>{Number(day.date.slice(8))}</time>
              </button>
              {applications && (
                <button
                  type="button"
                  className="cw-ai"
                  data-heat={Math.min(applications.companyCount, 4)}
                  aria-label={copy.applicationDayLabel(day.date, applications.companyCount, applications.positionCount)}
                  onClick={() => onShowApplications(day.date)}
                >
                  {copy.aiShort} {applications.companyCount}{copy.applicationCompanyShort}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {hasAllDay && (
        <div className="cw-allday">
          <span className="cw-gutter-label" title={copy.allDayHint}>{copy.allDay}</span>
          {week.days.map((day) => (
            <div className={`cw-allday-cell${day.date === today ? " today" : ""}`} key={day.date}>
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
            className={["cw-col", day.date === today && "today", index >= 5 && "weekend"].filter(Boolean).join(" ")}
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

function NextHero({ event, days, progress, target, copy, locale, onOpen, onInterview }: {
  event: CalendarEvent;
  days: number;
  progress: CalendarProgress;
  target?: CalendarInterviewTarget;
  copy: CalendarCopy;
  locale: UiLocale;
  onOpen: (note: Note) => void;
  onInterview: (event: CalendarEvent) => void;
}) {
  const round = eventRoundBadge(event, copy);
  const date = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo" })
    .format(new Date(`${event.date}T00:00:00+09:00`));
  const when = event.time ? `${date} · ${calendarEventTime(event)} JST` : `${date} · JST`;
  return (
    <section className="calendar-next-hero" aria-label={copy.nextUp} data-urgent={days <= 1 ? "" : undefined}>
      <div className="calendar-next-head">
        <span className="calendar-next-kicker">{copy.nextUp}</span>
        <span className="calendar-next-countdown">{copy.countdown(days)}</span>
      </div>
      <strong className="calendar-next-company">{event.company}</strong>
      <div className="calendar-next-meta">
        {round && <RoundBadge round={round} />}
        <span>{event.label}</span>
      </div>
      <time className="calendar-next-when" dateTime={event.time ? `${event.date}T${event.time}+09:00` : event.date}>{when}</time>
      <div className="calendar-next-actions">
        <button
          type="button"
          className="calendar-next-primary"
          onClick={() => target ? onInterview(event) : onOpen(event.note)}
          aria-label={eventActionLabel(event, progress, copy, target)}
        >
          {target ? interviewDestination(target, copy) : copy.source} <span aria-hidden="true">→</span>
        </button>
        {target && (
          <button type="button" className="calendar-next-source" onClick={() => onOpen(event.note)}>
            {copy.source}
          </button>
        )}
      </div>
    </section>
  );
}

function ApplicationList({ day, onOpen, copy, limit }: { day: AiApplicationDay; onOpen: (note: Note) => void; copy: CalendarCopy; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = limit && !expanded ? Math.max(0, day.applications.length - limit) : 0;
  return (
    <>
      <ul className="calendar-application-list">
        {day.applications.slice(0, hidden ? limit : undefined).map((application) => (
          <li key={application.id}>
            <button
              onClick={() => onOpen(application.note)}
              aria-label={copy.applicationRecordLabel(day.date, application.company, application.position || copy.applicationNoPosition, application.agent)}
            >
              <strong>{application.company}</strong>
              <span>{application.position || copy.applicationNoPosition}</span>
              <small>{copy.applicationSubmission(application.agent)} · {copy.applicationRecord} →</small>
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 && <button type="button" className="agenda-more" onClick={() => setExpanded(true)}>{copy.more(hidden)}</button>}
    </>
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
  onInterview: (event: CalendarEvent) => void;
}) {
  const { locale } = useUiLocale();
  const copy = CALENDAR_COPY[locale];
  const [expanded, setExpanded] = useState(false);
  const dateFormatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "Asia/Tokyo" });
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
          const actionLabel = eventActionLabel(event, progress, copy, target, conflict);
          const offset = calendarDayOffset(today, event.date);
          return (
            <div className={`agenda-item ${event.phase} kind-${event.kind} status-${progress.tone}${conflict ? " conflict" : ""}`} key={event.id}>
              <button
                className="agenda-main"
                onClick={() => target ? onInterview(event) : onOpen(event.note)}
                title={actionLabel}
                aria-label={actionLabel}
              >
                <time dateTime={event.date}>
                  <strong>{event.date.slice(8)}</strong>
                  <span>{dateFormatter.format(new Date(`${event.date}T00:00:00+09:00`))}</span>
                </time>
                <span className="agenda-copy">
                  <span className="agenda-event-meta">
                    {round && <RoundBadge round={round} />}
                    <small>{event.time ? `${calendarEventTime(event)} · ${event.label}` : event.label}</small>
                    {offset !== null && <span className="agenda-when" data-soon={offset === 0 || offset === 1 ? "" : undefined}>{copy.countdown(offset)}</span>}
                  </span>
                  <strong>{event.company}</strong>
                  {target && <span className="calendar-interview-destination" aria-hidden="true">{interviewDestination(target, copy)} →</span>}
                </span>
                <span className="calendar-status-dot" aria-hidden="true" />
              </button>
              {detailed && (
                <p className="agenda-progress-detail">
                  <b>{progressLabel(progress, copy)}</b>{copy.progressDetail(progress)}
                </p>
              )}
              {target && (
                <button
                  className="agenda-source"
                  onClick={() => onOpen(event.note)}
                  aria-label={`${event.date} · ${event.company} · ${event.label} · ${copy.source}`}
                >
                  {copy.source}
                </button>
              )}
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
