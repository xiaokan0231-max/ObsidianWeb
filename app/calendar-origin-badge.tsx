"use client";

import {
  CALENDAR_ORIGIN_KINDS, calendarOriginDescription, calendarOriginLabel,
  UNKNOWN_CALENDAR_ORIGIN, type CalendarEventOrigin,
} from "@/lib/calendar-event-origin";
import type { UiLocale } from "@/lib/ui-locale";
import { useUiLocale } from "./ui-locale";
import "./styles/calendar-origin.css";

export function CalendarOriginBadge({ origin = UNKNOWN_CALENDAR_ORIGIN, compact = false, locale: requestedLocale, className = "" }: {
  origin?: CalendarEventOrigin; compact?: boolean; locale?: UiLocale; className?: string;
}) {
  const { locale: activeLocale } = useUiLocale();
  const locale = requestedLocale ?? activeLocale;
  const description = calendarOriginDescription(origin, locale);
  return <span className={`calendar-origin-badge ${compact ? "compact" : ""} ${className}`.trim()}
    data-origin={origin.kind} aria-label={description} title={description}>
    <i aria-hidden="true" /><span aria-hidden="true">{calendarOriginLabel(origin.kind, locale, compact)}</span>
  </span>;
}

export function CalendarOriginLegend({ locale: requestedLocale, className = "" }: { locale?: UiLocale; className?: string }) {
  const { locale: activeLocale } = useUiLocale();
  const locale = requestedLocale ?? activeLocale;
  return <div className={`calendar-origin-legend ${className}`.trim()} role="group"
    aria-label={locale === "ja" ? "機会のきっかけの色" : "机会来源颜色"}>
    {CALENDAR_ORIGIN_KINDS.map((kind) => <span key={kind} data-origin={kind}>
      <i aria-hidden="true" />{calendarOriginLabel(kind, locale)}
    </span>)}
  </div>;
}
