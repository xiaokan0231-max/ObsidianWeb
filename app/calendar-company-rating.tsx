"use client";

import type { CalendarCompanyRating } from "@/lib/calendar-company-rating";
import { useUiLocale } from "./ui-locale";

/** 星标表达外部公司口碑，不能与页头的百分制面试表现合并。 */
export function CalendarCompanyRatingBadge({ rating, compact = false }: { rating?: CalendarCompanyRating; compact?: boolean }) {
  const { locale } = useUiLocale();
  if (!rating) return null;
  const score = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rating.score);
  const value = `${score}/${rating.scale}`;
  const label = locale === "ja" ? "企業の口コミ評価" : "公司口碑";
  const sample = rating.sampleCount !== null ? `${rating.sampleCount} ${rating.sampleUnit || (locale === "ja" ? "件のサンプル" : "条样本")}` : "";
  const readOn = `${locale === "ja" ? "確認日" : "读取日期"} ${rating.readOn}`;
  const description = [`${rating.platform} · ${label} ${value}`, sample, readOn, rating.commentPeriod, rating.limitations].filter(Boolean).join("\n");
  return <span className={`calendar-company-rating${compact ? " compact" : ""}`} title={description} aria-label={description}>
    <span aria-hidden="true">{!compact && <span className="calendar-rating-platform">{rating.platform} </span>}<span className="calendar-rating-star">★</span> {compact && rating.scale === 5 ? score : value}</span>
  </span>;
}
