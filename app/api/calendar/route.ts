import { buildCalendarSnapshot } from "@/lib/server/calendar-snapshot";
import { readAllNotes } from "@/lib/server/obsidian";

export async function GET() {
  try {
    return Response.json({ connected: true, calendar: buildCalendarSnapshot(await readAllNotes({ scope: "actions" })) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ connected: false, error: "日历读取失败，请重试" }, { status: 503 });
  }
}
