"use client";

import { useRef, type ReactNode } from "react";
import {
  HARD_GATE_LABEL,
  JOB_FIT_AXES,
  JOB_FIT_SCORE_LABEL,
  salaryLabel,
  UNRATED_V2_LABEL,
  VERIFICATION_LABEL,
  type JobCard,
} from "@/lib/jobs";
import { RadarChart } from "./radar-chart";
import { useDialogFocus } from "./use-dialog-focus";
import { useJobMenu } from "./jobs-copy";
import { COMPARE_LIMIT, FIT_RADAR_AXES, fitRadarValues } from "./jobs-shared";

const COMPARE_ROWS: { label: string; render: (job: JobCard) => ReactNode }[] = [
  { label: "応募优先度", render: (job) => <strong className="job-compare-rating">{job.rating} / 10</strong> },
  {
    label: "v2 採点",
    render: (job) => job.fit
      ? <><strong className="job-compare-rating">{job.fit.score}</strong> / 100 · Band {job.fit.band} · Gate {HARD_GATE_LABEL[job.fit.hardGate]}</>
      : <span className="job-compare-unrated">{UNRATED_V2_LABEL}</span>,
  },
  // 六軸は行を分けて並べる：合計だけ見ると「B 同士」で差が無いように見える案件が、軸単位では逆転している。
  ...JOB_FIT_AXES.map((key) => ({
    label: `　${JOB_FIT_SCORE_LABEL[key].label}`,
    render: (job: JobCard) => (job.fit ? `${job.fit.scores[key]} / ${JOB_FIT_SCORE_LABEL[key].max}` : "—"),
  })),
  // 年収は構造化値（salary_min/max）優先で自由文を title に残す——古い求人票の文言と採点時の確認値がずれることがある。
  { label: "年収", render: (job) => <span title={job.salaryText || undefined}>{salaryLabel(job)}</span> },
  { label: "勤務地", render: (job) => job.location || "—" },
  { label: "雇用形態", render: (job) => job.employment || "—" },
  { label: "状态", render: (job) => job.status },
  { label: "原文核对", render: (job) => VERIFICATION_LABEL[job.verification] },
  {
    label: "技術スタック",
    render: (job) => <div className="job-stack">{job.stack.map((tag) => <span key={tag}>{tag}</span>)}</div>,
  },
  { label: "推荐理由", render: (job) => job.reason || "—" },
  { label: "注意点", render: (job) => job.caution || "—" },
  {
    label: "主打材料",
    render: (job) => (job.materials.length ? <ul>{job.materials.map((item, index) => <li key={index}>{item}</li>)}</ul> : "—"),
  },
];

/** 第一个岗位是填色的主角，其余只描边；三色取 radar-chart 已有的系列色，不另起一套。 */
const COMPARE_RADAR_TONES = ["primary", "tertiary", "quaternary"] as const;

export function JobCompare({
  jobs,
  onClose,
  onDetail,
}: {
  jobs: JobCard[];
  onClose: () => void;
  onDetail: (path: string) => void;
}) {
  const { t } = useJobMenu();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef);
  const scored = jobs.filter((job) => job.fit);
  return (
    <div
      className="job-compare-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div ref={dialogRef} tabIndex={-1} className="job-compare-panel" role="dialog" aria-modal="true" aria-label={t("岗位并排对比")}>
        <header>
          <h2>{t("并排对比")}</h2>
          <button onClick={onClose} aria-label={t("关闭对比")}>×</button>
        </header>
        <div className="job-compare-scroll">
          {/* 叠在一张雷达上看谁在哪一轴领先；未採点的岗位不画（没有分数就没有形状）。 */}
          {scored.length > 0 && (
            <RadarChart
              className="job-compare-radar"
              axes={FIT_RADAR_AXES}
              series={scored.map((job, index) => ({
                id: job.path,
                label: job.company,
                values: fitRadarValues(job.fit!),
                tone: COMPARE_RADAR_TONES[index],
              }))}
              max={1}
              size={300}
              showValues={false}
              title={t("六轴叠加对比")}
            />
          )}
          <table className="job-compare-table">
            <thead>
              <tr>
                <th scope="col" />
                {jobs.map((job) => (
                  <th key={job.path} scope="col">
                    <button type="button" onClick={() => onDetail(job.path)}>
                      <strong>{job.company}</strong>
                      <small>{job.position || "—"}</small>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {jobs.map((job) => <td key={job.path}>{row.render(job)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** 托盘从底边升起只播一次：key 不随选中项变化，加减候选时不重播。 */
export function JobCompareTray({
  compared,
  onToggle,
  onOpen,
  onClear,
}: {
  compared: JobCard[];
  onToggle: (path: string) => void;
  onOpen: () => void;
  onClear: () => void;
}) {
  const { t } = useJobMenu();
  return (
    <div className="job-compare-tray" role="region" aria-label={t("对比候选")}>
      <span className="job-compare-count">{compared.length} / {COMPARE_LIMIT} {t("已选")}</span>
      <div className="job-compare-items">
        {compared.map((job) => (
          <button key={job.path} type="button" onClick={() => onToggle(job.path)}>
            {job.company} <i aria-hidden="true">×</i>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="job-compare-open"
        onClick={onOpen}
        disabled={compared.length < 2}
      >
        {t("并排对比")}
      </button>
      <button type="button" className="job-compare-clear" onClick={onClear}>{t("清空")}</button>
    </div>
  );
}
