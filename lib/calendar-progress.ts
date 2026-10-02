import { matchingInterviewPrep, resolveCalendarInterview, resolveInterviewOwner, type CalendarInterviewTarget } from "./calendar-interview.ts";
import { IN_PROGRESS_STATUSES, jobStatusNote, normalizeJobStatus, waitsOnCounterpart, WAITING_FOR_LABEL } from "./jobs.ts";
import type { CalendarEvent } from "./memory-atlas-data.ts";
import { getString, getType, type Note } from "./notes.ts";

export type CalendarProgress = {
  tone: "active" | "waiting" | "closed" | "paused" | "unknown";
  label: string;
  detail: string;
};

/** 日程是否已过和选考是否结束是两回事；状态点读当前正本，不从正文或公司名推测。 */
export function calendarProgress(
  event: CalendarEvent,
  notes: Note[],
  target?: CalendarInterviewTarget,
): CalendarProgress {
  let owner = resolveInterviewOwner(event.note, notes, event.caseId);
  if (!owner && !event.caseId && ["review", "transcript", "transcript-study"].includes(getType(event.note)) &&
    !["case", "meeting", "case_id"].some((field) => getString(event.note.frontmatter[field]).trim())) {
    // 旧复盘可能没有关联字段，只能借唯一匹配的当轮准备稿；显式失效链接不能走这个兜底。
    const prep = matchingInterviewPrep(event, notes);
    if (prep) owner = resolveInterviewOwner(prep, notes);
  }
  const status = owner && getType(owner) === "job-case"
    ? normalizeJobStatus(getString(owner.frontmatter.status)) : null;
  const selection = owner && getType(owner) === "todo"
    ? getString(owner.frontmatter.selection_status) : "";
  const waitingLabel = owner ? getString(owner.frontmatter.waiting_label).trim() : "";
  const waitingDetail = waitingLabel ? `：${waitingLabel}` : "";

  // 已知结果盖过未清理的 waiting_for 和旧预约，避免拒信之后仍闪着等待提示。
  if (status === "不採用") return { tone: "closed", label: "已结束", detail: "当前案件已记录不採用，选考已结束。" };
  if (status === "保留") {
    const reason = jobStatusNote(getString(owner?.frontmatter.status));
    return { tone: "paused", label: "暂停推进", detail: `当前案件已保留，暂不继续推进。${reason ? `记录原因：${reason}。` : ""}` };
  }
  if (status === "内定") return { tone: "active", label: "已获内定", detail: "当前案件已记录内定。" };
  if (selection === "closed") return { tone: "closed", label: "已结束", detail: "这场独立面谈的后续已明确结束。" };

  const interview = target ?? resolveCalendarInterview(event, notes);
  const occurred = event.phase === "past" || interview?.view === "review";
  if (!occurred) return { tone: "active", label: "待进行", detail: "已确认的日程，尚未记录完成。" };

  if (owner && status) {
    const waitingFor = getString(owner.frontmatter.waiting_for);
    if (waitsOnCounterpart(status, waitingFor)) {
      const counterpart = WAITING_FOR_LABEL[waitingFor] ?? "对方";
      return { tone: "waiting", label: "等回复", detail: `日程已过，当前案件仍在等待${counterpart}回复${waitingDetail}。` };
    }
    if (IN_PROGRESS_STATUSES.includes(status)) {
      return { tone: "active", label: "进行中", detail: waitingFor === "self"
        ? "日程已过，当前案件仍在推进，下一步由本人处理。"
        : "日程已过，当前案件仍在选考中。" };
    }
  }
  if (selection === "waiting") return { tone: "waiting", label: "等回复", detail: `日程已过，这场独立面谈仍在等待后续回复${waitingDetail}。` };

  // 准备 TODO 的完了只说明行动已完成，不是企业给出了选考结果。
  return { tone: "unknown", label: "资料待核对", detail: "缺少这场日程的后续状态记录，需要核对资料才能判断当前进展。" };
}
