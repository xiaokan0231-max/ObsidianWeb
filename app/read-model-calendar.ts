import { readModelReady, readModelRuntime, ReadModelError } from "./read-model-server";
import type { CalendarCatalog, CalendarRangePage } from "@/lib/calendar-query-model";
import type { CalendarSnapshot } from "@/lib/calendar-snapshot";
import { calendarPulseSource, rollCalendarPulse, type CalendarPulseSource, type CalendarPulseSummary } from "@/lib/calendar-pulse-summary";
import type { AiApplicationDay } from "@/lib/calendar-applications";
import { tokyoParts } from "@/lib/dojo/utils";
import { createCalendarReadModel } from "@/lib/server/calendar-read-model";

type Runtime = Awaited<ReturnType<typeof readModelRuntime>>;
type DailyProjection = ReturnType<typeof rollCalendarPulse>;
const daily = new WeakMap<Runtime["model"], Map<string, Promise<DailyProjection>>>();
const stores = new WeakMap<D1Database, ReturnType<typeof createCalendarReadModel>>();

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function requestDay(params: URLSearchParams) {
  const today = tokyoParts().date, requested = params.get("today");
  if (requested && !validDay(requested)) throw new ReadModelError("日历日期无效", 400);
  if (requested && requested !== today) throw new ReadModelError("日本日期已更新，请重新读取日历", 409);
  return today;
}

async function summaryStore() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) return null;
  let store = stores.get(env.DB);
  if (!store) { store = createCalendarReadModel(env.DB); stores.set(env.DB, store); }
  return store;
}

function dailyFor(runtime: Runtime, today: string) {
  let versions = daily.get(runtime.model);
  if (!versions) { versions = new Map(); daily.set(runtime.model, versions); }
  const cache = versions, key = `${runtime.revision}:${today}`;
  const previous = cache.get(key);
  if (previous) { cache.delete(key); cache.set(key, previous); return previous; }
  const pending = (async () => {
    let source = await runtime.model.readRecord<CalendarPulseSource>(runtime.revision, "calendar-pulse-source", "root");
    if (!source) {
      // 历史索引没有跨日专用输入，仍从同版快照生成一次。
      const snapshot = await runtime.model.readRecord<CalendarSnapshot>(runtime.revision, "calendar-source", "root");
      if (!snapshot) throw new ReadModelError("日历资料版本不完整");
      source = calendarPulseSource(snapshot);
    }
    const result = rollCalendarPulse(source, today);
    try {
      await (await summaryStore())?.storeSummaries(runtime.revision, today, result.summaries, true);
    } catch {
      // 汇总是可重建的缓存，索引输入成功时仍可显示正确统计。
    }
    return result;
  })().catch((error) => { if (cache.get(key) === pending) cache.delete(key); throw error; });
  cache.set(key, pending);
  while (cache.size > 3) cache.delete(cache.keys().next().value!);
  return pending;
}

async function catalogFor(runtime: Runtime, today: string) {
  const source = await runtime.model.readRecord<CalendarCatalog>(runtime.revision, "calendar-catalog", "root");
  if (!source) throw new ReadModelError("日历目录尚未就绪");
  if (source.today === today) return { catalog: source, current: null };
  const current = await dailyFor(runtime, today);
  const applicationDays = current.applicationDays.map(({ date, companyCount, positionCount, bucketCounts }) =>
    ({ date, companyCount, positionCount, bucketCounts }));
  return { catalog: { ...source, today, events: current.events, applicationDays }, current };
}

function selectSummary(summaries: CalendarPulseSummary[], month: string) {
  const summary = summaries.find((item) => item.month === month);
  if (summary) return summary;
  const fallback = summaries.find((item) => item.month === "");
  if (!fallback) throw new ReadModelError("日历汇总尚未就绪");
  return { ...fallback, month };
}

async function pulseFor(runtime: Runtime, month: string, today: string, current?: DailyProjection | null) {
  if (current) return selectSummary(current.summaries, month);
  // 构建当天的首屏只取指定月份与空月份汇总，不读取日历目录和日程。
  const records = await runtime.model.readRecords<CalendarPulseSummary>(runtime.revision, "calendar-pulse", [month, "default"]);
  const summaries = records.map(({ value }) => value);
  const summary = selectSummary(summaries, month);
  if (summary.today === today) return summary;
  try {
    const cached = await (await summaryStore())?.readSummary(runtime.revision, today, month);
    if (cached) return cached;
  } catch {
    // 持久缓存不可用时，用同一索引重算。
  }
  return selectSummary((await dailyFor(runtime, today)).summaries, month);
}

export async function calendarInitialPulse(month: string, today: string) {
  const runtime = await readModelReady();
  if (!runtime) return null;
  return { revision: runtime.revision, today, summary: await pulseFor(runtime, month, today) };
}

export async function calendarSummary(params: URLSearchParams) {
  const today = requestDay(params), requestedMonth = params.get("month") ?? "";
  const month = /^20\d{2}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : today.slice(0, 7);
  const runtime = await readModelRuntime(params.get("revision"));
  return { revision: runtime.revision, today, summary: await pulseFor(runtime, month, today), syncState: runtime.syncState };
}

export async function calendarRange(params: URLSearchParams): Promise<CalendarRangePage> {
  const today = requestDay(params);
  const runtime = await readModelRuntime(params.get("revision"));
  const { catalog, current } = await catalogFor(runtime, today);
  const month = params.get("month") || params.get("from")?.slice(0, 7) || today.slice(0, 7);
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000")) throw new ReadModelError("日历月份无效", 400);
  const from = params.get("from") || `${month}-01`;
  const to = params.get("to") || new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  if (!validDay(from) || !validDay(to) || from > to || Date.parse(to) - Date.parse(from) > 93 * 86400000) throw new ReadModelError("日历日期范围无效", 400);
  const recent = catalog.events.filter((event) => event.occurred).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).slice(0, 6);
  const dates = [...new Set([...catalog.dates.filter((date) => date >= from && date <= to), ...catalog.events.filter((event) => event.live).map((event) => event.date), ...recent.map((event) => event.date)])];
  const [records, summary] = await Promise.all([
    runtime.model.readRecords<CalendarSnapshot["events"]>(runtime.revision, "calendar-day", dates),
    pulseFor(runtime, month, today, current),
  ]);
  return { syncState: runtime.syncState as "ready" | "building" | "failed" | undefined, revision: runtime.revision, today, snapshot: { schemaVersion: 1, events: records.flatMap((record) => record.value), applicationNotes: [], selectionCount: catalog.selectionCount },
    applicationDays: catalog.applicationDays.filter((day) => day.date >= from && day.date <= to || day.date.startsWith(month)), historicalTotal: catalog.events.filter((event) => event.historical).length, summary };
}

export async function calendarHistory(params: URLSearchParams) {
  const today = requestDay(params);
  const runtime = await readModelRuntime(params.get("revision"));
  const { catalog } = await catalogFor(runtime, today);
  const offset = Math.max(0, Math.floor(Number(params.get("offset")) || 0));
  const history = catalog.events.filter((event) => params.get("scope") === "recent" ? event.occurred : event.historical).sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || a.id.localeCompare(b.id));
  const items = history.slice(offset, offset + 12);
  const records = await runtime.model.readRecords<CalendarSnapshot["events"]>(runtime.revision, "calendar-day", [...new Set(items.map((item) => item.date))]);
  // IN 查询按资料键返回，不能拿数据库行序代替历史列表要求的日期降序。
  const byId = new Map(records.flatMap((record) => record.value).map((entry) => [entry.event.id, entry]));
  const events = items.flatMap((item) => byId.has(item.id) ? [byId.get(item.id)!] : []);
  return { revision: runtime.revision, today, total: history.length, nextOffset: offset + items.length < history.length ? offset + items.length : null, events };
}

export async function calendarApplication(params: URLSearchParams) {
  const today = requestDay(params);
  const date = params.get("date") ?? "";
  if (!validDay(date)) throw new ReadModelError("日期无效", 400);
  const runtime = await readModelRuntime(params.get("revision"));
  const { current } = await catalogFor(runtime, today);
  return { revision: runtime.revision, today, day: current ? current.applicationDays.find((day) => day.date === date) ?? null : await runtime.model.readRecord<AiApplicationDay>(runtime.revision, "calendar-applications", date) };
}
