import { calendarPulseSummary } from "../../../calendar-server";
import { tokyoParts } from "@/lib/dojo/utils";

export async function GET(request: Request) {
  const requestedMonth = new URL(request.url).searchParams.get("month") ?? "";
  const today = tokyoParts().date;
  const month = /^20\d{2}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : today.slice(0, 7);
  try {
    const summary = await calendarPulseSummary(month, today);
    return Response.json({ summary }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "日历汇总读取失败，请重试" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
