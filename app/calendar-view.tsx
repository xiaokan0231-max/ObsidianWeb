"use client";

import { useMemo, useState } from "react";
import { findInterviewPrepDocs } from "@/lib/interview-prep-doc";
import { formatDate, type Note } from "@/lib/notes";
import {
  calendarCompanyIdentity,
  localDateKey,
  type CalendarEvent,
} from "@/lib/memory-atlas-data";

export default function CalendarView({
  events,
  notes,
  onOpen,
  onPrepare,
}: {
  events: CalendarEvent[];
  notes: Note[];
  onOpen: (note: Note) => void;
  onPrepare: (company: string) => void;
}) {
  const [month, setMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const today = localDateKey();
  const monthLabel = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(month);
  const firstDayOffset = (month.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(month.getFullYear(), month.getMonth(), index - firstDayOffset + 1);
    return {
      date,
      key: localDateKey(date),
      inMonth: date.getMonth() === month.getMonth(),
    };
  });
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
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
  const prepCompanies = useMemo(
    () => new Set(findInterviewPrepDocs(notes).map((doc) => calendarCompanyIdentity(doc.company))),
    [notes],
  );
  const canPrepare = (event: CalendarEvent) =>
    event.phase === "upcoming" && prepCompanies.has(calendarCompanyIdentity(event.company));

  const moveMonth = (offset: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  return (
    <section className="calendar-view">
      <div className="calendar-layout">
        <div className="calendar-board">
          <div className="calendar-toolbar">
            <div>
              <span>MONTH VIEW</span>
              <h2>{monthLabel}</h2>
            </div>
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
                      {dayEvents.slice(0, 3).map((event) => (
                        <button
                          className={`calendar-event ${event.phase}`}
                          data-semantic={event.phase === "upcoming" ? "action" : "fact"}
                          key={event.id}
                          onClick={() => onOpen(event.note)}
                          title={`${event.company} · ${event.label}`}
                        >
                          <span>{event.time || event.label}</span>
                          <strong>{event.company}</strong>
                        </button>
                      ))}
                      {dayEvents.length > 3 && <small>另有 {dayEvents.length - 3} 项</small>}
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
            onPrepare={onPrepare}
            canPrepare={canPrepare}
          />
          {upcomingLater.length > 0 && (
            <AgendaGroup
              title="稍后安排"
              empty=""
              events={upcomingLater}
              onOpen={onOpen}
              onPrepare={onPrepare}
              canPrepare={canPrepare}
            />
          )}
          <details className="calendar-history">
            <summary>
              <span>最近的面试记录</span>
              <strong>{recent.length}</strong>
            </summary>
            <AgendaGroup
              title="历史事实"
              empty="还没有可识别的历史面试记录。"
              events={recent}
              onOpen={onOpen}
              onPrepare={onPrepare}
              canPrepare={canPrepare}
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
  onPrepare,
  canPrepare,
}: {
  title: string;
  empty: string;
  events: CalendarEvent[];
  onOpen: (note: Note) => void;
  onPrepare: (company: string) => void;
  canPrepare: (event: CalendarEvent) => boolean;
}) {
  return (
    <section className="agenda-group">
      <div className="agenda-heading"><h2>{title}</h2><span>{events.length}</span></div>
      <div className="agenda-list">
        {events.map((event) => {
          const prepare = canPrepare(event);
          return (
          <button
            key={event.id}
            data-semantic={event.phase === "upcoming" ? "action" : "fact"}
            onClick={() => prepare ? onPrepare(event.company) : onOpen(event.note)}
          >
            <time dateTime={event.date}>
              <strong>{event.date.slice(8)}</strong>
              <span>{formatDate(event.date)}</span>
            </time>
            <span className="agenda-copy">
              <small>{event.time ? `${event.time} · ${event.label}` : event.label}</small>
              <strong>{event.company}</strong>
              <em>{prepare ? "下一步 · 打开面试准备" : event.phase === "upcoming" ? "下一步 · 查看安排原文" : "事实记录 · 查看原文"}</em>
            </span>
            <span className={`agenda-dot ${event.phase}`} />
          </button>
        );})}
        {events.length === 0 && <p className="agenda-empty">{empty}</p>}
      </div>
    </section>
  );
}
