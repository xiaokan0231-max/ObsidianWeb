"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { type Note } from "@/lib/notes";
import { type UiLocale } from "@/lib/ui-locale";
import { useUiLocale } from "./ui-locale";
import { calendarMonthDays } from "@/lib/calendar-month";
import { isInterviewEvent, type CalendarInterviewTarget } from "@/lib/calendar-interview";
import { calendarProgress, type CalendarProgress } from "@/lib/calendar-progress";
import { calendarRoundBadge, interviewRound } from "@/lib/interview-round";
import {
  calendarEventTime,
  localDateKey,
  type CalendarEvent,
} from "@/lib/memory-atlas-data";

const calendarZh = {
  calendar: "日历",
  timezone: "日本时间（JST）",
  progressLegend: "当前进展图例",
  progress: {
    active: "进行中", waiting: "等回复", closed: "已结束", paused: "暂停推进", unknown: "资料待核对",
  } satisfies Record<CalendarProgress["tone"], string>,
  pending: "待进行",
  offer: "已获内定",
  previousMonth: "上一个月",
  nextMonth: "下一个月",
  today: "今天",
  weekdays: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
  rounds: "面试轮次",
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
  more: (count: number) => `另有 ${count} 项`,
  upcomingWeek: "未来 7 天",
  upcomingEmpty: "未来七天没有已确认的安排。",
  later: "稍后安排",
  recent: "最近记录",
  history: "历史事实",
  historyEmpty: "还没有历史日程。",
};
type CalendarCopy = typeof calendarZh;
const CALENDAR_COPY: Record<UiLocale, CalendarCopy> = {
  "zh-CN": calendarZh,
  ja: {
    calendar: "カレンダー", timezone: "日本時間（JST）", progressLegend: "現在の進捗",
    progress: { active: "進行中", waiting: "返信待ち", closed: "終了", paused: "一時保留", unknown: "資料の確認が必要" },
    pending: "実施予定", offer: "内定獲得",
    previousMonth: "前の月", nextMonth: "次の月", today: "今日",
    weekdays: ["月", "火", "水", "木", "金", "土", "日"],
    rounds: "面接の段階",
    roundLegend: "面接の段階：0 はカジュアル面談、1、2、3 などの数字は正式な面接回数、終は最終面接、エはエージェント面談、疑問符は段階未確認",
    casual: "カジュアル面談", numbered: "… 正式な面接", numberedRound: (mark) => `${mark} 次面接`,
    final: "最終面接", finalShort: "最終面接", finalMark: "終",
    agent: "エージェント面談", agentShort: "エージェント", agentMark: "エ", agentDetail: "エージェント面談：正式な選考回数には含まれません",
    unknownRound: "段階未確認", unknownShort: "未確認", unknownDetail: "段階未確認：この記録では選考段階が明示されていません",
    interview: "面接", meeting: "面談", review: "面接の振り返り", schedule: "予定を見る", source: "元の記録を見る",
    more: (count) => `ほか ${count} 件`, upcomingWeek: "今後 7 日間", upcomingEmpty: "今後 7 日間に確定した予定はありません。",
    later: "その後の予定", recent: "最近の記録", history: "過去の記録", historyEmpty: "過去の予定はまだありません。",
  },
};

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

function eventActionLabel(event: CalendarEvent, progress: CalendarProgress, copy: CalendarCopy, target?: CalendarInterviewTarget) {
  const round = eventRoundBadge(event, copy);
  const context = [event.date, calendarEventTime(event), "JST", event.company, event.label,
    round?.kind === "unknown" ? copy.unknownRound : ""].filter(Boolean).join(" · ");
  const progressLabel = progress.label === "待进行" ? copy.pending : progress.label === "已获内定" ? copy.offer : copy.progress[progress.tone];
  return `${context} · ${progressLabel}：${progress.detail} · ${target ? interviewDestination(target, copy) : copy.source}`;
}

function CalendarView({
  events,
  notes,
  today,
  onOpen,
  interviewTargets,
  onInterview,
}: {
  events: CalendarEvent[];
  notes: Note[];
  onOpen: (note: Note) => void;
  interviewTargets: ReadonlyMap<string, CalendarInterviewTarget>;
  onInterview: (event: CalendarEvent) => void;
  /** 「今日」は殻が持つ。memo 越しなので中で求めると日付を跨いでも昨日のままになる。 */
  today: string;
}) {
  const { locale } = useUiLocale();
  const copy = CALENDAR_COPY[locale];
  const [month, setMonth] = useState(() => {
    const requested = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("month") ?? "";
    if (/^20\d{2}-\d{2}$/.test(requested)) {
      const [year, monthNumber] = requested.split("-").map(Number);
      return new Date(year, monthNumber - 1, 1);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [expandedDay, setExpandedDay] = useState("");
  const monthLabel = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
  }).format(month);
  const days = calendarMonthDays(month).map((date) => ({
    date,
    key: localDateKey(date),
    inMonth: date.getMonth() === month.getMonth(),
  }));
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((event) => map.set(event.date, [...(map.get(event.date) ?? []), event]));
    return map;
  }, [events]);
  const progressByEvent = useMemo(() => new Map(events.map((event) => [
    event.id, calendarProgress(event, notes, interviewTargets.get(event.id)),
  ])), [events, notes, interviewTargets]);
  const horizon = (() => {
    const [year, monthNumber, day] = today.split("-").map(Number);
    return localDateKey(new Date(year, monthNumber - 1, day + 6));
  })();
  const upcomingAll = events.filter((event) => event.phase === "upcoming");
  const upcomingWeek = upcomingAll.filter((event) => event.date <= horizon);
  const upcomingLater = upcomingAll.filter((event) => event.date > horizon).slice(0, 5);
  const recent = events
    .filter((event) => event.phase === "past")
    .sort((left, right) => right.date.localeCompare(left.date) || right.time.localeCompare(left.time))
    .slice(0, 6);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("month", `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
  }, [month]);

  const moveMonth = (offset: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  return (
    <section className="calendar-view">
      <h1 className="sr-only">{copy.calendar}</h1>
      <div className="calendar-layout">
        <div className="calendar-board">
          <div className="calendar-toolbar">
            <h2>{monthLabel}<small className="calendar-timezone">{copy.timezone}</small></h2>
            <ul className="calendar-legend calendar-progress-legend" aria-label={copy.progressLegend}>
              {(Object.keys(copy.progress) as CalendarProgress["tone"][]).map((tone) => (
                <li className={`calendar-legend-item status-${tone}`} key={tone}>
                  <i className="calendar-status-dot" aria-hidden="true" />
                  {copy.progress[tone]}
                </li>
              ))}
            </ul>
            <div className="calendar-actions">
              <button onClick={() => moveMonth(-1)} aria-label={copy.previousMonth}>←</button>
              <button
                onClick={() => {
                  const now = new Date();
                  setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                }}
              >
                {copy.today}
              </button>
              <button onClick={() => moveMonth(1)} aria-label={copy.nextMonth}>→</button>
            </div>
          </div>
          <RoundLegend copy={copy} />
          <div className="calendar-grid-scroll">
            <div className="calendar-grid">
              {copy.weekdays.map((weekday) => (
                <div className="calendar-weekday" key={weekday}>{weekday}</div>
              ))}
              {days.map((day) => {
                const dayEvents = eventsByDate.get(day.key) ?? [];
                return (
                  <div
                    className={`calendar-day ${day.inMonth ? "" : "outside"} ${day.key === today ? "today" : ""}`}
                    key={day.key}
                  >
                    <div className="calendar-day-number">
                      <time dateTime={day.key}>{day.date.getDate()}</time>
                      {day.key === today && <span>{copy.today}</span>}
                    </div>
                    <div className="calendar-day-events">
                      {dayEvents.slice(0, expandedDay === day.key ? dayEvents.length : 3).map((event) => {
                        const target = interviewTargets.get(event.id);
                        const progress = progressByEvent.get(event.id)!;
                        const round = eventRoundBadge(event, copy);
                        const stage = !round || round.kind === "unknown" ? event.label
                          : round.kind === "casual" || round.kind === "agent" ? copy.meeting : copy.interview;
                        const actionLabel = eventActionLabel(event, progress, copy, target);
                        return (
                          <button
                            className={`calendar-event ${event.phase} kind-${event.kind} status-${progress.tone}`}
                            key={event.id}
                            onClick={() => target ? onInterview(event) : onOpen(event.note)}
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
                      {dayEvents.length > 3 && expandedDay !== day.key && (
                        <button className="calendar-more" onClick={() => setExpandedDay(day.key)}>
                          {copy.more(dayEvents.length - 3)}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="calendar-agenda">
          <AgendaGroup
            title={copy.upcomingWeek}
            empty={copy.upcomingEmpty}
            events={upcomingWeek}
            progressByEvent={progressByEvent}
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
              onOpen={onOpen}
              interviewTargets={interviewTargets}
              onInterview={onInterview}
            />
          )}
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

function AgendaGroup({
  title,
  empty,
  events,
  progressByEvent,
  onOpen,
  interviewTargets,
  onInterview,
}: {
  title: string;
  empty: string;
  events: CalendarEvent[];
  progressByEvent: ReadonlyMap<string, CalendarProgress>;
  onOpen: (note: Note) => void;
  interviewTargets: ReadonlyMap<string, CalendarInterviewTarget>;
  onInterview: (event: CalendarEvent) => void;
}) {
  const { locale } = useUiLocale();
  const copy = CALENDAR_COPY[locale];
  const dateFormatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "Asia/Tokyo" });
  return (
    <section className="agenda-group">
      <div className="agenda-heading"><h2>{title}</h2><span>{events.length}</span></div>
      <div className="agenda-list">
        {events.map((event) => {
          const target = interviewTargets.get(event.id);
          const progress = progressByEvent.get(event.id)!;
          const round = eventRoundBadge(event, copy);
          const actionLabel = eventActionLabel(event, progress, copy, target);
          return (
            <div className={`agenda-item ${event.phase} kind-${event.kind} status-${progress.tone}`} key={event.id}>
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
                  </span>
                  <strong>{event.company}</strong>
                  {target && <span className="calendar-interview-destination" aria-hidden="true">{interviewDestination(target, copy)} →</span>}
                </span>
                <span className="calendar-status-dot" aria-hidden="true" />
              </button>
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
        {events.length === 0 && <p className="agenda-empty">{empty}</p>}
      </div>
    </section>
  );
}

// 外壳的 UI state（⌘K・overlay・移动端菜单）变化时不重渲染整个视圖。
// props 都是稳定引用（notes 整体替换・useCallback 回调・原始值），memo 直接命中。
export default memo(CalendarView);
