import { buildCalendarSnapshot } from "@/lib/server/calendar-snapshot";
import { createCalendarReadModel } from "@/lib/server/calendar-read-model";
import { buildCalendarPulseSummary } from "@/lib/calendar-pulse-summary";
import { localDateKey } from "@/lib/memory-atlas-data";
import type { CalendarSnapshot } from "@/lib/calendar-snapshot";
import type { Note } from "@/lib/notes";

let current: { notes: Note[]; day: string; snapshot: CalendarSnapshot; revision: string } | undefined;
const models = new WeakMap<D1Database, ReturnType<typeof createCalendarReadModel>>();

async function database() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) return null;
  let model = models.get(env.DB);
  if (!model) { model = createCalendarReadModel(env.DB); models.set(env.DB, model); }
  return model;
}

export async function localCalendarProjection(force = false) {
  const { readAllNotes } = await import("@/lib/server/obsidian");
  const notes = await readAllNotes({ scope: "actions", force });
  const day = localDateKey();
  // 每次仍校验外部改动；写后同 mtime 的新 metadata 对象也必须使投影失效。
  if (force || !current || current.day !== day || current.notes.length !== notes.length || current.notes.some((note, index) => note !== notes[index])) {
    const snapshot = buildCalendarSnapshot(notes);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(snapshot)));
    const revision = `calendar-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    current = { notes: [...notes], day, snapshot, revision };
  }
  return current;
}

export async function calendarProjection(force = false) {
  const projection = await localCalendarProjection(force);
  try {
    const model = await database();
    if (model) return { ...projection, snapshot: await model.ensure(projection.revision, async () => projection.snapshot), source: "d1" };
  } catch {
    // 迁移未就绪时保留正本读取，不能用数据库异常解释成没有日程。
  }
  return { ...projection, source: "live-fallback" };
}

/** 首屏只查汇总行；已完成的日/月投影不读取日程和申请明细。 */
export async function calendarPulseSummary(month: string, today: string) {
  if (process.env.OBSIDIAN_DATA_SOURCE === "published") {
    const { env } = await import("cloudflare:workers");
    const assets = env.ASSETS;
    if (!assets) throw new Error("发布资源不可用");
    const manifestResponse = await assets.fetch(new Request("http://localhost/_published-vault/manifest.json"));
    if (!manifestResponse.ok) throw new Error("发布索引不可用");
    const manifest = await manifestResponse.json() as { publishedAt: string; calendar?: { file: string; etag: string } };
    const entry = manifest.calendar;
    if (!entry || !/^[a-f0-9]{24}\.json$/.test(entry.file)) throw new Error("日历索引无效");
    const load = async () => {
      const response = await assets.fetch(new Request(`http://localhost/_published-vault/${entry.file}`));
      if (!response.ok) throw new Error("日历资料不可用");
      const body = await response.json() as { connected?: boolean; calendar?: CalendarSnapshot };
      if (!body.connected || body.calendar?.schemaVersion !== 1) throw new Error("日历资料格式无效");
      return body.calendar;
    };
    const model = await database();
    return model ? model.ensureSummary(entry.etag, today, month, load, manifest.publishedAt)
      : buildCalendarPulseSummary(await load(), today, month);
  }
  const projection = await localCalendarProjection();
  try {
    const model = await database();
    if (model) return await model.ensureSummary(projection.revision, today, month, async () => projection.snapshot);
  } catch {
    // 本地数据库尚未迁移时，同一统计口径仍可从当前投影计算。
  }
  return buildCalendarPulseSummary(projection.snapshot, today, month);
}
