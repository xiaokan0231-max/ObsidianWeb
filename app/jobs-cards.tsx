"use client";

import { memo, useCallback, type CSSProperties } from "react";
import {
  elapsedLabel,
  intakeLabel,
  jobIntake,
  rateText,
  rateTone,
  salaryLabel,
  shortDay,
  statusTone,
  VERIFICATION_LABEL,
  type JobCard,
} from "@/lib/jobs";
import { useJobMenu } from "./jobs-copy";
import { clip, COMPARE_LIMIT, FitChip, Highlight, intakeTone } from "./jobs-shared";
import { StatusPicker } from "./jobs-status";
import type { Matcher, StatusWriter } from "./jobs-types";

/*
 * 卡片按路径回调（onDetail(path) 等），父级把同一个稳定函数传给每一张：
 * 每张卡各自包一层闭包的话 memo 就形同虚设，打一个字整列卡片全部重渲染。
 */
export const JobCardView = memo(function JobCardView({
  job,
  matcher,
  today,
  stagger,
  compared,
  compareFull,
  saving,
  onDetail,
  onCompare,
  onStatus,
}: {
  job: JobCard;
  matcher: Matcher;
  today: string;
  /** 前 12 张的入场错峰序号；之后的卡不错峰，免得长列表最后一张要等一秒才出现。 */
  stagger?: number;
  compared: boolean;
  compareFull: boolean;
  saving: boolean;
  onDetail: (path: string) => void;
  onCompare: (path: string) => void;
  onStatus: StatusWriter;
}) {
  const { t, label: menuLabel } = useJobMenu();
  const { path } = job;
  const mtime = job.note.stat.mtime;
  const onChange = useCallback(
    (status: string, note: string, channel?: string) => onStatus(path, status, note, channel, mtime),
    [mtime, onStatus, path],
  );
  const officialLabel = job.officialApplyStatus === "exact" ? t("官网直投") : job.officialApplyStatus === "related" ? t("官网相近职位") : t("官网招聘");
  const intake = intakeTone(jobIntake(job.date, today));
  return (
    <article
      className={`job-card rate-${rateTone(job.rating)}${compared ? " compared" : ""}`}
      style={stagger === undefined ? undefined : { "--stagger": stagger } as CSSProperties}
      onClick={() => onDetail(path)}
    >
      <header className="job-card-head">
        <div className="job-card-id">
          <span
            className={`job-rate-badge rate-${rateTone(job.rating)}`}
            role="img"
            aria-label={job.rated ? t("応募优先度 {score}，满分 10", { score: job.rating }) : t("未採点（求人原文を読んでいない）")}
            title={job.rated ? undefined : t("未採点（求人原文を読んでいない）")}
          >
            {rateText(job)}
          </span>
          <div className="job-card-titles">
            <h2><Highlight text={job.company} matcher={matcher} /></h2>
            {job.position && <p className="job-position"><Highlight text={job.position} matcher={matcher} /></p>}
          </div>
        </div>
        <span className="job-card-marks">
          {job.fit && <FitChip fit={job.fit} />}
          <span className={`job-verify verify-${job.verification}`} title={t("求人原文：{label}", { label: menuLabel(VERIFICATION_LABEL[job.verification]) })}>{menuLabel(VERIFICATION_LABEL[job.verification])}</span>
          {/* 外链收成右上角的印章：底部只留操作，两枚链接不再和状态控件抢一行。 */}
          {job.officialApplyUrl && (
            <a
              className="job-icon-link job-icon-official"
              href={job.officialApplyUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={officialLabel}
              aria-label={`${officialLabel} ↗`}
              onClick={(event) => event.stopPropagation()}
            >
              {t("官")}
            </a>
          )}
          {job.url && job.url !== job.officialApplyUrl && (
            <a
              className="job-icon-link"
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              title="求人票"
              aria-label={t("求人票 ↗")}
              onClick={(event) => event.stopPropagation()}
            >
              {t("票")}
            </a>
          )}
        </span>
      </header>

      <div className="job-salary-row">
        {/* 解析不出年収区间时退回笔记原文，字号跟着降下来，免得一行长文顶掉卡片的层级。 */}
        <span className={`job-salary-figure${job.salary.min === null ? " is-text" : ""}`}>{salaryLabel(job)}</span>
      </div>

      {/* 事实只是上下文，用「·」连成一行；只有「今天入库」与「可远程」两项值得上色成标签。
          入库日は常に出す：欠けている（＝「入库日不明」）ことも読み取れる情報なので黙って消さない。 */}
      <div className="job-facts">
        <span
          className={`job-intake tone-${intake}`}
          title={job.date ? t("入库日 {date}", { date: job.date }) : t("笔记 frontmatter 里没有 date")}
        >
          {intake === "new" ? "NEW" : `入库 ${intakeLabel(job.date, today)}`}
        </span>
        {/* 応募日は「投げてから何日たったか」を出すために入库日とは別に見せる。
            入库日で代用すると 7/20 に入って 7/24 に投げた案件が4日ずれる。 */}
        {job.appliedOn && (
          <span className="job-applied" title={t("応募日 {date}", { date: job.appliedOn })}>
            応募 {shortDay(job.appliedOn)}
            <em>{elapsedLabel(job.appliedOn, today)}</em>
          </span>
        )}
        {job.employment && <span>{job.employment}</span>}
        {job.location && <span><Highlight text={job.location} matcher={matcher} /></span>}
        {job.remote && <span className="job-remote">{t("リモート可")}</span>}
      </div>

      {job.stack.length > 0 && (
        <div className="job-stack">
          {job.stack.slice(0, 7).map((tag) => <span key={tag}><Highlight text={tag} matcher={matcher} /></span>)}
          {job.stack.length > 7 && <span className="job-stack-more">+{job.stack.length - 7}</span>}
        </div>
      )}

      {job.reason && (
        <div className="job-block">
          <span className="job-block-label">推荐理由</span>
          <p><Highlight text={clip(job.reason, 92)} matcher={matcher} /></p>
        </div>
      )}

      <footer className="job-card-foot" onClick={(event) => event.stopPropagation()}>
        <StatusPicker
          value={job.status}
          note={job.statusNote}
          channel={job.channel}
          sourceGuess={job.sourceGroup}
          today={today}
          saving={saving}
          expectedMtime={mtime}
          onChange={onChange}
        />
        <button
          type="button"
          className={compared ? "job-compare-toggle active" : "job-compare-toggle"}
          aria-pressed={compared}
          disabled={!compared && compareFull}
          title={!compared && compareFull ? t("最多同时对比 {count} 个岗位", { count: COMPARE_LIMIT }) : t("加入对比")}
          onClick={() => onCompare(path)}
        >
          {compared ? t("已加入对比") : t("对比")}
        </button>
        <button type="button" className="job-detail" onClick={() => onDetail(path)}>{t("详情")}</button>
      </footer>
    </article>
  );
});

/** 列表视图：一行一个岗位，密度最高，用来快速扫全量结果。 */
export function JobListView({
  jobs,
  matcher,
  today,
  onDetail,
}: {
  jobs: JobCard[];
  matcher: Matcher;
  today: string;
  onDetail: (path: string) => void;
}) {
  const { t } = useJobMenu();
  return (
    <div className="job-list">
      <div className="job-list-head" aria-hidden="true">
        <span>{t("公司 / 职位")}</span>
        <span>{t("匹配")}</span>
        <span>{t("年収")}</span>
        <span>{t("技術スタック")}</span>
        <span>{t("入库")}</span>
        <span>{t("状态")}</span>
        <span>{t("核对")}</span>
      </div>
      {jobs.map((job) => <JobListRow key={job.path} job={job} matcher={matcher} today={today} onDetail={onDetail} />)}
    </div>
  );
}

const JobListRow = memo(function JobListRow({
  job,
  matcher,
  today,
  onDetail,
}: {
  job: JobCard;
  matcher: Matcher;
  today: string;
  onDetail: (path: string) => void;
}) {
  const { t, label: menuLabel } = useJobMenu();
  return (
    <button type="button" className="job-list-row" onClick={() => onDetail(job.path)}>
      <span className="job-list-title">
        <strong><Highlight text={job.company} matcher={matcher} /></strong>
        <small><Highlight text={job.position || "—"} matcher={matcher} /></small>
      </span>
      <span className={`job-list-rate rate-${rateTone(job.rating)}`} title={job.rated ? undefined : t("未採点（求人原文を読んでいない）")}>{rateText(job)}</span>
      <span className="job-list-salary">{salaryLabel(job)}</span>
      <span className="job-list-stack">
        {job.stack.map((tag) => <i key={tag}>{tag}</i>)}
      </span>
      {/* 「入库时间」で並べ替えても列がないと順序の根拠が読めないので、リストにも出す。 */}
      <span
        className={`job-list-intake tone-${intakeTone(jobIntake(job.date, today))}`}
        title={job.date ? t("入库日 {date}", { date: job.date }) : t("笔记 frontmatter 里没有 date")}
      >
        {intakeLabel(job.date, today)}
      </span>
      <span className={`job-status-pill tone-${statusTone(job.status)}`} title={job.status}>{job.status}</span>
      <span className={`job-verify verify-${job.verification}`} title={t("求人原文：{label}", { label: menuLabel(VERIFICATION_LABEL[job.verification]) })}>{menuLabel(VERIFICATION_LABEL[job.verification])}</span>
    </button>
  );
});
