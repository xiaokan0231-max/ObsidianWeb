import { redirect } from "next/navigation";
import { calendarRedirectHref, type AppRouteSearchParams } from "./app-route";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<AppRouteSearchParams>;
}) {
  redirect(calendarRedirectHref(await searchParams));
}
