"use client";

import type { MouseEvent } from "react";
import type { CalendarInterviewDestinations, CalendarInterviewTarget } from "@/lib/calendar-interview";
import { appViewHref, calendarInterviewSearch } from "./app-route";
import { useUiLocale } from "./ui-locale";

/** 两个资料入口保留同一场身份，不能因面试已结束就把准备稿藏起来。 */
export function CalendarInterviewLinks({ targets, compact = false, onNavigate }: {
  targets?: CalendarInterviewDestinations;
  compact?: boolean;
  onNavigate: (view: CalendarInterviewTarget["view"]) => void;
}) {
  const { locale } = useUiLocale();
  const ja = locale === "ja";
  const items = [
    { target: targets?.session, label: ja ? "面接準備" : "面试准备", short: ja ? "準備" : "准备" },
    { target: targets?.review, label: ja ? "面接の振り返り" : "面试复盘", short: ja ? "振り返り" : "复盘" },
  ];
  if (!items.some((item) => item.target)) return null;
  return <span className={`calendar-interview-links${compact ? " compact" : ""}`}>
    {items.map(({ target, label, short }) => target && <a key={target.view}
      href={appViewHref(target.view, calendarInterviewSearch(target))}
      data-view={target.view} data-missing={!target.path || undefined}
      aria-label={`${target.date} · ${target.time || ""} · ${target.company} · ${label}`}
      title={`${label}${target.path ? "" : ja ? " · 資料はまだありません" : " · 资料待补充"}`}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(target.view);
      }}>{compact ? short : label}{!compact && <span aria-hidden="true">↗</span>}</a>)}
  </span>;
}
