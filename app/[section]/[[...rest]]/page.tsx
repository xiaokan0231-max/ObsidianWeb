import { notFound, redirect } from "next/navigation";
import { appViewFromPathname, calendarRedirectHref, type AppRouteSearchParams } from "../../app-route";
import MemoryAtlas from "../../memory-atlas";
import { vaultScopeForView } from "@/lib/vault-scope";
import { calendarInitialPulse } from "../../read-model-calendar";
import { calendarInitialRange } from "../../calendar-projection-resource";
import { tokyoParts } from "@/lib/dojo/utils";

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
  const search = initialSearch.toString();
  // 月度数值直接随 HTML 返回，不能为显示一个计数等浏览器下载整份日历明细。
  const initialPulse = initialView === "calendar" ? await calendarInitialPulse(calendarInitialRange(search, today).month, today).catch(() => null) : null;
  // 使用索引的页面由自己的资源读取；只为仍读原 scope 的入口预取相同接口。
  const preload = initialView === "reading" ? "/api/read-model/library?q=type%3Alanguage-reading-list&group=all&scope=language&sort=recent&limit=24"
    : ["calendar", "library", "session", "prep", "review", "insights", "practice"].includes(initialView) ? null
    : `/api/vault?scope=${vaultScopeForView(initialView)}`;
  return <>
    {preload && <link rel="preload" as="fetch" href={preload} crossOrigin="anonymous" />}
    <MemoryAtlas initialView={initialView} initialSearch={search} initialSummary={initialPulse?.summary}
      initialCalendarRevision={initialPulse?.revision} initialCalendarToday={initialPulse?.today ?? today} />
  </>;
}
