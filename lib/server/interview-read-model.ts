import { INTERVIEW_RECORDS, interviewBlockKey, type InterviewCatalog, type InterviewContext, type InterviewCompanyProjection, type InterviewReviewProjection } from "../interview-read-model.ts";
import { resolveIndexedInterviewTarget } from "../interview-read-model-target.ts";
import type { CalendarInterviewTarget } from "../calendar-interview.ts";
import type { CalendarSnapshot } from "../calendar-snapshot.ts";

type RecordReader = { readRecord<T>(revision: string, kind: string, key: string): Promise<T | null> };
export class InterviewRevisionError extends Error { readonly status = 409; }
const catalogs = new WeakMap<RecordReader, Map<string, Promise<InterviewCatalog>>>();

function catalogFor(model: RecordReader, revision: string) {
  let versions = catalogs.get(model);
  if (!versions) { versions = new Map(); catalogs.set(model, versions); }
  const existing = versions.get(revision);
  if (existing) {
    versions.delete(revision); versions.set(revision, existing);
    return existing;
  }
  const cache = versions;
  const pending = model.readRecord<InterviewCatalog>(revision, INTERVIEW_RECORDS.catalog, "root").then((catalog) => {
    if (!catalog || catalog.kind !== "interview-catalog") throw new InterviewRevisionError("这版资料已更新或尚未同步完成，请刷新后重试");
    return catalog;
  }).catch((error) => {
    if (cache.get(revision) === pending) cache.delete(revision);
    throw error;
  });
  cache.set(revision, pending);
  // 资料版本由运行时验证是否仍然可用；这里只复用不可变目录，避免每题重复解码大目录。
  while (cache.size > 3) cache.delete(cache.keys().next().value!);
  return pending;
}

/** 先验证整版目录可用，再读取其中的记录；不能把未完成同步显示成空列表。 */
export async function readInterviewRecord<T>(model: RecordReader, revision: string, kind: string, key: string): Promise<T | null> {
  const catalog = await catalogFor(model, revision);
  if (kind === INTERVIEW_RECORDS.catalog && key === "root") return catalog as T;
  return model.readRecord<T>(revision, kind, key);
}

export async function interviewQuery(model: RecordReader, revision: string, request: URL) {
  const params = request.searchParams;
  const type = request.pathname.split("/").pop();
  const path = params.get("path") ?? "";
  if (type === "target") {
    const view = params.get("view");
    const date = params.get("date") ?? "";
    const event = params.get("event") ?? "";
    if ((view !== "session" && view !== "review") || !/^20\d{2}-\d{2}-\d{2}$/.test(date) || !event) {
      throw Object.assign(new Error("日历场次参数无效"), { status: 400 });
    }
    const requested: CalendarInterviewTarget = { view, date, sourcePath: event, company: params.get("company") ?? "",
      label: params.get("round") ?? "面试", caseId: params.get("case") ?? "", time: params.get("time") || undefined,
      path: params.get(view === "session" ? "prep" : "review") };
    const entries = await readInterviewRecord<CalendarSnapshot["events"]>(model, revision, "calendar-day", date);
    return { revision, target: resolveIndexedInterviewTarget(requested, entries ?? []) };
  }
  if (type === "catalog") {
    const source = (await readInterviewRecord<InterviewCatalog>(model, revision, INTERVIEW_RECORDS.catalog, "root"))!;
    const section = params.get("section");
    if (section === "picker" || section === "comparisons") {
      const maximum = section === "picker" ? 64 : 24;
      const limit = Math.max(1, Math.min(maximum, Number(params.get("limit")) || maximum));
      const offset = Math.max(0, Math.floor(Number(params.get("offset")) || 0));
      if (section === "comparisons") return { revision, items: source.comparisons.slice(offset, offset + limit),
        total: source.comparisons.length, nextOffset: offset + limit < source.comparisons.length ? offset + limit : null };
      const ids = new Set(source.pickerGroups.flatMap((group) => group.items).slice(offset, offset + limit).map((item) => item.id));
      const groups = source.pickerGroups.flatMap((group) => { const items = group.items.filter((item) => ids.has(item.id)); return items.length ? [{ ...group, items }] : []; });
      const total = source.pickerGroups.reduce((count, group) => count + group.items.length, 0);
      return { revision, groups, total, nextOffset: offset + limit < total ? offset + limit : null };
    }
    const view = params.get("view");
    const selected = new Set(params.getAll("selected"));
    const sourcePath = params.get("sourcePath") || params.get("contextPath") || "";
    const current = sourcePath ? await model.readRecord<InterviewContext>(revision, INTERVIEW_RECORDS.context, sourcePath) : null;
    const visiblePicker = new Set(source.preps.map((item) => item.pickerId));
    if (current?.contextPath) visiblePicker.add(`context:${current.contextPath}`);
    const pickerGroups = source.pickerGroups.flatMap((group) => { const items = group.items.filter((item) => visiblePicker.has(item.id) || item.company === params.get("company")); return items.length ? [{ ...group, items }] : []; });
    const base = { ...source, revision,
      pickerTotal: source.pickerGroups.reduce((count, group) => count + group.items.length, 0),
      comparisonTotal: source.comparisons.length,
      comparisonCounts: { relevant: source.comparisons.filter((item) => item.hasInterview || item.hasProfile || item.hasAssessment).length,
        rated: source.comparisons.filter((item) => item.reviews.length).length } };
    const catalog = view === "session" ? { ...base, pickerGroups, reviews: [], comparisons: [] }
      : view === "review" ? { ...base, pickerGroups: [], preps: [], comparisons: [] }
        : view === "insights" ? { ...base, pickerGroups: [], preps: [], reviews: [], comparisons: source.comparisons.filter((item, index) => index < 24 || selected.has(item.path)) }
          : view === "prep" || view === "practice" ? { ...base, pickerGroups: [], preps: [], reviews: [], comparisons: [] } : base;
    return { revision, catalog };
  }
  if (type === "context") {
    if (!path) return null;
    const context = await readInterviewRecord<InterviewContext>(model, revision, INTERVIEW_RECORDS.context, path);
    if (!context) return null;
    const company = context.contextPath ? await readInterviewRecord<InterviewCompanyProjection>(model, revision, INTERVIEW_RECORDS.company, context.contextPath) : null;
    return { revision, context, company };
  }
  if (type === "review") {
    if (!path) return null;
    const block = params.get("block");
    const section = params.get("section");
    if (block && !/^q\d+$/.test(block)) return null;
    if (section && !["quality", "advisory"].includes(section) && !/^q\d+$/.test(section)) return null;
    const value = block ? await readInterviewRecord(model, revision, INTERVIEW_RECORDS.block, interviewBlockKey(path, block))
      : section ? await readInterviewRecord(model, revision, INTERVIEW_RECORDS.section, interviewBlockKey(path, section))
        : await readInterviewRecord<InterviewReviewProjection>(model, revision, INTERVIEW_RECORDS.review, path);
    return value ? { revision, [block ? "block" : section ? "section" : "review"]: value } : null;
  }
  if (type === "trends") return { revision, digest: await readInterviewRecord(model, revision, INTERVIEW_RECORDS.section, params.get("scope") === "review" ? "review-trends" : "digest") };
  return null;
}
