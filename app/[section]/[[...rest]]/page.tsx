import { notFound, redirect } from "next/navigation";
import { appViewFromPathname, calendarRedirectHref, type AppRouteSearchParams } from "../../app-route";
import MemoryAtlas from "../../memory-atlas";

export default async function AppSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ section: string; rest?: string[] }>;
  searchParams: Promise<AppRouteSearchParams>;
}) {
  const { section, rest = [] } = await params;
  if ((section === "actions" || section === "overview") && rest.length === 0) {
    redirect(calendarRedirectHref(await searchParams));
  }
  const initialView = appViewFromPathname(`/${[section, ...rest].join("/")}`);
  if (!initialView) notFound();
  return <MemoryAtlas initialView={initialView} />;
}
