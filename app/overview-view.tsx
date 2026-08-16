"use client";

import { Fragment, useMemo, type CSSProperties } from "react";
import { type AppView } from "./app-route";
import { buildFocusBrief, focusDateLabel } from "@/lib/focus-action";
import { compareJobs, toJobCard } from "@/lib/jobs";
import {
  REVIEW_DIMENSION_META,
  type ReviewDimensionKey,
} from "@/lib/review-deep";
import { formatDate, getString, getType, type Note } from "@/lib/notes";
import {
  ACTIVE_JOB_STATUSES,
  buildReviewPreview,
  careerStatus,
  getGroup,
  getLatestNoteDate,
  GROUPS,
  localDateKey,
  todoAction,
  todoAudience,
  todoPriority,
  todoStatus,
  TODO_PRIORITY,
  type DerivedData,
} from "@/lib/memory-atlas-data";

type View = AppView;

export default function Overview({
  notes,
  derived,
  onOpen,
  onView,
  onQuery,
  onOpenReview,
}: {
  notes: Note[];
  derived: DerivedData;
  onOpen: (note: Note) => void;
  onView: (view: View) => void;
  onQuery: (query: string) => void;
  onOpenReview: (key?: string) => void;
}) {
  const jobs = useMemo(() => derived.cases.map(toJobCard), [derived.cases]);
  const reviewPreview = useMemo(() => buildReviewPreview(notes), [notes]);
  const currentStageRank: Record<string, number> = { 面接中: 0, 書類通過: 1, 応募済: 2 };
  const currentCases = jobs
    .filter((job) => ACTIVE_JOB_STATUSES.has(job.status))
    .sort(
      (left, right) =>
        (currentStageRank[left.status] ?? 9) - (currentStageRank[right.status] ?? 9) ||
        right.statusUpdated.localeCompare(left.statusUpdated),
    );
  const recentChanges = jobs
    .filter((job) => !ACTIVE_JOB_STATUSES.has(job.status) && job.status !== "未応募")
    .slice(0, 3);
  const focusBrief = useMemo(() => buildFocusBrief(notes), [notes]);
  const primaryFocus = focusBrief.primary;
  const waitingFocus = focusBrief.waiting[0] ?? null;

  const openJobs = jobs
    .filter((job) => job.status === "未応募")
    .sort((left, right) => compareJobs(left, right, "rating"));
  const topSalary = openJobs
    .map((job) => job.salary.max ?? 0)
    .filter((value) => value > 0)
    .sort((left, right) => right - left)[0];
  const openTodos = notes
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
    );
  const upcoming = derived.calendarEvents.filter((event) => event.phase === "upcoming");
  const scoreDoc = reviewPreview.scoreDoc;
  const actionReviewDoc = reviewPreview.actionDoc;
  const score = scoreDoc?.deepReview ? Math.round(scoreDoc.deepReview.overallScore) : null;
  const dimensionKeys = Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[];

  return (
    <div className="overview-view">
      <section className="memory-hero feature-shell">
        <div className="eyebrow"><span /> TODAY&apos;S BRIEF · {formatDate(localDateKey())}</div>
        <div className="hero-layout">
          <div className="hero-primary">
            <div className="hero-primary-topline">
              <span>现在先完成这一件事</span>
              {primaryFocus && <small>{primaryFocus.context}</small>}
            </div>
            <h1>{primaryFocus?.action ?? "当前没有可执行的重点行动"}</h1>
            {primaryFocus ? (
              <>
                <div className="hero-primary-reason">
                  <span>{primaryFocus.reason}</span>
                  <i>{primaryFocus.status}</i>
                </div>
                <p>
                  {primaryFocus.detail ||
                    "这项行动来自未完成待办；完整背景和执行清单保留在 Vault 原文中。"}
                </p>
              </>
            ) : (
              <p>外部等待不会冒充成你的行动。可以检查行动清单，或继续观察正在推进的案件。</p>
            )}
            <div className="hero-primary-actions">
              <button
                className="primary-action"
                onClick={() => primaryFocus && onOpen(primaryFocus.note)}
                disabled={!primaryFocus}
              >
                {primaryFocus?.cta ?? "查看待办"} <span>→</span>
              </button>
              <button className="hero-secondary-action" onClick={() => onView("todo")}>
                查看全部行动
              </button>
            </div>
          </div>

          <aside className="hero-watch">
            <div className="hero-watch-head">
              <span>等待对方</span>
              <small>{focusBrief.waiting.length} 件观察中</small>
            </div>
            {waitingFocus ? (
              <button type="button" onClick={() => onOpen(waitingFocus.note)}>
                <small>{waitingFocus.company || waitingFocus.waitingFor}</small>
                <strong>{waitingFocus.label}</strong>
                <span>
                  {waitingFocus.followUpAt
                    ? `${focusDateLabel(waitingFocus.followUpAt)}后未回复则跟进`
                    : `${waitingFocus.waitingFor}行动中`}
                </span>
              </button>
            ) : (
              <div className="hero-watch-empty">
                <strong>没有外部回复需要盯住</strong>
                <span>等待事项会与本人可执行行动分开展示。</span>
              </div>
            )}
            <footer>
              <span>{currentCases.length} 个应募案件进行中</span>
              {focusBrief.waiting.length > 1 && <span>另有 {focusBrief.waiting.length - 1} 件等待</span>}
            </footer>
          </aside>
        </div>
        <div className="hero-stats">
          <Stat value={openJobs.length} label="条待应募岗位" />
          <Stat value={currentCases.length} label="个案件进行中" />
          <Stat value={openTodos.length} label="件待办未完成" />
          <Stat value={reviewPreview.pendingDecisions} label="个复盘点待裁定" />
        </div>
      </section>

      <section className="overview-grid">
        <article className="panel review-preview-panel">
          <PanelHeading
            kicker="ANSWER QUALITY"
            title="面试复盘进度"
            action="全部复盘"
            onAction={() => onOpenReview()}
          />
          {reviewPreview.docs.length === 0 ? (
            <p className="panel-empty">还没有可以复盘的整理稿。</p>
          ) : (
            <>
              <div className="review-preview-summary">
                <div className={`review-preview-score ${score === null ? "empty" : score >= 80 ? "high" : score >= 65 ? "mid" : "low"}`}>
                  <strong>{score ?? "—"}</strong>
                  <span>{score === null ? "暂无评分" : "/ 100"}</span>
                </div>
                <div className="review-preview-copy">
                  <small>最近一场已评分</small>
                  <strong>{scoreDoc?.company ?? "等待首份深度复盘"}</strong>
                  <span>{scoreDoc ? `${formatDate(scoreDoc.date)} · ${scoreDoc.round}` : "完成证据裁定后即可生成"}</span>
                  <p>{scoreDoc?.deepReview?.weaknesses[0] ?? "先完成待裁定点，再进入回答质量分析。"}</p>
                </div>
              </div>
              {scoreDoc?.deepReview?.dimensions && (
                <div className="review-preview-dimensions" aria-label="最近一场面试五维评分">
                  {dimensionKeys.map((key) => {
                    const value = Math.round(scoreDoc.deepReview?.dimensions?.[key].score ?? 0);
                    return (
                      <div key={key}>
                        <span>{REVIEW_DIMENSION_META[key].label}</span>
                        <strong>{value}</strong>
                        <i><b style={{ width: `${value}%` }} /></i>
                      </div>
                    );
                  })}
                </div>
              )}
              <dl className="review-preview-stats">
                <div><dt>已深度复盘</dt><dd>{reviewPreview.reviewedCount} / {reviewPreview.docs.length}</dd></div>
                <div><dt>待裁定</dt><dd>{reviewPreview.pendingDecisions}</dd></div>
                <div><dt>可以生成</dt><dd>{reviewPreview.readyCount}</dd></div>
              </dl>
              <button
                className="review-preview-action"
                type="button"
                onClick={() => onOpenReview(actionReviewDoc?.key)}
                disabled={!actionReviewDoc}
              >
                <span>
                  <small>下一步</small>
                  <strong>
                    {actionReviewDoc?.pendingDecisions
                      ? `继续裁定 · ${actionReviewDoc.company}`
                      : actionReviewDoc && !actionReviewDoc.deepReview
                        ? `生成深度复盘 · ${actionReviewDoc.company}`
                        : `查看最近复盘 · ${actionReviewDoc?.company ?? ""}`}
                  </strong>
                </span>
                <b>→</b>
              </button>
            </>
          )}
        </article>

        <article className="panel todo-preview-panel">
          <PanelHeading
            kicker="NEXT ACTIONS"
            title="行动清单"
            action="全部行动"
            onAction={() => onView("todo")}
          />
          <div className="todo-preview-list">
            {openTodos.length === 0 ? (
              <p className="panel-empty">当前没有需要推进的行动。</p>
            ) : (
              openTodos.slice(0, 5).map((note) => (
                <button key={note.path} onClick={() => onOpen(note)}>
                  <span className={`todo-pri pri-${todoPriority(note)}`}>
                    {TODO_PRIORITY[todoPriority(note)]?.label ?? todoPriority(note)}
                  </span>
                  <span className="todo-preview-body">
                    <strong>{todoAction(note)}</strong>
                    <small>{getString(note.frontmatter.category)}</small>
                  </span>
                  <span className={`todo-status st-${todoStatus(note)}`}>{todoStatus(note)}</span>
                </button>
              ))
            )}
          </div>
        </article>

        <article className="panel pipeline-panel wide">
          <PanelHeading
            kicker="CAREER PIPELINE"
            title="求职进行时"
            action="全部案件"
            onAction={() => onView("jobs")}
          />
          <div className="pipeline-split">
            <div className="pipeline-list" aria-label="当前进行中的求职记录">
              {currentCases.slice(0, 6).map((job) => {
                const statusDisplay = careerStatus(job.status);
                const latestDate = job.statusUpdated || job.date || getLatestNoteDate(job.note);
                const nextAction = job.nextAction || job.position || "案件详情";
                return (
                  <button key={job.path} onClick={() => onOpen(job.note)}>
                    <span
                      className={`pipeline-status status-${statusDisplay.tone}`}
                      title={job.status}
                    >
                      {statusDisplay.label}
                    </span>
                    <span className="pipeline-company">
                      <span className="pipeline-company-head">
                        <strong>{job.company}</strong>
                        <time dateTime={latestDate}>{formatDate(latestDate)}</time>
                      </span>
                      <small title={nextAction}>{nextAction}</small>
                    </span>
                    <span className="pipeline-arrow">↗</span>
                  </button>
                );
              })}
              {currentCases.length === 0 && <p className="panel-empty">目前没有进行中的案件。</p>}
            </div>
            <aside className="pipeline-schedule">
              <div className="pipeline-aside-heading">
                <span className="panel-kicker">接下来的面试</span>
                <button onClick={() => onView("calendar")}>打开日历 ↗</button>
              </div>
              <div className="pipeline-upcoming">
                {upcoming.length === 0 ? (
                  <p className="panel-empty">暂无已排期的面试。日历里出现新日程后会自动出现在这里。</p>
                ) : (
                  upcoming.slice(0, 2).map((event) => (
                    <button key={event.id} onClick={() => onOpen(event.note)}>
                      <time dateTime={event.date}>
                        {formatDate(event.date)}{event.time && ` ${event.time}`}
                      </time>
                      <strong>{event.company}</strong>
                      <small>{event.label}</small>
                    </button>
                  ))
                )}
              </div>
              <div className="pipeline-recent">
                <span className="panel-kicker">最近变化</span>
                {recentChanges.map((job) => {
                  const statusDisplay = careerStatus(job.status);
                  const latestDate = job.statusUpdated || job.date || getLatestNoteDate(job.note);
                  return (
                    <button key={job.path} onClick={() => onOpen(job.note)}>
                      <span className={`pipeline-status status-${statusDisplay.tone}`}>{statusDisplay.label}</span>
                      <strong>{job.company}</strong>
                      <time dateTime={latestDate}>{formatDate(latestDate)}</time>
                    </button>
                  );
                })}
              </div>
            </aside>
          </div>
        </article>

        <article className="panel jobs-preview-panel">
          <PanelHeading
            kicker="AI JOB MATCH"
            title="下一个投哪家"
            action="打开筛选台"
            onAction={() => onView("jobs")}
          />
          <div className="jobs-preview-stats">
            <div><strong>{openJobs.length}</strong><span>条未应募</span></div>
            <div><strong>{openJobs.filter((job) => job.rating >= 8).length}</strong><span>8 点以上</span></div>
            <div><strong>{topSalary ? `${topSalary}万` : "—"}</strong><span>未应募最高</span></div>
          </div>
          <div className="jobs-preview-list">
            {openJobs.length === 0 ? (
              <p className="panel-empty">没有未应募的推荐岗位。</p>
            ) : (
              openJobs.slice(0, 4).map((job) => (
                <button key={job.path} onClick={() => onOpen(job.note)}>
                  <span className={`jobs-preview-rating rating-${job.rating}`}>{job.rating}</span>
                  <span className="jobs-preview-body">
                    <strong>{job.company}</strong>
                    <small>{job.position || job.location}</small>
                  </span>
                  <span className="jobs-preview-salary">{job.salary.max ? `${job.salary.max}万` : ""}</span>
                </button>
              ))
            )}
          </div>
        </article>

        <article className="panel learning-panel">
          <PanelHeading
            kicker="LEARNING LOOP"
            title="日语纠错闭环"
            action="打开词典"
            onAction={() => onQuery("folder:30_日本語学習")}
          />
          <div className="learning-visual">
            <div className="learning-ring" style={{ "--progress": `${Math.min(100, (derived.promoted / Math.max(1, derived.totalErrors)) * 100)}%` } as CSSProperties}>
              <div><strong>{derived.promoted}</strong><span>已晋升</span></div>
            </div>
            <div className="learning-copy">
              <p><strong>{derived.totalErrors}</strong> 条逐字稿错误等待复习</p>
              <p><strong>{derived.highPriorityErrors}</strong> 条被标为高优先级</p>
              <button onClick={() => onQuery("重要度:高")}>只看高优先 <span>→</span></button>
            </div>
          </div>
          <div className="learning-flow" aria-label="日语知识晋升流程">
            <span>逐字稿</span><b>→</b><span>误用辞典</span><b>→</b><span>人工确认</span><b>→</b><span>矫正定稿</span>
          </div>
        </article>

        <article className="panel memory-health">
          <PanelHeading
            kicker="MEMORY HEALTH"
            title="记忆健康度"
            action="查看全部"
            onAction={() => onView("library")}
          />
          <div className="health-score-row">
            <div className="health-score">
              <strong>{Math.max(0, derived.selfNotes - derived.incompleteSelf)}</strong>
              <span>/ {derived.selfNotes}</span>
            </div>
            <p>“关于我”权威文档已完成</p>
          </div>
          <div className="health-bars">
            <HealthBar label="证据字段完整度" value={derived.evidenceCompleteness} tone="green" />
            <HealthBar
              label="个人事实完整度"
              value={derived.selfNotes ? ((derived.selfNotes - derived.incompleteSelf) / derived.selfNotes) * 100 : 0}
              tone="orange"
            />
            <HealthBar
              label="关系连接度"
              value={notes.length ? ((notes.length - derived.orphanCount) / notes.length) * 100 : 0}
              tone="violet"
            />
          </div>
          <button className="health-alert" onClick={() => onQuery("folder:10_关于我 迁移时") }>
            <span>!</span>
            <div>
              <strong>{derived.incompleteSelf} 份权威文档仍有待补字段</strong>
              <small>技术栈、STAR、硬性约束与日语定稿应优先人工确认</small>
            </div>
            <b>→</b>
          </button>
        </article>

        <article className="panel graph-preview-panel wide">
          <div className="graph-preview-copy">
            <span className="panel-kicker">KNOWLEDGE GRAPH</span>
            <h2>关系比文件夹<br />更接近思考本身。</h2>
            <p>从公司、复盘、语言错误到 AI 结论，沿着双链找回一段判断是如何形成的。</p>
            <button onClick={() => onView("graph")}>进入关系图 <span>↗</span></button>
          </div>
          <MiniGraph notes={notes} />
        </article>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="stat" data-zero={value === 0}><strong>{value.toString().padStart(2, "0")}</strong><span>{label}</span></div>;
}

function PanelHeading({
  kicker,
  title,
  action,
  onAction,
}: {
  kicker: string;
  title: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="panel-heading">
      <div><span className="panel-kicker">{kicker}</span><h2>{title}</h2></div>
      <button onClick={onAction}>{action} <span>↗</span></button>
    </div>
  );
}

function HealthBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="health-bar-row">
      <div><span>{label}</span><strong>{safeValue}%</strong></div>
      <div className="health-bar"><i className={tone} style={{ width: `${safeValue}%` }} /></div>
    </div>
  );
}

function MiniGraph({ notes }: { notes: Note[] }) {
  const points = useMemo(() => {
    return notes.slice(0, 24).map((note, index) => {
      const angle = index * 2.399;
      const radius = 12 + (index % 6) * 7;
      return {
        x: 50 + Math.cos(angle) * radius,
        y: 50 + Math.sin(angle) * radius * 0.72,
        color: GROUPS[getGroup(note.path)].color,
      };
    });
  }, [notes]);
  return (
    <div className="mini-graph" aria-hidden="true">
      {points.map((point, index) => (
        <Fragment key={index}>
          <i className="mini-edge" style={{ left: "50%", top: "50%", width: `${Math.hypot(point.x - 50, point.y - 50)}%`, transform: `rotate(${Math.atan2(point.y - 50, point.x - 50)}rad)` }} />
          <b style={{ left: `${point.x}%`, top: `${point.y}%`, background: point.color }} />
        </Fragment>
      ))}
      <strong>{notes.length}</strong>
    </div>
  );
}
