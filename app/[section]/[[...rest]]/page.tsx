import { notFound, redirect } from "next/navigation";
import { appViewFromPathname, calendarRedirectHref, type AppRouteSearchParams } from "../../app-route";
import MemoryAtlas from "../../memory-atlas";
import { vaultScopeForView } from "@/lib/vault-scope";

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
  // 与外壳首个读取使用同一 scope；先取数据，避免等到客户端模块下载和挂载后才发起请求。
  return <>
    <link rel="preload" as="fetch" href={initialView === "calendar" ? "/api/calendar" : `/api/vault?scope=${vaultScopeForView(initialView)}`} crossOrigin="anonymous" />
    <MemoryAtlas initialView={initialView} initialSearch={initialSearch.toString()} />
  </>;
}
