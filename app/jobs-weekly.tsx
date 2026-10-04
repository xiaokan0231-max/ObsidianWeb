"use client";

import { useCallback, useMemo } from "react";
import {
  normalizeDay,
  SELECTION_STATUSES,
  shortDay,
  statusTone,
  type JobCard,
} from "@/lib/jobs";
import { getString, getTitle, getType, noteBasename, type Note } from "@/lib/notes";
import { OPEN_NOTE_LABEL } from "@/lib/ui-labels";
import MarkdownDocument from "./markdown-document";
import { useJobMenu } from "./jobs-copy";

function pad(value: number) {
  return `${value}`.padStart(2, "0");
}

function isoDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 以周一为起点算出第 offset 周（0 = today 所在周）的闭区间，用于周复盘。 */
function weekBounds(today: string, offset: number) {
  const [year, month, day] = today.split("-").map(Number);
  const base = new Date(year, month - 1, day);
  const mondayIndex = (base.getDay() + 6) % 7;
  const start = new Date(year, month - 1, day - mondayIndex + offset * 7);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return {
    from: isoDate(start),
    to: isoDate(end),
    label: `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`,
  };
}

function dayInRange(raw: string, from: string, to: string) {
  const day = normalizeDay(raw);
  return day !== null && day >= from && day <= to;
}

const dayLabel = (raw: string) => shortDay(raw, "—");

/**
 * 周复盘事件锚定在最近一次状态变化日（status_updated）。
 * `date` 是推薦入库日，拿它当事件日会把 7/21 投的岗位画到 7/20（入库那天）。
 * 未応募的笔记没有 status_updated，此时入库日就是唯一事件（AI 新規推薦）。
 */
function eventDay(job: JobCard) {
  return job.statusUpdated || job.date;
}

/** 时间线上的事件文案由状态推导 —— 状态与日期是笔记里的证据，不是 AI 的假设。 */
function eventLabel(job: JobCard) {
  switch (job.status) {
    case "未応募": return `机会入库（応募优先度 ${job.rating}）`;
    case "応募済": return "応募完了";
    case "書類通過": return "書類選考通過";
    case "面接中": return "面接を実施";
    case "内定": return "内定";
    case "不採用": return "不採用";
    default: return job.status;
  }
}

/**
 * 周复盘要的派生数据：显示周的区间、本周事件、KPI、下周重点与本周的复盘笔记。
 * 依赖与原来写在视图里时相同（today・weekOffset・jobs・notes），跨天与翻周都会重算。
 */
export function useJobWeek({
  jobs,
  notes,
  today,
  weekOffset,
  onOpen,
}: {
  jobs: JobCard[];
  notes: Note[];
  today: string;
  weekOffset: number;
  onOpen: (note: Note) => void;
}) {
  const week = useMemo(() => weekBounds(today, weekOffset), [today, weekOffset]);

  const weekEvents = useMemo(() => {
    return jobs
      .filter((job) => dayInRange(eventDay(job), week.from, week.to))
      .sort(
        (left, right) =>
          eventDay(right).localeCompare(eventDay(left)) ||
          left.company.localeCompare(right.company, "ja"),
      );
  }, [jobs, week]);

  const weekKpis = useMemo(() => {
    const count = (predicate: (job: JobCard) => boolean) => jobs.filter(predicate).length;
    return [
      {
        label: "本周应募 / 进展",
        tone: "green",
        // 不採用也是这一周真实发生的选考动态（应募次日就书类落ち的会只剩这一条记录），
        // 所以口径是「状态在本周变化到未応募以外」，而不是只数还活着的。
        value: count((job) => job.status !== "未応募" && dayInRange(eventDay(job), week.from, week.to)),
      },
      { label: "面试进行中", tone: "orange", value: count((job) => job.status === "面接中") },
      { label: "选考推进中", tone: "ink", value: count((job) => SELECTION_STATUSES.includes(job.status)) },
      { label: "待投递（8+）", tone: "gold", value: count((job) => job.status === "未応募" && job.rating >= 8) },
    ];
  }, [jobs, week]);

  const nextFocus = useMemo(() => {
    const items: { path: string; company: string; action: string }[] = [];
    const push = (job: JobCard, action: string) => {
      items.push({ path: job.path, company: job.company, action: job.caution ? `${action}${job.caution}` : action });
    };
    jobs.forEach((job) => {
      if (job.status === "面接中") push(job, "面接準備・逆質問の整理。");
      else if (job.status === "書類通過") push(job, "面接日程を調整。");
    });
    jobs
      .filter((job) => job.status === "未応募" && job.rating >= 9)
      .forEach((job) => push(job, "今週中に優先応募。"));
    // 7〜8 分的残弹不该沉默地躺在池子里：要么投掉要么明确弃掉，波次才能宣告投げ切り。
    jobs
      .filter((job) => job.status === "未応募" && job.rating >= 7 && job.rating < 9)
      .forEach((job) => push(job, "応募するか見送るか判断。"));
    return items.slice(0, 4);
  }, [jobs]);

  /** 本周的叙事复盘笔记（80_AI分析/…週次復盤…，type: ai-report）。只认日期落在显示周内的那份。 */
  const weekReview = useMemo(() => {
    const candidates = notes.filter((note) => {
      if (getType(note) !== "ai-report") return false;
      if (!/週次復盤|周复盘|週復盤/.test(noteBasename(note.path))) return false;
      const day = getString(note.frontmatter.date) || noteBasename(note.path);
      return dayInRange(day, week.from, week.to);
    });
    // 同一周写了多份时取文件名最新的一份（文件名以日期开头，字典序即时间序）。
    return candidates.sort((left, right) => right.path.localeCompare(left.path))[0] ?? null;
  }, [notes, week]);

  /** 复盘笔记里的 [[wiki链接]]：能在库里找到目标就打开，找不到就保持纯文本。 */
  const openWikiLink = useCallback(
    (target: string) => {
      const base = target.split("|")[0].split("#")[0].trim();
      const note =
        notes.find((item) => noteBasename(item.path) === base) ??
        notes.find((item) => item.path.endsWith(`/${base}.md`));
      if (note) onOpen(note);
    },
    [notes, onOpen],
  );

  return { week, weekEvents, weekKpis, nextFocus, weekReview, openWikiLink };
}

/** 周复盘：证据层口径来自笔记的 `status` + `status_updated`（缺则退回 `date`），不掺 AI 打分；叙事层显示本周的週次復盤笔记。 */
export function JobWeeklyView({
  offset,
  range,
  kpis,
  events,
  focus,
  review,
  onShift,
  onDetail,
  onOpenReview,
  onWiki,
}: {
  offset: number;
  range: string;
  kpis: { label: string; tone: string; value: number }[];
  events: JobCard[];
  focus: { path: string; company: string; action: string }[];
  review: Note | null;
  onShift: (delta: number) => void;
  onDetail: (path: string) => void;
  onOpenReview: (note: Note) => void;
  onWiki: (target: string) => void;
}) {
  const { t, label: menuLabel } = useJobMenu();
  const title = offset === 0 ? t("本周复盘") : offset < 0 ? t("{count} 周前", { count: -offset }) : t("{count} 周后", { count: offset });
  return (
    <div className="job-week">
      <div className="job-week-nav">
        <button type="button" onClick={() => onShift(-1)} aria-label={t("上一周")}>‹</button>
        <div>
          <strong>{title}</strong>
          <span>{range}</span>
        </div>
        <button type="button" onClick={() => onShift(1)} aria-label={t("下一周")}>›</button>
      </div>

      <div className="job-week-kpis">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="job-week-kpi">
            <strong className={`tone-${kpi.tone}`}>{kpi.value}</strong>
            <span>{kpi.label}</span>
          </div>
        ))}
      </div>

      <div className="job-week-split">
        {/* 只有时间线是按周口径的，翻周落空时别把另外三个全量 KPI 和待办也一起藏掉。 */}
        <section className="job-week-panel">
          <span className="job-week-label">本周动态 · TIMELINE</span>
          {events.length === 0 ? (
            <p className="job-week-blank">这一周还没有求职记录。</p>
          ) : (
            <div className="job-week-timeline">
              {events.map((job) => (
                <button key={job.path} type="button" className="job-week-event" onClick={() => onDetail(job.path)}>
                  <time>{dayLabel(eventDay(job))}</time>
                  <span>
                    <i className={`tone-${statusTone(job.status)}`} aria-hidden="true" />
                    <strong>{job.company}</strong>
                    <small>{eventLabel(job)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="job-week-side">
          <section className="job-week-panel">
            <span className="job-week-label">下周重点 · NEXT</span>
            <div className="job-week-focus">
              {focus.length === 0 && <p className="panel-empty">现在没有需要跟进的选考。</p>}
              {focus.map((item) => (
                <button key={item.path} type="button" onClick={() => onDetail(item.path)}>
                  <i aria-hidden="true" />
                  <span>
                    <strong>{item.company}</strong>
                    <small>{item.action}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="job-week-note">
            <span>复盘提醒</span>
            <p>本周动态来自笔记的状态与日期字段，属于「证据层」；応募优先度是时间分配判断，不代表录用概率。</p>
          </section>
        </div>
      </div>

      <section className="job-week-panel job-week-review">
        <span className="job-week-label">本周复盘笔记 · REVIEW</span>
        {review ? (
          <>
            <div className="job-week-review-head">
              <strong>{getTitle(review)}</strong>
              <button type="button" className="job-week-review-open" onClick={() => onOpenReview(review)}>
                {menuLabel(OPEN_NOTE_LABEL)}
              </button>
            </div>
            {/* 与原笔记 drawer 同一个渲染器：私有的简版解析器漏掉了代码块・callout・外链，两处读到的不是同一篇。 */}
            <div className="job-week-md">
              <MarkdownDocument content={review.content} onWikiLink={onWiki} />
            </div>
          </>
        ) : (
          <p className="job-week-review-empty">
            这一周还没有叙事复盘。在 <code>80_AI分析/</code> 新建 <code>YYYY-MM-DD_週次復盤_主题.md</code>
            （type: ai-report，date 落在本周），这里就会自动显示。
          </p>
        )}
      </section>
    </div>
  );
}
