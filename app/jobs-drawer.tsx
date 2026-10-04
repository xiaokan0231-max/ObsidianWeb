"use client";

import { useRef, useState } from "react";
import {
  intakeRelative,
  OFFICIAL_APPLY_LABEL,
  rateText,
  rateTone,
  WAITING_FOR_LABEL,
  type JobCard,
} from "@/lib/jobs";
import { formatDate, getString, getTitle, getType, type Note } from "@/lib/notes";
import { OPEN_NOTE_LABEL } from "@/lib/ui-labels";
import { useDialogFocus } from "./use-dialog-focus";
import { useJobMenu } from "./jobs-copy";
import { COMPARE_LIMIT, FitPanel, ORIGIN_LABEL } from "./jobs-shared";
import { StatusPicker } from "./jobs-status";

const WAITING_FOR_OPTIONS = [
  { value: "", label: "没有外部等待" },
  ...Object.entries(WAITING_FOR_LABEL).map(([value, label]) => ({ value, label })),
];

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="job-detail-block">
      <h3>{title}</h3>
      <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </section>
  );
}

export function JobDrawer({
  job,
  notes,
  today,
  saving,
  compared,
  compareFull,
  requestedStatus,
  onClose,
  onStatus,
  onFollowUp,
  onCompare,
  onOpenNote,
}: {
  job: JobCard;
  notes: Note[];
  today: string;
  saving: boolean;
  compared: boolean;
  compareFull: boolean;
  /** 从看板拖过来但缺 channel 的目标状态：打开时直接摊开渠道选择。 */
  requestedStatus?: string;
  onClose: () => void;
  onStatus: (
    status: string,
    note: string,
    channel?: string,
    expectedMtime?: number,
  ) => Promise<string | null>;
  onFollowUp: (values: {
    waitingFor: string | null;
    followUpAt: string | null;
    nextEventAt: string | null;
  }) => Promise<string | null>;
  onCompare: () => void;
  onOpenNote: (note?: Note) => void;
}) {
  const { t, label: menuLabel } = useJobMenu();
  const intakeAge = intakeRelative(job.date, today);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef);
  const [waitingFor, setWaitingFor] = useState(job.waitingFor);
  const [followUpAt, setFollowUpAt] = useState(job.followUpAt);
  const [nextEventAt, setNextEventAt] = useState(job.nextEventAt);
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const related = job.caseId
    ? notes.filter((note) => note.path !== job.path && getString(note.frontmatter.case_id) === job.caseId)
    : [];
  const saveFollowUp = async () => {
    setFollowUpSaving(true);
    setFollowUpMessage("");
    const error = await onFollowUp({
      waitingFor: waitingFor || null,
      followUpAt: followUpAt || null,
      nextEventAt: nextEventAt || null,
    });
    setFollowUpMessage(error || "跟进信息已写入 Vault。");
    setFollowUpSaving(false);
  };
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside ref={dialogRef} tabIndex={-1} className="note-drawer job-drawer" aria-label={t("岗位详情")} aria-modal="true" role="dialog">
        <header className="drawer-header">
          <div>
            <span style={{ color: "var(--green)" }}>{ORIGIN_LABEL[job.origin] ?? "岗位机会"}</span>
            <small>{job.path}</small>
          </div>
          <button onClick={onClose} aria-label={t("关闭详情")}>×</button>
        </header>
        <div className="drawer-scroll">
          <div className="job-detail-head">
            <div>
              <h1>{job.company}</h1>
              {job.position && <p className="job-position">{job.position}</p>}
            </div>
            <div className={`job-rating job-rating-large rate-${rateTone(job.rating)}`}>
              <span className="job-score">
                <b>{rateText(job)}</b>
                <small>{job.rated ? "/10" : "未採点"}</small>
              </span>
              <span className="job-meter"><i style={{ width: `${job.rated ? job.rating * 10 : 0}%` }} /></span>
            </div>
          </div>

          <FitPanel fit={job.fit} />

          <div className="job-detail-actions">
            <StatusPicker
              value={job.status}
              note={job.statusNote}
              channel={job.channel}
              sourceGuess={job.sourceGroup}
              today={today}
              saving={saving}
              expectedMtime={job.note.stat.mtime}
              requestedStatus={requestedStatus}
              onChange={onStatus}
            />
            {/* 列表 / 看板 / 周复盘视图里没有对比按钮，都从详情这里加入。 */}
            <button
              type="button"
              className={compared ? "job-compare-toggle active" : "job-compare-toggle"}
              aria-pressed={compared}
              disabled={!compared && compareFull}
              title={!compared && compareFull ? t("最多同时对比 {count} 个岗位", { count: COMPARE_LIMIT }) : t("加入对比")}
              onClick={onCompare}
            >
              {compared ? t("已加入对比") : t("对比")}
            </button>
            {job.officialApplyUrl && (
              <a className="job-link job-official-link" href={job.officialApplyUrl} target="_blank" rel="noopener noreferrer">
                {job.officialApplyStatus === "exact" ? t("官网直投 ↗") : job.officialApplyStatus === "related" ? t("官网相近职位 ↗") : t("官网招聘 ↗")}
              </a>
            )}
            {job.url && job.url !== job.officialApplyUrl && (
              <a className="job-link" href={job.url} target="_blank" rel="noopener noreferrer">{t("求人票 ↗")}</a>
            )}
            <button type="button" className="job-detail" onClick={() => onOpenNote()}>{menuLabel(OPEN_NOTE_LABEL)}</button>
          </div>

          <dl className="job-detail-facts">
            <div><dt>年収</dt><dd>{job.salaryText || "—"}</dd></div>
            <div><dt>勤務地</dt><dd>{job.location || "—"}</dd></div>
            <div><dt>雇用形態</dt><dd>{job.employment || "—"}</dd></div>
            <div><dt>来源</dt><dd>{job.source || "—"}</dd></div>
            <div><dt>录入方式</dt><dd>{ORIGIN_LABEL[job.origin] ?? (job.origin || "—")}</dd></div>
            <div><dt>案件 ID</dt><dd>{job.caseId || "—"}</dd></div>
            <div><dt>官方渠道</dt><dd>{OFFICIAL_APPLY_LABEL[job.officialApplyStatus]}{job.officialApplyNote ? ` · ${job.officialApplyNote}` : ""}</dd></div>
            {/* 「推荐日期」だと応募日と紛らわしい。frontmatter `date` は AI 推薦が入库した日。 */}
            <div><dt>入库日</dt><dd>{job.date ? `${job.date}${intakeAge && ` · ${intakeAge}`}` : "—"}</dd></div>
            <div><dt>笔记更新</dt><dd>{formatDate(job.updatedAt, true)}</dd></div>
          </dl>

          <section className="job-case-workspace" aria-label={t("案件推进")}>
            <div className="job-case-workspace-head">
              <div>
                <span>CASE WORKSPACE</span>
                <h2>{t("下一步与承诺")}</h2>
              </div>
              <small>{job.nextAction || "尚未记录下一动作"}</small>
            </div>
            <div className="job-follow-up-form">
              <label>
                <span>{t("等待对象")}</span>
                <select value={waitingFor} onChange={(event) => setWaitingFor(event.target.value)}>
                  {WAITING_FOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{menuLabel(option.label)}</option>)}
                </select>
              </label>
              <label>
                <span>{t("跟进日期")}</span>
                <input type="date" value={followUpAt} disabled={!waitingFor} onChange={(event) => setFollowUpAt(event.target.value)} />
              </label>
              <label>
                <span>{t("下一场日程")}</span>
                <input
                  type="text"
                  value={nextEventAt}
                  placeholder="YYYY-MM-DD HH:MM"
                  onChange={(event) => setNextEventAt(event.target.value)}
                />
              </label>
              <button type="button" disabled={followUpSaving} onClick={() => void saveFollowUp()}>
                {followUpSaving ? t("写入中…") : t("保存跟进")}
              </button>
            </div>
            {followUpMessage && (
              <p className={followUpMessage.includes("已写入") ? "job-follow-up-success" : "job-status-note-error"} role="status">
                {followUpMessage}
              </p>
            )}
            {related.length > 0 && (
              <div className="job-case-related">
                <span>同一案件</span>
                {related.map((note) => (
                  <button key={note.path} type="button" onClick={() => onOpenNote(note)}>
                    {getTitle(note)} <small>{getType(note)}</small>
                  </button>
                ))}
              </div>
            )}
          </section>

          {job.verification !== "verified" && (
            <p className="job-detail-warning">
              {job.verification === "warned"
                ? "笔记里有未验证 / 需要核对的标记。应募前请自行打开求人原文确认必须要件。"
                : "这条岗位还没有求人原文核对记录。AI 打分只是假设，不能当作事实。"}
            </p>
          )}

          {job.stack.length > 0 && (
            <div className="job-stack">{job.stack.map((tag) => <span key={tag}>{tag}</span>)}</div>
          )}

          {job.reason && (
            <section className="job-detail-block">
              <h3>推荐理由</h3>
              <p>{job.reason}</p>
            </section>
          )}
          <DetailList title="匹配点" items={job.matches} />
          {job.caution && (
            <section className="job-detail-block job-detail-caution">
              <h3>注意点</h3>
              <p>{job.caution}</p>
            </section>
          )}
          <DetailList title="主打材料" items={job.materials} />
        </div>
      </aside>
    </div>
  );
}
