"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { formatDate, type Note } from "@/lib/notes";
import { calendarMonthDays } from "@/lib/calendar-month";
import type { CalendarInterviewTarget } from "@/lib/calendar-interview";
import {
  localDateKey,
  type Commitment,
} from "@/lib/memory-atlas-data";

const COMMITMENT_TYPES = {
  event: { label: "面试 / 面谈", description: "已确认的面试、面谈和招聘说明会" },
  action: { label: "行动期限", description: "需要本人完成的事项及截止日期" },
  "follow-up": { label: "等待回复", description: "等待企业、中介或平台回复的跟进日期" },
} satisfies Record<Commitment["kind"], { label: string; description: string }>;

function interviewDestination(target: CalendarInterviewTarget) {
  return target.view === "review" ? "面试复盘" : "面试准备";
}

function eventActionLabel(event: Commitment, target?: CalendarInterviewTarget) {
  const context = [event.date, event.time, event.company, event.label].filter(Boolean).join(" · ");
  return `${context} · ${target ? interviewDestination(target) : "查看原始记录"}`;
}

function CalendarView({
  events,
  today,
  onOpen,
  interviewTargets,
  onInterview,
}: {
  events: Commitment[];
  onOpen: (note: Note) => void;
  interviewTargets: ReadonlyMap<string, CalendarInterviewTarget>;
  onInterview: (event: Commitment) => void;
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
    const map = new Map<string, Commitment[]>();
    events.forEach((event) => map.set(event.date, [...(map.get(event.date) ?? []), event]));
    return map;
  }, [events]);
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
            <h2>{monthLabel}</h2>
            <ul className="calendar-legend" aria-label="日历类型图例">
              {(Object.keys(COMMITMENT_TYPES) as Commitment["kind"][]).map((kind) => (
                <li className={`calendar-legend-item kind-${kind}`} key={kind} title={COMMITMENT_TYPES[kind].description}>
                  <i aria-hidden="true" />
                  {COMMITMENT_TYPES[kind].label}
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
                        const actionLabel = eventActionLabel(event, target);
                        return (
                          <button
                            className={`calendar-event ${event.phase} kind-${event.kind}`}
                            key={event.id}
                            onClick={() => target ? onInterview(event) : onOpen(event.note)}
                            title={actionLabel}
                            aria-label={actionLabel}
                          >
                            <span className="calendar-event-meta">
                              {event.time && <time dateTime={`${event.date}T${event.time}`}>{event.time}</time>}
                              <span>{event.label}</span>
                            </span>
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
            onOpen={onOpen}
            interviewTargets={interviewTargets}
            onInterview={onInterview}
          />
          {upcomingLater.length > 0 && (
            <AgendaGroup
              title="稍后安排"
              empty=""
              events={upcomingLater}
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
              empty="还没有历史日程或跟进记录。"
              events={recent}
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
  onOpen,
  interviewTargets,
  onInterview,
}: {
  title: string;
  empty: string;
  events: Commitment[];
  onOpen: (note: Note) => void;
  interviewTargets: ReadonlyMap<string, CalendarInterviewTarget>;
  onInterview: (event: Commitment) => void;
}) {
  return (
    <section className="agenda-group">
      <div className="agenda-heading"><h2>{title}</h2><span>{events.length}</span></div>
      <div className="agenda-list">
        {events.map((event) => {
          const target = interviewTargets.get(event.id);
          const actionLabel = eventActionLabel(event, target);
          return (
            <div className={`agenda-item ${event.phase} kind-${event.kind}`} key={event.id}>
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
                  <small>{event.time ? `${event.time} · ${event.label}` : event.label}</small>
                  <strong>{event.company}</strong>
                  {target && <span className="calendar-interview-destination" aria-hidden="true">{interviewDestination(target)} →</span>}
                </span>
                <span className="agenda-dot" aria-hidden="true" />
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
