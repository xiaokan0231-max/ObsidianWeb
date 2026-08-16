import { notFound } from "next/navigation";
import { appViewFromPathname } from "../../app-route";
import MemoryAtlas from "../../memory-atlas";

export default async function AppSectionPage({
  params,
}: {
  params: Promise<{ section: string; rest?: string[] }>;
}) {
  const { section, rest = [] } = await params;
  const initialView = appViewFromPathname(`/${[section, ...rest].join("/")}`);
  if (!initialView) notFound();
  return <MemoryAtlas initialView={initialView} />;
}

