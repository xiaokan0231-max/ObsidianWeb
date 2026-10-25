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
  // 与外壳首个读取使用同一 scope；先取数据，避免等到客户端模块下载和挂载后才发起请求。
  return <>
    <link rel="preload" as="fetch" href={`/api/vault?scope=${vaultScopeForView(initialView)}`} crossOrigin="anonymous" />
    <MemoryAtlas initialView={initialView} />
  </>;
}
