import { jobPosition } from "./jobs.ts";
import { getString, getType, type Note } from "./notes.ts";
import { queueCompanyKey } from "./job-queue.mjs";
import { normalizeJobStatus, SELECTION_STATUSES } from "./job-status.mjs";
import { JOB_CASE_TYPE } from "./vault-boundary.mjs";
import { tokyoParts } from "./dojo/utils.ts";
import { actionableTodoForCase, reviewTodoForCase } from "./user-actions.ts";

/** 同公司有多个岗位时，按此顺序选择一个展示桶；不是选考状态的大小排序。 */
export const AI_APPLICATION_BUCKETS = ["needs-user", "progressing", "unknown", "waiting", "paused", "closed"] as const;
export type AiApplicationBucket = typeof AI_APPLICATION_BUCKETS[number];

export type AiApplication = {
  id: string;
  date: string;
  company: string;
  position: string;
  agent: string;
  note: Note;
  companyKey: string;
  bucket: AiApplicationBucket;
  requiredActions: Note[];
  reviewActions: Note[];
};

export type AiApplicationCompany = {
  key: string;
  company: string;
  bucket: AiApplicationBucket;
  applications: AiApplication[];
};

export type AiApplicationDay = {
  date: string;
  companyCount: number;
  positionCount: number;
  applications: AiApplication[];
  companies: AiApplicationCompany[];
  /** 公司数，六桶互斥且总和等于 companyCount；不能把多岗位重复算成多家公司。 */
  bucketCounts: Record<AiApplicationBucket, number>;
};

function validApplicationDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function applicationBucket(note: Note, requiredActions: Note[], reviewActions: Note[]): AiApplicationBucket {
  const status = normalizeJobStatus(getString(note.frontmatter.status));
  // 旧准备任务或等待字段不能让已结束、主动暂停的案件重新变成待办。
  if (status === "不採用") return "closed";
  if (status === "保留") return "paused";
  if (requiredActions.length) return "needs-user";
  const waitingFor = getString(note.frontmatter.waiting_for).trim();
  // self 和未审核旧 TODO 只是核实线索，不能从 next_action 或受理文案猜出本人义务。
  if (waitingFor === "self") return "unknown";
  if (SELECTION_STATUSES.includes(status ?? "")) return "progressing";
  if (reviewActions.length) return "unknown";
  if (status === "応募済" && ["company", "agent", "platform"].includes(waitingFor)) return "waiting";
  return "unknown";
}

function groupApplicationCompanies(applications: AiApplication[]): AiApplicationCompany[] {
  const companies = new Map<string, AiApplicationCompany>();
  for (const application of applications) {
    const company = companies.get(application.companyKey);
    if (!company) {
      companies.set(application.companyKey, {
        key: application.companyKey, company: application.company,
        bucket: application.bucket, applications: [application],
      });
    } else {
      company.applications.push(application);
      if (AI_APPLICATION_BUCKETS.indexOf(application.bucket) < AI_APPLICATION_BUCKETS.indexOf(company.bucket)) {
        company.bucket = application.bucket;
      }
    }
  }
  return [...companies.values()];
}

/** 申请活动不产生 CalendarEvent；日期是写入时已确认的 JST 日，不再按浏览器时区转换。 */
export function buildAiApplicationDays(notes: Note[], today = tokyoParts().date): AiApplicationDay[] {
  const days = new Map<string, Map<string, AiApplication>>();
  const todosByCase = new Map<string, Map<string, Note>>();
  const casePathsById = new Map<string, Set<string>>();
  for (const note of notes) {
    const caseId = getString(note.frontmatter.case_id);
    if (getType(note) === JOB_CASE_TYPE && caseId.trim()) {
      const paths = casePathsById.get(caseId.trim()) ?? new Set<string>();
      paths.add(note.path);
      casePathsById.set(caseId.trim(), paths);
    }
    if (getType(note) !== "todo" || !caseId) continue;
    const todos = todosByCase.get(caseId) ?? new Map<string, Note>();
    if (!todos.has(note.path)) todos.set(note.path, note);
    todosByCase.set(caseId, todos);
  }
  for (const note of notes) {
    if (getType(note) !== JOB_CASE_TYPE || getString(note.frontmatter.application_actor) !== "ai") continue;
    const date = getString(note.frontmatter.applied_on);
    const agent = getString(note.frontmatter.application_agent).trim();
    const company = getString(note.frontmatter.company).trim();
    const status = normalizeJobStatus(getString(note.frontmatter.status));
    // 只认明确成功提交后的 metadata，不能借推荐作者、入库日或状态括号补出执行事实。
    if (!validApplicationDay(date) || date > today || !agent || !company || !status || status === "未応募") continue;
    const id = getString(note.frontmatter.case_id) || note.path;
    const applications = days.get(date) ?? new Map<string, AiApplication>();
    if (!applications.has(id)) {
      const todos = [...(todosByCase.get(getString(note.frontmatter.case_id))?.values() ?? [])];
      const candidates = todos.filter((todo) => actionableTodoForCase(todo, note, today));
      const ambiguousCase = (casePathsById.get(getString(note.frontmatter.case_id).trim())?.size ?? 0) > 1;
      // 同一个ID落在多个来源时，旧去重计数仍保留，但不能把待办随便派给其中一个案件。
      const requiredActions = ambiguousCase ? [] : candidates;
      const reviewActions = todos.filter((todo) => reviewTodoForCase(todo, note, today) || (ambiguousCase && candidates.includes(todo)));
      applications.set(id, {
        id, date, company, position: jobPosition(note), agent, note,
        companyKey: queueCompanyKey(company),
        bucket: applicationBucket(note, requiredActions, reviewActions), requiredActions, reviewActions,
      });
    }
    days.set(date, applications);
  }
  return [...days].map(([date, cases]) => {
    const applications = [...cases.values()].sort((left, right) => left.company.localeCompare(right.company) ||
      left.position.localeCompare(right.position) || left.id.localeCompare(right.id));
    const companies = groupApplicationCompanies(applications);
    const bucketCounts: Record<AiApplicationBucket, number> = {
      "needs-user": 0, progressing: 0, unknown: 0, waiting: 0, paused: 0, closed: 0,
    };
    for (const company of companies) bucketCounts[company.bucket] += 1;
    return {
      date,
      companyCount: companies.length,
      positionCount: applications.length,
      applications, companies, bucketCounts,
    };
  }).sort((left, right) => left.date.localeCompare(right.date));
}

/** 月概况跨申请日按公司去重；同公司多岗位沿用日详情的优先级，不能把每日公司数相加。 */
export function summarizeAiApplicationDays(days: readonly AiApplicationDay[], month: string) {
  const applications = [...new Map(days.filter(day => day.date.startsWith(`${month}-`))
    .flatMap(day => day.applications).map(application => [application.id, application])).values()];
  const companies = groupApplicationCompanies(applications);
  const bucketCounts: Record<AiApplicationBucket, number> = {
    "needs-user": 0, progressing: 0, unknown: 0, waiting: 0, paused: 0, closed: 0,
  };
  for (const company of companies) bucketCounts[company.bucket] += 1;
  return { companyCount: companies.length, positionCount: applications.length, bucketCounts };
}
