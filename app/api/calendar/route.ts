import { buildCalendarSnapshot } from "@/lib/server/calendar-snapshot";
import { createCalendarReadModel } from "@/lib/server/calendar-read-model";
import { readAllNotes } from "@/lib/server/obsidian";
import { localDateKey } from "@/lib/memory-atlas-data";
import type { CalendarSnapshot } from "@/lib/calendar-snapshot";
import type { Note } from "@/lib/notes";

let current: { notes: Note[]; day: string; snapshot: CalendarSnapshot; revision: string } | undefined;
const models = new WeakMap<D1Database, ReturnType<typeof createCalendarReadModel>>();

export async function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    // 每次仍向 Obsidian 校验变更；相同笔记对象无需重算，写后同 mtime 的 metadata 更新也会产生新对象。
    const notes = await readAllNotes({ scope: "actions", force });
    const day = localDateKey();
    if (force || !current || current.day !== day || current.notes.length !== notes.length || current.notes.some((note, index) => note !== notes[index])) {
      const snapshot = buildCalendarSnapshot(notes);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(snapshot)));
      const revision = `calendar-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      current = { notes: [...notes], day, snapshot, revision };
    }
    const projection = current;
    const etag = `W/"${projection.revision}"`;
    const headers = new Headers({ "Cache-Control": "no-store", ETag: etag });
    if (!force && request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
    let calendar = projection.snapshot;
    try {
      const { env } = await import("cloudflare:workers");
      if (env.DB) {
        let model = models.get(env.DB);
        if (!model) { model = createCalendarReadModel(env.DB); models.set(env.DB, model); }
        calendar = await model.ensure(projection.revision, async () => projection.snapshot);
        headers.set("X-Obsidian-Read-Model", "d1");
      }
    } catch {
      // 本地尚未执行迁移时，资料读取保持可用；绝不把数据库异常当成没有日程。
      headers.set("X-Obsidian-Read-Model", "live-fallback");
    }
    return Response.json({ connected: true, calendar }, { headers });
  } catch {
    return Response.json({ connected: false, error: "日历读取失败，请重试" }, { status: 503 });
  }
}
