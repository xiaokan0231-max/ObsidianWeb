"use client";

import { useEffect, useRef } from "react";
import {
  awaitingCounterpart,
  HARD_GATE_LABEL,
  rateText,
  rateTone,
  salaryLabel,
  UNRATED_V2_LABEL,
  VERIFICATION_LABEL,
  type JobCard,
} from "@/lib/jobs";
import { isTypingTarget } from "@/lib/keyboard";
import { OPEN_NOTE_LABEL } from "@/lib/ui-labels";
import { useJobMenu } from "./jobs-copy";
import { FitPanel, ORIGIN_LABEL } from "./jobs-shared";
import { StatusPicker } from "./jobs-status";

export function JobDecisionWorkspace({
  jobs,
  selected,
  today,
  saving,
  keyboard = true,
  onSelect,
  onStatus,
  onOpenNote,
}: {
  jobs: JobCard[];
  selected: JobCard;
  today: string;
  saving: boolean;
  /** 对比浮层开着时让出方向键（浮层是模态的，背后的队列不该跟着动）。 */
  keyboard?: boolean;
  onSelect: (path: string) => void;
  onStatus: (
    status: string,
    note: string,
    channel?: string,
    expectedMtime?: number,
  ) => Promise<string | null>;
  onOpenNote: () => void;
}) {
  const { t, label: menuLabel } = useJobMenu();
  const queueRef = useRef<HTMLElement>(null);

  // j/k 与 ↑↓ 在队列里逐条走。打字、下拉框里的方向键（isTypingTarget）与别处已处理的按键都让出去。
  useEffect(() => {
    if (!keyboard) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      // 外壳的原笔记抽屉、⌘K 面板等模态层盖在决策台上时，方向键属于那一层（滚动正文、移动选项），
      // 背后的队列不该跟着换岗位。
      if (document.querySelector('[aria-modal="true"]')) return;
      const step = event.key === "j" || event.key === "ArrowDown" ? 1 : event.key === "k" || event.key === "ArrowUp" ? -1 : 0;
      if (step === 0) return;
      const index = jobs.findIndex((job) => job.path === selected.path);
      const next = jobs[Math.min(jobs.length - 1, Math.max(0, index + step))];
      if (!next) return;
      event.preventDefault();
      onSelect(next.path);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [jobs, keyboard, onSelect, selected.path]);

  // 键盘切换与改完状态后的自动下一条都可能落到队列可视区外；nearest 只在需要时滚，点击不会跳。
  useEffect(() => {
    queueRef.current?.querySelector<HTMLElement>("button.active")?.scrollIntoView({ block: "nearest" });
  }, [selected.path]);

  return (
    <div className="jobs-decision-workspace">
      <aside ref={queueRef} className="jobs-decision-queue" aria-label={t("机会队列")}>
        <header><strong>{t("待判断机会")}</strong><span>{jobs.length}</span><kbd>{t("j / k 或 ↑↓ 切换")}</kbd></header>
        {jobs.map((job, index) => (
          <button
            key={job.path}
            aria-current={job.path === selected.path ? "true" : undefined}
            className={job.path === selected.path ? "active" : ""}
            onClick={() => onSelect(job.path)}
          >
            <span className={`job-rate-badge rate-${rateTone(job.rating)}`} title={job.rated ? undefined : t("未採点（求人原文を読んでいない）")}>{rateText(job)}</span>
            <span>
              <small>
                {String(index + 1).padStart(2, "0")} ·{" "}
                {awaitingCounterpart(job) ? `${job.status}（已动手·等对方）` : job.status}
              </small>
              <strong>{job.company}</strong>
              <em>{job.position || "职位未记录"}</em>
            </span>
          </button>
        ))}
      </aside>

      <article className="jobs-decision-detail">
        <header>
          <div>
            <span>{ORIGIN_LABEL[selected.origin] ?? "岗位机会"} · 応募优先度 {selected.rating}/10{selected.fit && ` · Fit ${selected.fit.score} · Band ${selected.fit.band}`}</span>
            <h2>{selected.company}</h2>
            <p>{selected.position || "职位未记录"}</p>
          </div>
          <StatusPicker
            key={selected.path}
            value={selected.status}
            note={selected.statusNote}
            channel={selected.channel}
            sourceGuess={selected.sourceGroup}
            today={today}
            saving={saving}
            expectedMtime={selected.note.stat.mtime}
            quick
            onChange={onStatus}
          />
        </header>
        <dl>
          <div><dt>年収</dt><dd>{salaryLabel(selected)}</dd></div>
          <div><dt>v2 採点</dt><dd>{selected.fit ? `Fit ${selected.fit.score} · Band ${selected.fit.band} · Gate ${HARD_GATE_LABEL[selected.fit.hardGate]}` : UNRATED_V2_LABEL}</dd></div>
          <div><dt>勤務地</dt><dd>{selected.location || "—"}</dd></div>
          <div><dt>原文</dt><dd>{VERIFICATION_LABEL[selected.verification]}</dd></div>
          <div><dt>入库</dt><dd>{selected.date || "—"}</dd></div>
        </dl>
        {/* 判断要看的六轴与技术栈原来只在抽屉里，决策台为了它们还得另开一层。 */}
        <FitPanel fit={selected.fit} />
        {selected.stack.length > 0 && (
          <div className="job-stack jobs-decision-stack" aria-label={t("技術スタック")}>
            {selected.stack.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        )}
        {selected.reason && <section><h3>为什么值得判断</h3><p>{selected.reason}</p></section>}
        {selected.caution && <section className="is-caution"><h3>应募前确认</h3><p>{selected.caution}</p></section>}
        {selected.matches.length > 0 && (
          <section><h3>岗位契合点</h3><ul>{selected.matches.slice(0, 5).map((item, index) => <li key={index}>{item}</li>)}</ul></section>
        )}
        <footer>
          {selected.officialApplyUrl && (
            <a href={selected.officialApplyUrl} target="_blank" rel="noopener noreferrer">{t("官网应募 ↗")}</a>
          )}
          {selected.url && selected.url !== selected.officialApplyUrl && (
            <a href={selected.url} target="_blank" rel="noopener noreferrer">{t("查看求人原文 ↗")}</a>
          )}
          <button type="button" onClick={onOpenNote}>{menuLabel(OPEN_NOTE_LABEL)}</button>
        </footer>
      </article>
    </div>
  );
}
