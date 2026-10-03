import { jobPosition } from "./jobs.ts";
import { getString, getType, type Note } from "./notes.ts";
import { queueCompanyKey } from "./job-queue.mjs";
import { normalizeJobStatus } from "./job-status.mjs";
import { JOB_CASE_TYPE } from "./vault-boundary.mjs";
import { tokyoParts } from "./dojo/utils.ts";

export type AiApplication = {
  id: string;
  date: string;
  company: string;
  position: string;
  agent: string;
  note: Note;
};

export type AiApplicationDay = {
  date: string;
  companyCount: number;
  positionCount: number;
  applications: AiApplication[];
};

function validApplicationDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 申请活动不产生 CalendarEvent；日期是写入时已确认的 JST 日，不再按浏览器时区转换。 */
export function buildAiApplicationDays(notes: Note[], today = tokyoParts().date): AiApplicationDay[] {
  const days = new Map<string, Map<string, AiApplication>>();
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
      applications.set(id, { id, date, company, position: jobPosition(note), agent, note });
    }
    days.set(date, applications);
  }
  return [...days].map(([date, cases]) => {
    const applications = [...cases.values()].sort((left, right) => left.company.localeCompare(right.company) ||
      left.position.localeCompare(right.position) || left.id.localeCompare(right.id));
    return {
      date,
      companyCount: new Set(applications.map((application) => queueCompanyKey(application.company))).size,
      positionCount: applications.length,
      applications,
    };
  }).sort((left, right) => left.date.localeCompare(right.date));
}
