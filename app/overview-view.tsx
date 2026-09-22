"use client";

import { memo, useMemo, useState, useSyncExternalStore } from "react";
import { type AppView } from "./app-route";
import { buildFocusBrief, focusDateLabel } from "@/lib/focus-action";
import { compareJobs, toJobCard } from "@/lib/jobs";
import { parseInterviewPractice } from "@/lib/review-practice";
import { formatDate, getString, getTitle, getType, type Note } from "@/lib/notes";
import {
  ACTIVE_JOB_STATUSES,
  buildReviewPreview,
  careerStatus,
  getLatestNoteDate,
  localDateKey,
  todoAction,
  todoAudience,
  todoPriority,
  todoStatus,
  TODO_PRIORITY,
  type DerivedData,
} from "@/lib/memory-atlas-data";

type View = AppView;

/**
 * 収尾入口に出す待办の名前。action の長文（88字）を切ると案件名に見えてしまうので H1 を使う。
 * 会社名の接頭辞は落とさない——H1 は「◯◯ 最終面接準備」、frontmatter は
 * 「株式会社◯◯」と表記が揺れており、前綴照合は当てにならない。
 * 「最終面接準備」まで見えないと、どの待办の話か分からないので、切らずに収まる長さを取る。
 */
function staleTitle(note: Note) {
  const title = getTitle(note).replace(/^\d{4}-\d{2}-\d{2}[_\s]*/, "").trim();
  return title.length > 30 ? `${title.slice(0, 29)}…` : title;
}

// 進行中案件の並び順：面接に近いほど上。定数なのでコンポーネントの外に置く。
// 改变实际 DOM 顺序，确保窄屏阅读和键盘顺序一致。
const narrowQuery = "(max-width: 1100px)";
function subscribeLayout(callback: () => void) {
  const query = window.matchMedia(narrowQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
const isNarrowLayout = () => window.matchMedia(narrowQuery).matches;
const serverLayout = () => false;

const currentStageRank: Record<string, number> = { 面接中: 0, 書類通過: 1, 応募済: 2 };

function Overview({
  notes,
  derived,
  today,
  onOpen,
  onView,
  onOpenReview,
  onTodoStatus,
}: {
  notes: Note[];
  derived: DerivedData;
  /** 「今日」は殻が持つ。memo で包まれているので、中で new Date() すると日付を跨いでも凍る。 */
  today: string;
  onOpen: (note: Note) => void;
  onView: (view: View) => void;
  onQuery: (query: string) => void;
  onOpenReview: (key?: string) => void;
  onTodoStatus: (note: Note, status: string, expectedMtime?: number) => Promise<string | null>;
}) {
  const narrow = useSyncExternalStore(subscribeLayout, isNarrowLayout, serverLayout);
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusError, setFocusError] = useState("");
  const jobs = useMemo(() => derived.cases.map(toJobCard), [derived.cases]);
  const reviewPreview = useMemo(() => buildReviewPreview(notes), [notes]);
  // 四组列表原来是裸表达式：外壳任何 state 变化（⌘K・overlay）都会整段重排。
  // 同函数里 jobs/reviewPreview/focusBrief 都已经 useMemo，只有这四组漏了。
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
  // today を渡し、依存にも入れる。入れないと日付を跨いでも focusBrief が昨日の判定のまま
  // 凍り、expires_at をまたいだ待办が hero に居座り続ける——H5 で直したのと同型の穴を
  // stale 机制で作り直すところだった。
  const focusBrief = useMemo(() => buildFocusBrief(notes, today), [notes, today]);
  const primaryFocus = focusBrief.primary;

  const openJobs = useMemo(() => jobs
    .filter((job) => job.status === "未応募")
    .sort((left, right) => compareJobs(left, right, "rating")), [jobs]);
  const topSalary = openJobs
    .map((job) => job.salary.max ?? 0)
    .filter((value) => value > 0)
    .sort((left, right) => right - left)[0];
  // openTodos 的比较器会对 todo 笔记全文扫日期正则（getLatestNoteDate），更不该每次渲染重跑。
  const openTodos = useMemo(() => notes
    .filter(
      (note) =>
        getType(note) === "todo" &&
        todoAudience(note) === "user" &&
        todoStatus(note) !== "完了",
    )
    .sort(
      (left, right) =>
        (TODO_PRIORITY[todoPriority(left)]?.rank ?? 9) - (TODO_PRIORITY[todoPriority(right)]?.rank ?? 9) ||
        getLatestNoteDate(right).localeCompare(getLatestNoteDate(left)),
    ), [notes]);
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
  const upcoming = derived.commitments.filter((event) => event.phase === "upcoming" && event.date <= horizon);
  const actionReviewDoc = reviewPreview.actionDoc;
  const primaryTodoStatus = primaryFocus?.source === "todo" ? todoStatus(primaryFocus.note) : "";
  const runPrimaryAction = async () => {
    if (!primaryFocus) return;
    if (primaryFocus.source !== "todo") {
      onOpen(primaryFocus.note);
      return;
    }
    setFocusBusy(true);
    setFocusError("");
    const error = await onTodoStatus(
      primaryFocus.note,
      primaryTodoStatus === "進行中" ? "完了" : "進行中",
      primaryFocus.note.stat.mtime,
    );
    if (error) setFocusError(error);
    setFocusBusy(false);
  };
  const holdPrimaryAction = async () => {
    if (!primaryFocus || primaryFocus.source !== "todo") return;
    setFocusBusy(true);
    setFocusError("");
    const error = await onTodoStatus(primaryFocus.note, "保留", primaryFocus.note.stat.mtime);
    if (error) setFocusError(error);
    setFocusBusy(false);
  };

  const todosPanel = (
    <article className="panel todo-preview-panel" key="todos" data-overview-panel="todos">
      <PanelHeading title="行动清单" action={`全部 ${openTodos.length} 项`} onAction={() => onView("todo")} />
      <div className="todo-preview-list">
        {openTodos.length === 0 ? <p className="panel-empty">当前没有需要推进的行动。</p> : openTodos.slice(0, 5).map((note) => (
          <button key={note.path} onClick={() => onOpen(note)}>
            <span className={`todo-pri pri-${todoPriority(note)}`}>{TODO_PRIORITY[todoPriority(note)]?.label ?? todoPriority(note)}</span>
            <span className="todo-preview-body">
              <strong>{todoAction(note)}</strong>
              <small>{getString(note.frontmatter.category)}</small>
            </span>
            <span className={`todo-status st-${todoStatus(note)}`}>{todoStatus(note)}</span>
          </button>
        ))}
      </div>
    </article>
  );
  const casesPanel = (currentCases.length > 0 || recentChanges.length > 0) ? (
    <article className="panel pipeline-panel" key="cases" data-overview-panel="cases">
      <PanelHeading title="进行中案件" action="查看选考" onAction={() => onView("analytics")} />
      <div className="pipeline-list" aria-label="当前进行中的求职记录">
        {currentCases.slice(0, 6).map((job) => {
          const status = careerStatus(job.status);
          const date = job.statusUpdated || job.date || getLatestNoteDate(job.note);
          return (
            <button key={job.path} onClick={() => onOpen(job.note)}>
              <span className={`pipeline-status status-${status.tone}`}>{status.label}</span>
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
              return <button key={job.path} onClick={() => onOpen(job.note)}>
                <span className={`pipeline-status status-${status.tone}`}>{status.label}</span>
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
          <button key={job.path} onClick={() => onOpen(job.note)}>
            <span className={`jobs-preview-rating rating-${job.rating}`}>{job.rating}</span>
            <span className="jobs-preview-body"><strong>{job.company}</strong><small>{job.position || job.location}</small></span>
            <span className="jobs-preview-salary">{job.salary.max ? `${job.salary.max}万` : ""}</span>
          </button>
        ))}
      </div>
    </article>
  ) : null;
  const schedulePanel = upcoming.length > 0 ? (
    <article className="panel overview-schedule" key="schedule" data-overview-panel="schedule">
      <PanelHeading title="近期安排" action="打开日历" onAction={() => onView("calendar")} />
      <p className="overview-panel-meta">未来 7 天 · {upcoming.length} 项</p>
      <div className="overview-schedule-list">
        {upcoming.slice(0, 5).map((event) => (
          <button className={`kind-${event.kind}`} key={event.id} onClick={() => onOpen(event.note)}>
            <span><time dateTime={event.date}>{focusDateLabel(event.date)}{event.time && ` ${event.time}`}</time><small>{event.label}</small></span>
            <strong>{event.company}</strong>
          </button>
        ))}
      </div>
    </article>
  ) : null;
  const waitingPanel = focusBrief.waiting.length > 0 ? (
    <article className="panel overview-waiting" key="waiting" data-overview-panel="waiting">
      <PanelHeading title="等待回复" action={`全部 ${focusBrief.waiting.length} 项`} onAction={() => onView("analytics")} />
      <div className="overview-waiting-list">
        {focusBrief.waiting.slice(0, 3).map((item) => (
          <button key={item.note.path} onClick={() => onOpen(item.note)}>
            <strong>{item.company || item.waitingFor}</strong>
            <span>{item.label}</span>
            {item.followUpAt && <small>{focusDateLabel(item.followUpAt)}后未回复则跟进</small>}
          </button>
        ))}
      </div>
    </article>
  ) : null;
  const reviewPanel = reviewPreview.pendingDecisions > 0 || reviewPreview.readyCount > 0 ? (
    <article className="panel overview-review" key="review" data-overview-panel="review">
      <PanelHeading title="复盘提醒" action="全部复盘" onAction={() => onOpenReview()} />
      <p className="overview-review-counts">
        {reviewPreview.pendingDecisions > 0 && <span><strong>{reviewPreview.pendingDecisions}</strong> 个待裁定</span>}
        {reviewPreview.readyCount > 0 && <span><strong>{reviewPreview.readyCount}</strong> 场可生成复盘</span>}
      </p>
      <button className="overview-review-action" onClick={() => onOpenReview(actionReviewDoc?.key)}>
        {actionReviewDoc?.pendingDecisions ? "继续裁定" : "打开复盘"}<span aria-hidden="true">→</span>
      </button>
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
  const secondaryPanels = [schedulePanel, waitingPanel, reviewPanel, practicePanel].filter(Boolean);

  return (
    <div className="overview-view">
      <section className="overview-current" aria-label="当前行动">
        <div className="overview-current-heading"><span>当前行动</span><time dateTime={today}>{formatDate(today)}</time></div>
        <div className="overview-current-body">
          <div className="overview-current-copy">
            <h1>{primaryFocus?.action ?? "当前没有待执行的重点行动"}</h1>
            {primaryFocus && <div className="overview-current-meta">
              <span>{primaryFocus.context}</span><span>{primaryFocus.reason}</span><b>{primaryFocus.status}</b>
            </div>}
            {primaryFocus?.detail && <p>{primaryFocus.detail}</p>}
          </div>
          <div className="overview-current-actions">
            {primaryFocus && <button className="primary-action" onClick={() => void runPrimaryAction()} disabled={focusBusy}>
              {focusBusy ? "写入中…" : primaryFocus.source === "todo" ? primaryTodoStatus === "進行中" ? "完成这件事" : "开始这件事" : primaryFocus.cta}<span aria-hidden="true">→</span>
            </button>}
            {primaryFocus && <button onClick={() => onOpen(primaryFocus.note)}>查看背景</button>}
            {primaryFocus?.source === "todo" && <button onClick={() => void holdPrimaryAction()} disabled={focusBusy}>保留</button>}
            <button onClick={() => onView("todo")}>全部行动</button>
          </div>
        </div>
        {focusError && <div className="inline-write-error" role="alert">{focusError}</div>}
        {focusBrief.stale.length > 0 && (
          // 失効した待办は催促しない。静かな一行で「収尾」を促すだけ。
          // 🔴 文言は必ず「待办を閉じる話」と読めること——最初は「事件已过去」と
          // だけ書いて、本人に「案件が終わったのか？」と誤読された。案件は
          // 「等待对方」側で生きている。理由（日付が過ぎた／案件が終わった）も
          // 言い分けないと、同じ一行が両方の意味に読める。
          <button type="button" className="overview-stale-note" onClick={() => onOpen(focusBrief.stale[0].note)}>
            {focusBrief.stale.length === 1 ? (
              <>
                待办「{staleTitle(focusBrief.stale[0].note)}」
                {focusBrief.stale[0].staleReason === "case-closed"
                  ? "所属的案件已结束，可以关掉"
                  : "的日子已经过了，可以关掉"}
              </>
            ) : (
              `${focusBrief.stale.length} 件待办已经不用做了，逐一关掉`
            )}
            <span aria-hidden="true">→</span>
          </button>
        )}
        <div className="overview-current-stats">
          <Stat value={openTodos.length} label="件待办" />
          <Stat value={currentCases.length} label="个进行中案件" />
          <Stat value={openJobs.length} label="条待应募岗位" />
          <Stat value={reviewPreview.pendingDecisions} label="个复盘点待裁定" />
        </div>
      </section>
      {narrow ? (
        <div className="overview-stack overview-mobile-stack">
          {schedulePanel}{todosPanel}{waitingPanel}{casesPanel}{jobsPanel}{reviewPanel}{practicePanel}
        </div>
      ) : (
        <div className={`overview-columns${secondaryPanels.length ? "" : " is-single"}`}>
          <div className="overview-stack overview-primary-stack">{todosPanel}{casesPanel}{jobsPanel}</div>
          {secondaryPanels.length > 0 && <div className="overview-stack overview-secondary-stack">{secondaryPanels}</div>}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div data-zero={value === 0}><strong>{value}</strong><span>{label}</span></div>;
}

function PanelHeading({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return <div className="panel-heading"><h2>{title}</h2><button onClick={onAction}>{action} <span aria-hidden="true">↗</span></button></div>;
}

// 外壳的 UI state 变化时不重绘首页。
export default memo(Overview);
