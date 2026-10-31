import { notFound, redirect } from "next/navigation";
import { appViewFromPathname, calendarRedirectHref, type AppRouteSearchParams } from "../../app-route";
import MemoryAtlas from "../../memory-atlas";
import { vaultScopeForView } from "@/lib/vault-scope";
import { calendarPulseSummary } from "../../calendar-server";
import { tokyoParts } from "@/lib/dojo/utils";
import { calendarWeekStart } from "@/lib/calendar-week";

export default async function AppSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string; rest?: string[] }>;
  searchParams: Promise<AppRouteSearchParams>;
}) {
  const { section, rest = [] } = await params;
  if (section === "overview" && rest.length === 0) {
    redirect(calendarRedirectHref(await searchParams));
  }
  const initialView = appViewFromPathname(`/${[section, ...rest].join("/")}`);
  if (!initialView) notFound();
  // 首屏共用请求里的参数，不能让服务端用默认月份、浏览器却用上次选中的月份。
  const initialSearch = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) initialSearch.append(key, item);
  }
  const today = tokyoParts().date;
  let summaryMonth = today.slice(0, 7);
  const requestedMonth = initialSearch.get("month") ?? "";
  if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(requestedMonth)) summaryMonth = requestedMonth;
  if (initialSearch.get("calview") === "week") {
    const requestedWeek = initialSearch.get("calweek") ?? "";
    const validWeek = /^20\d{2}-\d{2}-\d{2}$/.test(requestedWeek)
      && Number.isFinite(Date.parse(`${requestedWeek}T00:00:00Z`))
      && new Date(`${requestedWeek}T00:00:00Z`).toISOString().slice(0, 10) === requestedWeek;
    summaryMonth = calendarWeekStart(validWeek ? requestedWeek : today).slice(0, 7);
  }
  // 月度数值直接随 HTML 返回，不能为显示一个计数等浏览器下载整份日历明细。
  const initialSummary = initialView === "calendar" ? await calendarPulseSummary(summaryMonth, today).catch(() => null) : null;
  // 与外壳首个读取使用同一 scope；先取数据，避免等到客户端模块下载和挂载后才发起请求。
  return <>
    <link rel="preload" as="fetch" href={initialView === "calendar" ? "/api/calendar" : initialView === "reading"
      ? "/api/read-model/library?q=type%3Alanguage-reading-list&group=all&scope=language&sort=recent&limit=24"
      : `/api/vault?scope=${vaultScopeForView(initialView)}`} crossOrigin="anonymous" />
    <MemoryAtlas initialView={initialView} initialSearch={initialSearch.toString()} initialSummary={initialSummary} />
  </>;
}
