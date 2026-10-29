import { readModelRuntime, ReadModelError } from "./read-model-server";
import type { CalendarCatalog, CalendarRangePage } from "@/lib/calendar-query-model";
import type { CalendarSnapshot } from "@/lib/calendar-snapshot";
import type { CalendarPulseSummary } from "@/lib/calendar-pulse-summary";
import type { AiApplicationDay } from "@/lib/calendar-applications";
import { buildCalendarPulseSummaries } from "@/lib/calendar-pulse-summary";
import { tokyoParts } from "@/lib/dojo/utils";

type Runtime = Awaited<ReturnType<typeof readModelRuntime>>;
const daily = new Map<string, { catalog: CalendarCatalog; summaries: CalendarPulseSummary[]; applicationDays: AiApplicationDay[] }>();
function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
async function catalogFor(runtime: Runtime) {
  const today = tokyoParts().date;
  const catalog = await runtime.model.readRecord<CalendarCatalog>(runtime.revision, "calendar-catalog", "root");
  if (!catalog) throw new ReadModelError("日历目录尚未就绪");
  if (catalog.today === today) return { catalog, summaries: null, applicationDays: null };
  const key = `${runtime.revision}:${today}`;
  const cached = daily.get(key);
  if (cached) return cached;
  // 跨日只重算这份精简投影，客户端仍只接收当前日期范围。
  const snapshot = await runtime.model.readRecord<CalendarSnapshot>(runtime.revision, "calendar-source", "root");
  if (!snapshot) throw new ReadModelError("日历资料版本不完整");
  const { calendarModelFromSnapshot } = await import("@/lib/calendar-snapshot");
  const { isCalendarLiveEvent } = await import("@/lib/calendar-summary");
  const { isCalendarHistoricalProgress } = await import("@/lib/calendar-progress");
  const model = calendarModelFromSnapshot(snapshot, today);
  const next = { catalog: { ...catalog, today, applicationDays: model.applicationDays.map(({date,companyCount,positionCount,bucketCounts}) => ({date,companyCount,positionCount,bucketCounts})), events: model.events.map((event) => { const progress = model.progressByEvent.get(event.id); return { id: event.id, date: event.date, time: event.time, live: isCalendarLiveEvent(event, progress, today), occurred: event.phase === "past" || Boolean(progress?.occurred), historical: Boolean(progress && isCalendarHistoricalProgress(progress)) }; }) }, summaries: buildCalendarPulseSummaries(snapshot, today), applicationDays: model.applicationDays };
  daily.clear(); daily.set(key, next);
  return next;
}

export async function calendarRange(params: URLSearchParams): Promise<CalendarRangePage> {
  const runtime = await readModelRuntime(params.get("revision"));
  const { catalog, summaries } = await catalogFor(runtime);
  const month = params.get("month") || params.get("from")?.slice(0, 7) || catalog.today.slice(0, 7);
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000")) throw new ReadModelError("日历月份无效", 400);
  const from = params.get("from") || `${month}-01`;
  const to = params.get("to") || new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  if (!validDay(from) || !validDay(to) || from > to || Date.parse(to) - Date.parse(from) > 93 * 86400000) throw new ReadModelError("日历日期范围无效", 400);
  const recent = catalog.events.filter((event) => event.occurred).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).slice(0, 6);
  const dates = [...new Set([...catalog.dates.filter((date) => date >= from && date <= to), ...catalog.events.filter((event) => event.live).map((event) => event.date), ...recent.map((event) => event.date)])];
  const records = await runtime.model.readRecords<CalendarSnapshot["events"]>(runtime.revision, "calendar-day", dates);
  const summary = summaries?.find((item) => item.month === month) ?? await runtime.model.readRecord<CalendarPulseSummary>(runtime.revision, "calendar-pulse", month);
  const fallback = summaries?.[0] ?? await runtime.model.readRecord<CalendarPulseSummary>(runtime.revision, "calendar-pulse", "default");
  if (!summary && !fallback) throw new ReadModelError("日历汇总尚未就绪");
  return { syncState: runtime.syncState as "ready" | "building" | "failed" | undefined, revision: runtime.revision, today: catalog.today, snapshot: { schemaVersion: 1, events: records.flatMap((record) => record.value), applicationNotes: [], selectionCount: catalog.selectionCount },
    applicationDays: catalog.applicationDays.filter((day) => day.date >= from && day.date <= to || day.date.startsWith(month)), historicalTotal: catalog.events.filter((event) => event.historical).length,
    summary: summary ?? { ...fallback!, month, applications: { companyCount: 0, positionCount: 0, bucketCounts: Object.fromEntries(Object.keys(fallback!.applications.bucketCounts).map((key) => [key, 0])) as CalendarPulseSummary["applications"]["bucketCounts"] } } };
}

export async function calendarHistory(params: URLSearchParams) {
  const runtime = await readModelRuntime(params.get("revision"));
  const { catalog } = await catalogFor(runtime);
  const offset = Math.max(0, Math.floor(Number(params.get("offset")) || 0));
  const history = catalog.events.filter((event) => params.get("scope") === "recent" ? event.occurred : event.historical).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || a.id.localeCompare(b.id));
  const items = history.slice(offset, offset + 12);
  const records = await runtime.model.readRecords<CalendarSnapshot["events"]>(runtime.revision, "calendar-day", [...new Set(items.map((item) => item.date))]);
  // IN 查询按资料键返回，不能拿数据库行序代替历史列表要求的日期降序。
  const byId = new Map(records.flatMap((record) => record.value).map((entry) => [entry.event.id, entry]));
  const events = items.flatMap((item) => byId.has(item.id) ? [byId.get(item.id)!] : []);
  return { revision: runtime.revision, total: history.length, nextOffset: offset + items.length < history.length ? offset + items.length : null, events };
}

export async function calendarApplication(params: URLSearchParams) {
  const runtime = await readModelRuntime(params.get("revision"));
  const date = params.get("date") ?? "";
  if (!validDay(date)) throw new ReadModelError("日期无效", 400);
  const { applicationDays } = await catalogFor(runtime);
  return { revision: runtime.revision, day: applicationDays ? applicationDays.find((day) => day.date === date) ?? null : await runtime.model.readRecord<AiApplicationDay>(runtime.revision, "calendar-applications", date) };
}
