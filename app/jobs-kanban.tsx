"use client";

import { useEffect, useRef, useState } from "react";
import {
  IN_PROGRESS_STATUSES,
  isJobStatus,
  JOB_STATUSES,
  rateText,
  rateTone,
  salaryLabel,
  statusTone,
  type JobCard,
  type JobStatus,
} from "@/lib/jobs";
import { kanbanAcceptsDrop, kanbanDropDecision } from "@/lib/job-kanban";
import { useJobMenu } from "./jobs-copy";
import { Highlight } from "./jobs-shared";
import type { Matcher, StatusWriter } from "./jobs-types";

/** 看板里始终显示的核心列，其余状态列只有有数据时才占位。 */
const KANBAN_CORE_STATUSES: string[] = ["未応募", ...IN_PROGRESS_STATUSES];

/** 看板列：枚举顺序在前，核心五列常驻；笔记里出现的自定义状态补在末尾，避免岗位被吞掉。 */
export function kanbanColumnsOf(kanbanJobs: JobCard[]) {
  const custom = Array.from(new Set(kanbanJobs.map((job) => job.status)))
    .filter((status) => !isJobStatus(status))
    .sort((left, right) => left.localeCompare(right, "ja"));
  return [...JOB_STATUSES, ...custom]
    .map((status) => ({ status, jobs: kanbanJobs.filter((job) => job.status === status) }))
    .filter((column) => column.jobs.length > 0 || KANBAN_CORE_STATUSES.includes(column.status as JobStatus));
}

/**
 * 看板视图：按 `status` 分列，列顺序即 `JOB_STATUSES`。卡片可拖到别的列改状态。
 *
 * 落点规则全部在 lib/job-kanban.ts（同列・自定义列忽略、缺 channel 交给抽屉、不採用先确认）。
 * 不做乐观更新：卡片留在原列，落点列只放一张「写入中…」占位，写完由新笔记把卡带过去——
 * 写入失败时卡片本来就没动，失败原因挂在卡上，不会出现「弹回去了却不知道为什么」。
 */
export function JobKanbanView({
  columns,
  matcher,
  savingPaths,
  statusErrors,
  onDetail,
  onStatus,
}: {
  columns: { status: string; jobs: JobCard[] }[];
  matcher: Matcher;
  savingPaths: string[];
  statusErrors: Record<string, string>;
  onDetail: (path: string, requestStatus?: string) => void;
  onStatus: StatusWriter;
}) {
  const { t } = useJobMenu();
  const [dragging, setDragging] = useState<JobCard | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ job: JobCard; status: string; statusNote: string } | null>(null);
  // 落点列的占位：path → 目标列。写入的 Promise 结束就删，成功与否都由笔记本身说话。
  const [dropping, setDropping] = useState<Record<string, { status: string; company: string }>>({});

  const commit = async (job: JobCard, status: string, statusNote: string) => {
    setDropping((current) => ({ ...current, [job.path]: { status, company: job.company } }));
    try {
      // 显式带上原括号注记：不传的话服务端会把「2026-09-25・一次面接」这类记录当成空注记写掉。
      await onStatus(job.path, status, statusNote, undefined, job.note.stat.mtime);
    } finally {
      setDropping((current) => {
        const next = { ...current };
        delete next[job.path];
        return next;
      });
    }
  };

  const drop = (job: JobCard, status: string) => {
    const decision = kanbanDropDecision(job, status);
    if (decision.kind === "ignore") return;
    if (decision.kind === "need-channel") onDetail(job.path, decision.status);
    else if (decision.kind === "confirm") setConfirm({ job, status: decision.status, statusNote: decision.statusNote });
    else void commit(job, decision.status, decision.statusNote);
  };

  /*
   * 拿起时的变淡、倾斜与列高亮推迟到下一个任务再上：React 在 dragstart 后的微任务里就会提交 DOM，
   * 而浏览器是在 dragstart 派发完之后才截拖影——同步改的话拖影本身就是半透明、歪着的。
   */
  const liftTimer = useRef<number | null>(null);
  const startDrag = (job: JobCard) => {
    if (liftTimer.current !== null) window.clearTimeout(liftTimer.current);
    liftTimer.current = window.setTimeout(() => {
      liftTimer.current = null;
      setDragging(job);
    }, 0);
  };
  useEffect(() => () => {
    if (liftTimer.current !== null) window.clearTimeout(liftTimer.current);
  }, []);

  const endDrag = () => {
    // 极快的拖放可能在推迟的「拿起」之前就结束，不清掉的话看板会停在拖动态。
    if (liftTimer.current !== null) window.clearTimeout(liftTimer.current);
    liftTimer.current = null;
    setDragging(null);
    setOver(null);
  };

  return (
    <>
      {confirm && (
        <div
          className="job-kanban-confirm"
          role="alertdialog"
          aria-label={t("把「{company}」移到「不採用」？", { company: confirm.job.company })}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setConfirm(null);
          }}
        >
          <p>
            <strong>{t("把「{company}」移到「不採用」？", { company: confirm.job.company })}</strong>
            <span>{t("会同时清空等待对象、跟进日期与下一场日程。")}</span>
          </p>
          {/* 焦点先落在「取消」：误拖之后顺手一个 Enter 不该把案件写成不採用。 */}
          <button type="button" autoFocus onClick={() => setConfirm(null)}>{t("取消")}</button>
          <button
            type="button"
            className="job-kanban-confirm-danger"
            onClick={() => {
              const { job, status, statusNote } = confirm;
              setConfirm(null);
              void commit(job, status, statusNote);
            }}
          >
            {t("确认移动")}
          </button>
        </div>
      )}
      <div className={`job-kanban${dragging ? " is-dragging" : ""}`}>
        {columns.map((column) => {
          const accepts = dragging !== null && kanbanAcceptsDrop(dragging, column.status);
          const ghosts = Object.entries(dropping).filter(([path, item]) =>
            item.status === column.status && savingPaths.includes(path) && !column.jobs.some((job) => job.path === path),
          );
          return (
            <section
              key={column.status}
              className={`job-kanban-col tone-${statusTone(column.status)}${accepts ? " can-drop" : ""}${over === column.status ? " drop-target" : ""}`}
              onDragOver={(event) => {
                if (!accepts) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (over !== column.status) setOver(column.status);
              }}
              onDragLeave={(event) => {
                // dragleave 在进入子元素时也会触发；只有真正离开这一列才收起高亮。
                if (!event.currentTarget.contains(event.relatedTarget as Node | null) && over === column.status) setOver(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging) drop(dragging, column.status);
                endDrag();
              }}
            >
              <header className="job-kanban-head">
                <strong title={column.status}>{column.status}</strong>
                <span>{column.jobs.length}</span>
              </header>
              <div className="job-kanban-body">
                {ghosts.map(([path, item]) => (
                  <div key={path} className="job-kanban-ghost" role="status">
                    <strong>{item.company}</strong>
                    <small>{t("写入中…")}</small>
                  </div>
                ))}
                {column.jobs.map((job) => {
                  const saving = savingPaths.includes(job.path);
                  const error = statusErrors[job.path];
                  return (
                    <button
                      key={job.path}
                      type="button"
                      draggable={!saving}
                      title={t("拖动可改状态")}
                      className={`job-kanban-card rate-${rateTone(job.rating)}${dragging?.path === job.path ? " is-dragged" : ""}${saving ? " saving" : ""}`}
                      onClick={() => onDetail(job.path)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", job.path);
                        event.dataTransfer.effectAllowed = "move";
                        startDrag(job);
                      }}
                      onDragEnd={endDrag}
                    >
                      <span className="job-kanban-title">
                        <strong><Highlight text={job.company} matcher={matcher} /></strong>
                        <i title={job.rated ? undefined : t("未採点")}>{rateText(job)}</i>
                      </span>
                      <small><Highlight text={job.position || "—"} matcher={matcher} /></small>
                      <span className="job-kanban-salary">{salaryLabel(job)}</span>
                      {error && <em className="job-kanban-error">{t("没有写入。{message}", { message: error })}</em>}
                    </button>
                  );
                })}
                {column.jobs.length === 0 && ghosts.length === 0 && <span className="job-kanban-empty">{t("放到这里")}</span>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
