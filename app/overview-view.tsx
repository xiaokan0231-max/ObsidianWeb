"use client";

import { memo, useMemo, useState } from "react";
import { type AppView } from "./app-route";
import type { JobsInitialFilters } from "./jobs-view";
import { buildWaitingItems, focusDateLabel } from "@/lib/focus-action";
import { IN_FLIGHT_STATUSES, awaitingCounterpart, compareJobs, toJobCard } from "@/lib/jobs";
import { isInterviewEvent } from "@/lib/calendar-interview";
import { joinReviewNotes } from "@/lib/review-join";
import { parseInterviewPractice } from "@/lib/review-practice";
import { formatDate, getString, getType, type Note } from "@/lib/notes";
import {
  calendarCompanyIdentity,
  ACTIVE_JOB_STATUSES,
  buildReviewPreview,
  calendarEventTime,
  careerStatus,
  getLatestNoteDate,
  localDateKey,
  type CalendarEvent,
  type DerivedData,
} from "@/lib/memory-atlas-data";

type View = AppView;

// 进行中案件按选考进度排列，面试中的案件优先。
const currentStageRank: Record<string, number> = { 面接中: 0, 書類通過: 1, 応募済: 2 };

function Overview({
  notes,
  derived,
  today,
  onOpen,
  onView,
  onViewJobs,
  onOpenCase,
  onOpenSchedule,
  onFollowUp,
  onOpenReview,
}: {
  notes: Note[];
  derived: DerivedData;
  /** 「今日」は殻が持つ。memo で包まれているので、中で new Date() すると日付を跨いでも凍る。 */
  today: string;
  onOpen: (note: Note) => void;
  onView: (view: View) => void;
  /** 带状态筛选跳到看板（分析页同款）。 */
  onViewJobs?: (filters?: JobsInitialFilters) => void;
  /** 打开看板里这条案件的抽屉（有跟进表单），而不是只读的原笔记。 */
  onOpenCase?: (note: Note) => void;
  /** 近期安排直达那场面试的准备页／复盘页；认不出对应面试时由外壳退回原笔记。 */
  onOpenSchedule?: (event: CalendarEvent) => void;
  /** 等待区就地处理：改跟进日或改为等本人。返回错误文案，成功为 null。 */
  onFollowUp?: (note: Note, values: { waitingFor?: string | null; followUpAt?: string | null }) => Promise<string | null>;
  onOpenReview: (key?: string) => void;
}) {
  const jobs = useMemo(() => derived.cases.map(toJobCard), [derived.cases]);
  const reviewPreview = useMemo(() => buildReviewPreview(notes), [notes]);
  // 缓存案件列表，避免外壳切换搜索框或抽屉时重新排序。
  const currentCases = useMemo(() => jobs
    .filter((job) => ACTIVE_JOB_STATUSES.has(job.status))
    .sort(
      (left, right) =>
        (currentStageRank[left.status] ?? 9) - (currentStageRank[right.status] ?? 9) ||
        right.statusUpdated.localeCompare(left.statusUpdated),
    ), [jobs]);
  const recentChanges = useMemo(() => jobs
    .filter((job) => !ACTIVE_JOB_STATUSES.has(job.status) && job.status !== "未応募")
    .slice(0, 3), [jobs]);
  // 跟进日随 today 重算，跨日后等待区的逾期提示也会更新。
  const waiting = useMemo(() => buildWaitingItems(notes, today), [notes, today]);

  // 「已经动过手、等对方回应」的未応募不算待判断——看板同一条规则（awaitingCounterpart），否则首页数字虚高。
  const openJobs = useMemo(() => jobs
    .filter((job) => job.status === "未応募" && !awaitingCounterpart(job))
    .sort((left, right) => compareJobs(left, right, "rating")), [jobs]);
  const topSalary = openJobs
    .map((job) => job.salary.max ?? 0)
    .filter((value) => value > 0)
    .sort((left, right) => right - left)[0];
  const practiceQueue = useMemo(() =>
    notes
      .filter((note) => getType(note) === "interview-answer-practice")
      .flatMap((note) =>
        parseInterviewPractice(note.content).map((entry) => ({
          ...entry,
          company: getString(note.frontmatter.company),
          date: getString(note.frontmatter.date),
          round: getString(note.frontmatter.round),
        })),
      )
      .filter((entry) =>
        entry.status === "queued" ||
        entry.status === "active" ||
        (entry.status === "snoozed" && (!entry.dueAt || entry.dueAt <= today)),
      )
      .sort((left, right) => (right.queuedAt || "").localeCompare(left.queuedAt || "")),
    [notes, today]);
  const drillTarget = practiceQueue[0] ?? null;

  const [year, month, day] = today.split("-").map(Number);
  const horizon = localDateKey(new Date(year, month - 1, day + 6));
  const upcoming = derived.calendarEvents.filter((event) => event.phase === "upcoming" && event.date <= horizon);
  // 已过的面试如果没有整理稿，复盘链路从起点就断了、而且没人提醒（整理稿是 joinReviewNotes 的起点）。
  // 只看最近 14 天：更早的要么已经复盘，要么本人决定不复盘了。
  const missingTranscripts = useMemo(() => {
    const floor = localDateKey(new Date(year, month - 1, day - 14));
    const joined = joinReviewNotes(notes);
    const covered = (event: { company: string; date: string }) => joined.some((doc) =>
      doc.date === event.date && calendarCompanyIdentity(doc.company) === calendarCompanyIdentity(event.company));
    return derived.calendarEvents
      // 只提醒真正的面试・面谈：说明会・研讨会也在日历上，但没有可复盘的问答。判定与日历进复盘页的入口同一条。
      .filter((event) => event.phase === "past" && event.date >= floor && event.date < today && isInterviewEvent(event) && !covered(event))
      .slice(0, 5);
  }, [derived.calendarEvents, notes, today, year, month, day]);
  const [copiedTranscript, setCopiedTranscript] = useState("");
  const copyTranscriptRequest = async (event: { id: string; company: string; date: string; label: string }) => {
    const text = `${event.company} ${event.date} ${event.label}：请生成面试整理稿，然后用 /review-interview-answers 复盘`;
    try { await navigator.clipboard.writeText(text); setCopiedTranscript(event.id); } catch { setCopiedTranscript(""); }
  };
  const actionReviewDoc = reviewPreview.actionDoc;
  const openCase = (note: Note) => (onOpenCase ? onOpenCase(note) : onOpen(note));
  const openSchedule = (event: CalendarEvent) => (onOpenSchedule ? onOpenSchedule(event) : onOpen(event.note));
  // 顶部三个数字各自落到「就是这些」的那一页：点了之后看到的件数要和这里一致，否则数字就没法信。
  const viewJobs = (filters: JobsInitialFilters) => (onViewJobs ? onViewJobs(filters) : onView("jobs"));
  const [followUpBusy, setFollowUpBusy] = useState("");
  const [followUpError, setFollowUpError] = useState("");
  const runFollowUp = async (note: Note, values: { waitingFor?: string | null; followUpAt?: string | null }) => {
    if (!onFollowUp) return;
    setFollowUpBusy(note.path);
    setFollowUpError("");
    const error = await onFollowUp(note, values);
    setFollowUpBusy("");
    if (error) setFollowUpError(error);
  };
  const plusDays = (days: number) => localDateKey(new Date(year, month - 1, day + days));
  const casesPanel = (currentCases.length > 0 || recentChanges.length > 0) ? (
    <article className="panel pipeline-panel" key="cases" data-overview-panel="cases">
      <PanelHeading title="进行中案件" action="查看选考" onAction={() => onView("analytics")} />
      <div className="pipeline-list" aria-label="当前进行中的求职记录">
        {currentCases.slice(0, 6).map((job) => {
          const status = careerStatus(job.status);
          const date = job.statusUpdated || job.date || getLatestNoteDate(job.note);
          return (
            <button key={job.path} onClick={() => openCase(job.note)}>
              <span className={`pipeline-status tone-${status.tone}`}>{status.label}</span>
              <span className="pipeline-company">
                <span className="pipeline-company-head"><strong>{job.company}</strong><time dateTime={date}>{formatDate(date)}</time></span>
                <small>{job.nextAction || job.position || "案件详情"}</small>
              </span>
              <span className="pipeline-arrow" aria-hidden="true">↗</span>
            </button>
          );
        })}
      </div>
      {recentChanges.length > 0 && (
        <details className="overview-recent">
          <summary>最近变化 · {recentChanges.length} 项</summary>
          <div className="pipeline-recent">
            {recentChanges.map((job) => {
              const status = careerStatus(job.status);
              const date = job.statusUpdated || job.date || getLatestNoteDate(job.note);
              return <button key={job.path} onClick={() => openCase(job.note)}>
                <span className={`pipeline-status tone-${status.tone}`}>{status.label}</span>
                <strong>{job.company}</strong><time dateTime={date}>{formatDate(date)}</time>
              </button>;
            })}
          </div>
        </details>
      )}
    </article>
  ) : null;
  const jobsPanel = openJobs.length > 0 ? (
    <article className="panel jobs-preview-panel" key="jobs" data-overview-panel="jobs">
      <PanelHeading title="待判断岗位" action="打开筛选台" onAction={() => onView("jobs")} />
      <div className="jobs-preview-stats">
        <div><strong>{openJobs.length}</strong><span>条未应募</span></div>
        <div><strong>{openJobs.filter((job) => job.rating >= 8).length}</strong><span>8 点以上</span></div>
        <div><strong>{topSalary ? `${topSalary}万` : "—"}</strong><span>未应募最高</span></div>
      </div>
      <div className="jobs-preview-list">
        {openJobs.slice(0, 4).map((job) => (
          <button key={job.path} onClick={() => openCase(job.note)}>
            <span className={`jobs-preview-rating rating-${job.rating}`}>{job.rating}</span>
            <span className="jobs-preview-body"><strong>{job.company}</strong><small>{job.position || job.location}</small></span>
            <span className="jobs-preview-salary">{job.salary.max ? `${job.salary.max}万` : ""}</span>
          </button>
        ))}
      </div>
    </article>
  ) : null;
  const schedulePanel = (
    <article className="panel overview-schedule" key="schedule" data-overview-panel="schedule">
      <PanelHeading title="近期安排" action="打开日历" onAction={() => onView("calendar")} />
      <p className="overview-panel-meta">未来 7 天 · {upcoming.length} 项 · 日本时间（JST）</p>
      {upcoming.length === 0 ? <p className="panel-empty">未来 7 天没有已确认的安排。</p> : <div className="overview-schedule-list">
        {upcoming.slice(0, 5).map((event) => (
          <button className={`kind-${event.kind}`} key={event.id} onClick={() => openSchedule(event)}>
            <span><time dateTime={event.date}>{focusDateLabel(event.date)}{event.time && ` ${calendarEventTime(event)}`}</time><small>{event.label}</small></span>
            <strong>{event.company}</strong>
          </button>
        ))}
      </div>}
    </article>
  );
  const overdueCount = waiting.filter((item) => item.overdue).length;
  const waitingPanel = waiting.length > 0 ? (
    <article className="panel overview-waiting" key="waiting" data-overview-panel="waiting">
      <PanelHeading
        title={overdueCount > 0 ? `等待回复 · ${overdueCount} 项已到跟进日` : "等待回复"}
        action={`全部 ${waiting.length} 项`}
        // 落在「只看等对方」：与这张列表同一个判定，条数一致（按进行中状态筛会漏掉未応募＋等对方、又混进没在等的）。
        onAction={() => (onViewJobs ? onViewJobs({ waiting: true }) : onView("jobs"))}
      />
      {followUpError && <p className="inline-write-error" role="alert">{followUpError}</p>}
      <div className="overview-waiting-list">
        {waiting.slice(0, 5).map((item) => (
          <div key={item.note.path} className={`overview-waiting-item${item.overdue ? " overdue" : ""}`}>
            <button onClick={() => openCase(item.note)}>
              <strong>{item.company || item.waitingFor}</strong>
              <span>{item.label}</span>
              {item.followUpAt && (
                <small>{item.overdue
                  ? `跟进日 ${focusDateLabel(item.followUpAt)} 已过，该催了`
                  : `${focusDateLabel(item.followUpAt)}后未回复则跟进`}</small>
              )}
            </button>
            {onFollowUp && (
              <span className="overview-waiting-actions">
                <button type="button" disabled={followUpBusy === item.note.path} onClick={() => void runFollowUp(item.note, { followUpAt: plusDays(7) })} title="记为已跟进，7 天后再提醒">已跟进 · +7 天</button>
                <button type="button" disabled={followUpBusy === item.note.path} onClick={() => void runFollowUp(item.note, { waitingFor: "self", followUpAt: null })} title="球回到自己手里，不再催">改为等本人</button>
              </span>
            )}
          </div>
        ))}
      </div>
    </article>
  ) : null;
  const reviewPanel = reviewPreview.pendingDecisions > 0 || reviewPreview.readyCount > 0 || missingTranscripts.length > 0 ? (
    <article className="panel overview-review" key="review" data-overview-panel="review">
      <PanelHeading title="复盘提醒" action="全部复盘" onAction={() => onOpenReview()} />
      {(reviewPreview.pendingDecisions > 0 || reviewPreview.readyCount > 0) && (
        <p className="overview-review-counts">
          {reviewPreview.pendingDecisions > 0 && <span><strong>{reviewPreview.pendingDecisions}</strong> 个待裁定</span>}
          {reviewPreview.readyCount > 0 && <span><strong>{reviewPreview.readyCount}</strong> 场可生成复盘</span>}
        </p>
      )}
      {missingTranscripts.length > 0 && (
        <ul className="overview-review-missing" aria-label="已过但还没有整理稿的面试">
          {missingTranscripts.map((event) => (
            <li key={event.id}>
              <span><strong>{event.company}</strong> · {focusDateLabel(event.date)} {event.label}</span>
              <small>还没有整理稿</small>
              <button type="button" onClick={() => void copyTranscriptRequest(event)}>{copiedTranscript === event.id ? "已复制" : "复制指令"}</button>
            </li>
          ))}
        </ul>
      )}
      {(reviewPreview.pendingDecisions > 0 || reviewPreview.readyCount > 0) && (
        <button className="overview-review-action" onClick={() => onOpenReview(actionReviewDoc?.key)}>
          {actionReviewDoc?.pendingDecisions ? "继续裁定" : "打开复盘"}<span aria-hidden="true">→</span>
        </button>
      )}
    </article>
  ) : null;
  const practicePanel = drillTarget ? (
    <article className="panel drill-panel" key="practice" data-overview-panel="practice">
      <PanelHeading title="今日重练" action={`全部 ${practiceQueue.length} 题`} onAction={() => onView("practice")} />
      <button className="drill-action" type="button" onClick={() => onView("practice")}>
        <span><small>{drillTarget.company || drillTarget.round || "今日素振り"}</small><strong>{drillTarget.blockId} {drillTarget.questionTitle}</strong></span>
        <b>开始 →</b>
      </button>
    </article>
  ) : null;
  const primaryPanels = [casesPanel, jobsPanel].filter(Boolean);
  const secondaryPanels = [waitingPanel, reviewPanel, practicePanel].filter(Boolean);

  return (
    <div className="overview-view">
      <header className="overview-header">
        <div className="overview-heading"><h1>概览</h1><time dateTime={today}>{formatDate(today)}</time></div>
        <div className="overview-stats">
          {/* 与看板使用同一筛选规则，点击数字后看到的案件数才能一致。 */}
          <Stat value={currentCases.length} label="个进行中案件" onClick={() => viewJobs({ statuses: IN_FLIGHT_STATUSES })} />
          <Stat value={openJobs.length} label="条待应募岗位" onClick={() => viewJobs({ statuses: ["未応募"], touch: ["untouched"] })} />
          <Stat value={reviewPreview.pendingDecisions} label="个复盘点待裁定" onClick={() => onOpenReview()} />
        </div>
      </header>
      {schedulePanel}
      {(primaryPanels.length > 0 || secondaryPanels.length > 0) && (
        <div className={`overview-columns${primaryPanels.length > 0 && secondaryPanels.length > 0 ? "" : " is-single"}`}>
          {primaryPanels.length > 0 && <div className="overview-stack overview-primary-stack">{primaryPanels}</div>}
          {secondaryPanels.length > 0 && <div className="overview-stack overview-secondary-stack">{secondaryPanels}</div>}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, onClick }: { value: number; label: string; onClick: () => void }) {
  return <button type="button" data-zero={value === 0} onClick={onClick}><strong>{value}</strong><span>{label}</span></button>;
}

function PanelHeading({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return <div className="panel-heading"><h2>{title}</h2><button onClick={onAction}>{action} <span aria-hidden="true">↗</span></button></div>;
}

// 外壳的 UI state 变化时不重绘首页。
export default memo(Overview);
