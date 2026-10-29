import { calendarProjection } from "../../calendar-server";

export async function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    const projection = await calendarProjection(force);
    const etag = `W/"${projection.revision}"`;
    const headers = new Headers({ "Cache-Control": "no-store", ETag: etag, "X-Obsidian-Read-Model": projection.source });
    if (!force && request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
    return Response.json({ connected: true, calendar: projection.snapshot }, { headers });
  } catch {
    return Response.json({ connected: false, error: "日历读取失败，请重试" }, { status: 503 });
  }
}
