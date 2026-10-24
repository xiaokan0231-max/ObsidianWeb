import { interviewContext, matchingInterviewContext, matchingInterviewPrep, resolveCalendarInterview, resolveInterviewOwner, type CalendarInterviewTarget } from "./calendar-interview.ts";
import { IN_PROGRESS_STATUSES, jobStatusNote, normalizeJobStatus, waitsOnCounterpart, WAITING_FOR_LABEL } from "./jobs.ts";
import type { CalendarEvent } from "./memory-atlas-data.ts";
import { getString, getType, type Note } from "./notes.ts";

/**
 * 判定分支的稳定编号。label / detail 是中文正本（aria-label、title 依赖它们的原文），
 * 日语界面按 code 取译文；waitingFor / waitingLabel / reason 是译文需要拼回的原始值。
 */
export type CalendarProgressCode =
  | "rejected" | "paused" | "offer" | "meeting-closed" | "scheduled"
  | "waiting-case" | "active-self" | "active-case" | "meeting-waiting" | "unrecorded"
  | "historical-unlinked" | "association-missing" | "association-conflict" | "meeting-unrecorded"
  | "recorded-rejected" | "recorded-passed" | "recorded-meeting-completed" | "historical-result";

export type CalendarProgress = {
  tone: "active" | "waiting" | "closed" | "paused" | "unknown" | "neutral";
  code: CalendarProgressCode;
  label: string;
  detail: string;
  waitingFor?: string;
  waitingLabel?: string;
  reason?: string;
  /** 仅复盘自身的当轮结果；不用于改写关联案件的当前状态。 */
  recordedResult?: string;
  /** 等待汇总按明确归属去重，不把同一独立面谈的多份场次资料当成多个案件。 */
  ownerKey?: string;
  /**
   * 这一场本身是否已经进行过（日期已过，或当天已有整理稿／准备稿已完成）。与选考是否结束无关；
   * 当天面完的场次 phase 仍是 upcoming，「下一场」「未来 7 天」要靠它排除，「最近记录」靠它收进来。
   */
  occurred: boolean;
};

const HISTORICAL_CODES: ReadonlySet<CalendarProgressCode> = new Set([
  "historical-unlinked", "association-missing", "meeting-unrecorded", "recorded-rejected",
  "recorded-passed", "recorded-meeting-completed", "historical-result", "unrecorded",
]);

/** 历史说明的条数与展开列表使用同一口径；当轮不通过也是已有历史事实。 */
export function isCalendarHistoricalProgress(progress: Pick<CalendarProgress, "code">) {
  return HISTORICAL_CODES.has(progress.code);
}

function unresolvedAssociation(note: Note, notes: Note[], eventCaseId: string): "conflict" | "missing" | null {
  const context = interviewContext(note, notes, true);
  if (context.invalid || (context.caseId && eventCaseId && context.caseId !== eventCaseId)) return "conflict";
  const caseId = context.caseId || eventCaseId;
  if (caseId && notes.filter((candidate) => getType(candidate) === "job-case" &&
    getString(candidate.frontmatter.case_id) === caseId).length > 1) return "conflict";
  return context.ownerKind || caseId ? "missing" : null;
}

/** 日程是否已过和选考是否结束是两回事；状态点读当前正本，不从正文或公司名推测。 */
export function calendarProgress(
  event: CalendarEvent,
  notes: Note[],
  target?: CalendarInterviewTarget,
): CalendarProgress {
  let ownerSource = event.note;
  let ownerEventCaseId = event.caseId;
  let owner = resolveInterviewOwner(event.note, notes, event.caseId);
  if (!owner && !event.caseId && ["review", "transcript", "transcript-study"].includes(getType(event.note)) &&
    !["case", "meeting", "case_id"].some((field) => getString(event.note.frontmatter[field]).trim())) {
    // 旧复盘可能没有关联字段，只能借唯一匹配的当轮准备稿；显式失效链接不能走这个兜底。
    const prep = matchingInterviewPrep(event, notes);
    if (prep) {
      ownerSource = prep;
      ownerEventCaseId = "";
      owner = resolveInterviewOwner(prep, notes);
    } else {
      // 多版准备稿不能任选一篇，但全部明确指向同一正本时，归属本身没有歧义。
      const context = matchingInterviewContext(event, notes);
      if (context) {
        ownerSource = { ...event.note, frontmatter: {
          type: getType(event.note), case_id: context.caseId,
          ...(context.ownerKind && context.owner ? { [context.ownerKind]: `[[${context.owner}]]` } : {}),
        } };
        ownerEventCaseId = "";
        owner = resolveInterviewOwner(ownerSource, notes);
      }
    }
  }
  const ownerKey = owner ? getType(owner) === "job-case"
    ? `case:${getString(owner.frontmatter.case_id) || owner.path}` : `meeting:${owner.path}` : "";
  // 是否已进行要在状态分支之前算：不採用／保留／内定会提前返回，当天面完的这类场次也不能再当下一场。
  const interview = target ?? resolveCalendarInterview(event, notes);
  const occurred = event.phase === "past" || interview?.view === "review";
  const result = (progress: Omit<CalendarProgress, "occurred">): CalendarProgress =>
    ({ ...progress, ...(ownerKey ? { ownerKey } : {}), occurred });
  const status = owner && getType(owner) === "job-case"
    ? normalizeJobStatus(getString(owner.frontmatter.status)) : null;
  const selection = owner && getType(owner) === "todo"
    ? getString(owner.frontmatter.selection_status) : "";
  const waitingLabel = owner ? getString(owner.frontmatter.waiting_label).trim() : "";
  const waitingDetail = waitingLabel ? `：${waitingLabel}` : "";

  // 已知结果盖过未清理的 waiting_for 和旧预约，避免拒信之后仍闪着等待提示。
  if (status === "不採用") return result({ tone: "closed", code: "rejected", label: "已结束", detail: "当前案件已记录不採用，选考已结束。" });
  if (status === "保留") {
    const reason = jobStatusNote(getString(owner?.frontmatter.status));
    return result({ tone: "paused", code: "paused", label: "暂停推进", detail: `当前案件已保留，暂不继续推进。${reason ? `记录原因：${reason}。` : ""}`, reason });
  }
  if (status === "内定") return result({ tone: "active", code: "offer", label: "已获内定", detail: "当前案件已记录内定。" });
  if (selection === "closed") return result({ tone: "closed", code: "meeting-closed", label: "已结束", detail: "这场独立面谈的后续已明确结束。" });

  if (!occurred) return result({ tone: "active", code: "scheduled", label: "待进行", detail: "已确认的日程，尚未记录完成。" });

  if (owner && status) {
    const waitingFor = getString(owner.frontmatter.waiting_for);
    if (waitsOnCounterpart(status, waitingFor)) {
      const counterpart = WAITING_FOR_LABEL[waitingFor] ?? "对方";
      return result({ tone: "waiting", code: "waiting-case", label: "等回复", detail: `日程已过，当前案件仍在等待${counterpart}回复${waitingDetail}。`, waitingFor, waitingLabel });
    }
    if (IN_PROGRESS_STATUSES.includes(status)) {
      return result(waitingFor === "self"
        ? { tone: "active", code: "active-self", label: "进行中", detail: "日程已过，当前案件仍在推进；记录的等待方为本人。具体动作以已核实待办为准。" }
        : { tone: "active", code: "active-case", label: "进行中", detail: "日程已过，当前案件仍在选考中。" });
    }
  }
  if (selection === "waiting") return result({ tone: "waiting", code: "meeting-waiting", label: "等回复", detail: `日程已过，这场独立面谈仍在等待后续回复${waitingDetail}。`, waitingLabel });

  const recordedResult = getType(event.note) === "review" && typeof event.note.frontmatter.result === "string"
    ? event.note.frontmatter.result.trim() : "";
  const recordedContext = recordedResult ? { recordedResult } : {};
  if (!owner) {
    const issue = unresolvedAssociation(ownerSource, notes, ownerEventCaseId);
    if (issue === "conflict") return result({
      tone: "unknown", code: "association-conflict", label: "关联有冲突",
      detail: "这场记录的明确关联存在冲突或不唯一，不能据此判断当前选考状态。", ...recordedContext,
    });
    if (issue === "missing") return result({
      tone: "neutral", code: "association-missing", label: "历史关联缺失",
      detail: "已保留这场历史记录，但明确引用的案件或面谈正本未找到；这不表示产生了本人待办。", ...recordedContext,
    });
    if (recordedResult === "不採用") return result({
      tone: "closed", code: "recorded-rejected", label: "当轮未通过",
      detail: `复盘记录的 ${event.date} 当轮结果为不採用；这是当轮历史结果，不代替当前案件状态。`, recordedResult,
    });
    if (recordedResult === "通過") return result({
      tone: "neutral", code: "recorded-passed", label: "当轮通过",
      detail: `复盘记录的 ${event.date} 当轮结果为通過；不能据此判断当前仍在选考或需要本人处理。`, recordedResult,
    });
    if (/^面談完了(?:$|[・／/])/u.test(recordedResult)) return result({
      tone: "neutral", code: "recorded-meeting-completed", label: "面谈已完成",
      detail: "复盘记载这场面谈已完成；这不代表后续选考已结束，也不据此产生本人待办。", recordedResult,
    });
    if (recordedResult) return result({
      tone: "neutral", code: "historical-result", label: "已有当轮记录",
      // 旧结果可能混有私人条件与已失效宿题，默认提示只解释范围，原文留在主动打开的来源里。
      detail: "这场复盘已保存当轮结果。当前案件未关联，不从历史结果推定现行选考状态或本人义务。", recordedResult,
    });
    return result({
      tone: "neutral", code: "historical-unlinked", label: "历史记录",
      detail: "已保留这场历史记录，尚未关联当前案件；没有据此生成需要本人处理的事项。",
    });
  }

  if (getType(owner) === "todo") return result({
    tone: "neutral", code: "meeting-unrecorded", label: "后续结果未记载",
    detail: "这场独立面谈的后续结果未明确记载。准备任务完成或日期已过，都不表示后续已结束。", ...recordedContext,
  });

  // 准备 TODO 的完了只说明行动已完成，不是企业给出了选考结果。
  return result({ tone: "neutral", code: "unrecorded", label: "后续状态未记载", detail: "关联正本没有可用的当前选考状态，历史场次仍保留；不从资料缺项推定本人义务。", ...recordedContext });
}
