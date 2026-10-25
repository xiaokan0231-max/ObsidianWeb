"use client";

import type { MouseEvent } from "react";
import type { CalendarInterviewDestinations, CalendarInterviewTarget } from "@/lib/calendar-interview";
import { appViewHref, calendarInterviewSearch } from "./app-route";
import { useUiLocale } from "./ui-locale";

/** 两个资料入口保留同一场身份，不能因面试已结束就把准备稿藏起来。 */
export function CalendarInterviewLinks({ targets, compact = false, icons = false, onNavigate }: {
  targets?: CalendarInterviewDestinations;
  compact?: boolean;
  icons?: boolean;
  onNavigate: (view: CalendarInterviewTarget["view"]) => void;
}) {
  const { locale } = useUiLocale();
  const ja = locale === "ja";
  const items = [
    { target: targets?.session, label: ja ? "面接準備" : "面试准备", short: ja ? "準備" : "准备" },
    { target: targets?.review, label: ja ? "面接の振り返り" : "面试复盘", short: ja ? "振り返り" : "复盘" },
  ];
  if (!items.some((item) => item.target)) return null;
  return <span className={`calendar-interview-links${compact ? " compact" : ""}${icons ? " icon-actions" : ""}`}>
    {items.map(({ target, label, short }) => target && <a key={target.view}
      href={appViewHref(target.view, calendarInterviewSearch(target))}
      data-view={target.view} data-missing={!target.path || undefined}
      aria-label={`${target.date} · ${target.time || ""} · ${target.company} · ${label}`}
      title={compact || icons || !target.path ? `${label}${target.path ? "" : ja ? " · 資料はまだありません" : " · 资料待补充"}` : undefined}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(target.view);
      }}>{icons ? <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {target.view === "session" ? <><path d="M8 4c-2-1.5-4-1.5-6-1v9c2-.5 4-.5 6 1 2-1.5 4-1.5 6-1V3c-2-.5-4-.5-6 1Z" /><path d="M8 4v9" /></> : <><path d="M3 5a5.5 5.5 0 1 1-.3 5.5M3 2v3H.5" /><path d="M8 4.5V8l2.5 1.5" /></>}
      </svg> : compact ? short : label}{!compact && !icons && <span aria-hidden="true">↗</span>}</a>)}
  </span>;
}
