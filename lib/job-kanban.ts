import {
  isJobStatus,
  jobStatusNoteError,
  statusRequiresChannel,
  type JobStatus,
} from "./job-status.ts";

/*
 * 看板拖拽的落点判定。放在 lib 而不是看板组件里，是因为「拖到哪一列会写什么」直接改真实案件，
 * 规则必须能被 node 测试逐条钉住，浏览器里只验证同列落下（no-op）。
 *
 * 写入接口的契约（app/api/jobs/status）：status 必须是 7 枚举之一；応募済以降必须有 channel；
 * 已有的 channel 不能被覆盖。看板落点拿不到渠道，所以缺 channel 时不写，交给抽屉的渠道面板。
 */

export type KanbanDropJob = {
  status: string;
  /** status 括号里的注记（jobStatusNote）。跨列移动时原样带过去——死因与日期是记录，不是装饰。 */
  statusNote: string;
  channel: string;
};

export type KanbanDropDecision =
  /** 同列、自定义状态列：什么都不做，也不显示可落下的高亮。 */
  | { kind: "ignore"; reason: "same-column" | "custom-column" }
  /** 目标状态要求 channel 而案件没有：不写，打开详情让本人选渠道。 */
  | { kind: "need-channel"; status: JobStatus }
  /** 移到「不採用」会顺带清掉等待・跟进・下一场日程，先确认再写。 */
  | { kind: "confirm"; status: JobStatus; statusNote: string }
  | { kind: "write"; status: JobStatus; statusNote: string };

/**
 * 原注记若已经不合法（超长、含破坏 YAML 的字符），带过去只会让写入整个被拒；
 * 这时宁可丢掉注记也不让拖拽无声失败——原文仍在笔记的 git 历史里。
 */
function carriedNote(note: string) {
  return note && !jobStatusNoteError(note) ? note : "";
}

export function kanbanDropDecision(job: KanbanDropJob, target: string): KanbanDropDecision {
  // 自定义列是笔记里写坏的状态，接口不收；往那里放卡等于造一个不存在的枚举值。
  if (!isJobStatus(target)) return { kind: "ignore", reason: "custom-column" };
  if (target === job.status) return { kind: "ignore", reason: "same-column" };
  if (statusRequiresChannel(target) && !job.channel) return { kind: "need-channel", status: target };
  const statusNote = carriedNote(job.statusNote);
  if (target === "不採用") return { kind: "confirm", status: target, statusNote };
  return { kind: "write", status: target, statusNote };
}

/** 这一列此刻能不能当落点：决定 dragover 时要不要 preventDefault 与高亮。 */
export function kanbanAcceptsDrop(job: KanbanDropJob, target: string) {
  return kanbanDropDecision(job, target).kind !== "ignore";
}
