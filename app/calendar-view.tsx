"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { formatDate, type Note } from "@/lib/notes";
import { calendarMonthDays } from "@/lib/calendar-month";
import { isInterviewEvent, type CalendarInterviewTarget } from "@/lib/calendar-interview";
import { calendarProgress, type CalendarProgress } from "@/lib/calendar-progress";
import { calendarRoundBadge, interviewRound } from "@/lib/interview-round";
import {
  calendarEventTime,
  localDateKey,
  type CalendarEvent,
} from "@/lib/memory-atlas-data";

const PROGRESS_LEGEND = {
  active: "进行中",
  waiting: "等回复",
  closed: "已结束",
  paused: "暂停推进",
  unknown: "资料待核对",
} satisfies Record<CalendarProgress["tone"], string>;

function interviewDestination(target: CalendarInterviewTarget) {
  return target.view === "review" ? "面试复盘" : "查看安排";
}

type CalendarBadge = NonNullable<ReturnType<typeof calendarRoundBadge>> | {
  mark: "?" | "猎";
  label: string;
  kind: "unknown" | "agent";
};

function eventRoundBadge(event: CalendarEvent): CalendarBadge | null {
  if (!isInterviewEvent(event)) return null;
  return calendarRoundBadge(event.label) ?? (interviewRound(event.label) === "agent"
    ? { mark: "猎", label: "猎头面谈，不计入正式选考轮次", kind: "agent" }
    : { mark: "?", label: "轮次待确认：本场资料未明确选考阶段", kind: "unknown" });
}

function RoundBadge({ round }: { round: CalendarBadge }) {
  return <span className={`calendar-round-badge round-${round.kind}`} title={round.label} aria-hidden="true">{round.mark}</span>;
}

function RoundLegend() {
  return (
    <div className="calendar-round-legend" role="note" aria-label="面试轮次：0 轻松面谈，1、2、3 等数字为正式轮次，终为最终面试，猎为猎头面谈，问号为轮次待确认">
      <span className="calendar-round-legend-title">面试轮次</span>
      <span className="calendar-round-legend-item"><RoundBadge round={{ mark: "0", label: "轻松面谈", kind: "casual" }} />轻松面谈</span>
      <span className="calendar-round-legend-item">
        <span className="calendar-round-sequence" aria-hidden="true">
          {["1", "2", "3"].map((mark) => <RoundBadge key={mark} round={{ mark, label: `第 ${mark} 轮面试`, kind: "numbered" }} />)}
        </span>
        <span>… 正式轮次</span>
      </span>
      <span className="calendar-round-legend-item"><RoundBadge round={{ mark: "终", label: "最终面试", kind: "final" }} />终面</span>
      <span className="calendar-round-legend-item"><RoundBadge round={{ mark: "猎", label: "猎头面谈", kind: "agent" }} />猎头</span>
      <span className="calendar-round-legend-item"><RoundBadge round={{ mark: "?", label: "轮次待确认", kind: "unknown" }} />待确认</span>
    </div>
  );
}

function eventActionLabel(event: CalendarEvent, progress: CalendarProgress, target?: CalendarInterviewTarget) {
  const round = eventRoundBadge(event);
  const context = [event.date, calendarEventTime(event), "JST", event.company, event.label,
    round?.kind === "unknown" ? "轮次待确认" : ""].filter(Boolean).join(" · ");
  return `${context} · ${progress.label}：${progress.detail} · ${target ? interviewDestination(target) : "查看原始记录"}`;
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
  const monthLabel = new Intl.DateTimeFormat("zh-CN", {
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
      <h1 className="sr-only">日历</h1>
      <div className="calendar-layout">
        <div className="calendar-board">
          <div className="calendar-toolbar">
            <h2>{monthLabel}<small className="calendar-timezone">日本时间（JST）</small></h2>
            <ul className="calendar-legend calendar-progress-legend" aria-label="当前进展图例">
              {(Object.keys(PROGRESS_LEGEND) as CalendarProgress["tone"][]).map((tone) => (
                <li className={`calendar-legend-item status-${tone}`} key={tone}>
                  <i className="calendar-status-dot" aria-hidden="true" />
                  {PROGRESS_LEGEND[tone]}
                </li>
              ))}
            </ul>
            <div className="calendar-actions">
              <button onClick={() => moveMonth(-1)} aria-label="上一个月">←</button>
              <button
                onClick={() => {
                  const now = new Date();
                  setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                }}
              >
                今天
              </button>
              <button onClick={() => moveMonth(1)} aria-label="下一个月">→</button>
            </div>
          </div>
          <RoundLegend />
          <div className="calendar-grid-scroll">
            <div className="calendar-grid">
              {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((weekday) => (
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
                      {day.key === today && <span>今天</span>}
                    </div>
                    <div className="calendar-day-events">
                      {dayEvents.slice(0, expandedDay === day.key ? dayEvents.length : 3).map((event) => {
                        const target = interviewTargets.get(event.id);
                        const progress = progressByEvent.get(event.id)!;
                        const round = eventRoundBadge(event);
                        const stage = !round || round.kind === "unknown" ? event.label
                          : round.kind === "casual" || round.kind === "agent" ? "面谈" : "面试";
                        const actionLabel = eventActionLabel(event, progress, target);
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
                            {target && <span className="calendar-interview-destination" aria-hidden="true">{interviewDestination(target)} →</span>}
                          </button>
                        );
                      })}
                      {dayEvents.length > 3 && expandedDay !== day.key && (
                        <button className="calendar-more" onClick={() => setExpandedDay(day.key)}>
                          另有 {dayEvents.length - 3} 项
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
            title="未来 7 天"
            empty="未来七天没有已确认的安排。"
            events={upcomingWeek}
            progressByEvent={progressByEvent}
            onOpen={onOpen}
            interviewTargets={interviewTargets}
            onInterview={onInterview}
          />
          {upcomingLater.length > 0 && (
            <AgendaGroup
              title="稍后安排"
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
              <span>最近记录</span>
              <strong>{recent.length}</strong>
            </summary>
            <AgendaGroup
              title="历史事实"
              empty="还没有历史日程。"
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
  return (
    <section className="agenda-group">
      <div className="agenda-heading"><h2>{title}</h2><span>{events.length}</span></div>
      <div className="agenda-list">
        {events.map((event) => {
          const target = interviewTargets.get(event.id);
          const progress = progressByEvent.get(event.id)!;
          const round = eventRoundBadge(event);
          const actionLabel = eventActionLabel(event, progress, target);
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
                  <span>{formatDate(event.date)}</span>
                </time>
                <span className="agenda-copy">
                  <span className="agenda-event-meta">
                    {round && <RoundBadge round={round} />}
                    <small>{event.time ? `${calendarEventTime(event)} · ${event.label}` : event.label}</small>
                  </span>
                  <strong>{event.company}</strong>
                  {target && <span className="calendar-interview-destination" aria-hidden="true">{interviewDestination(target)} →</span>}
                </span>
                <span className="calendar-status-dot" aria-hidden="true" />
              </button>
              {target && (
                <button
                  className="agenda-source"
                  onClick={() => onOpen(event.note)}
                  aria-label={`${event.date} · ${event.company} · ${event.label} · 查看原始记录`}
                >
                  查看原始记录
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
