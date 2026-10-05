"use client";

import { useEffect, useRef, useState } from "react";
import type { QuickItemBrief, QuickTriageJudgment } from "@/lib/language/quick-types";
import { quickSaveText, quickShortcutBlocked, swallowRepeat, useSwallowShellReload, yieldsToNative } from "./language-quick-drill";
import { QUICK_GROUP_COPY, useQuickCopy, type QuickCopyKey, type QuickSaveStatus } from "./language-quick-sync";

/*
 * 「快速过一遍」：找回旧扫描屏「一屏一条、一键分流」的那一处合理设计，但不恢复「扫完 200 项才能往下走」的门槛。
 * 一屏一条：日语（大字）、读音、中文意思（改错条目显示「✗ → ✓」）；1 会 / 2 不确定 / 3 不会。
 * 判断只决定新题的出题先后，不算成绩、不改阶段；标「会」的以后仍会出一次题验证（不信任自报）。
 * 每判一条就交给外壳的答案队列（action: "triage"），队列一次最多带 30 条；改判再发一条，服务端以最后一条为准。
 */

const JUDGMENT_KEYS: Record<string, QuickTriageJudgment> = { "1": "known", "2": "uncertain", "3": "unknown" };
const JUDGMENT_ORDER: readonly QuickTriageJudgment[] = ["known", "uncertain", "unknown"];
const JUDGMENT_COPY: Record<QuickTriageJudgment, QuickCopyKey> = { known: "会", uncertain: "不确定", unknown: "不会" };

export type QuickTriageProps = {
  items: readonly QuickItemBrief[];
  loading?: boolean;
  error?: string;
  saveStatus: QuickSaveStatus;
  onJudge: (item: QuickItemBrief, judgment: QuickTriageJudgment) => void;
  onEnd: () => void;
};

export function QuickTriage({ items, loading = false, error = "", saveStatus, onJudge, onEnd }: QuickTriageProps) {
  const { t, pick } = useQuickCopy();
  useSwallowShellReload();
  const [index, setIndex] = useState(0);
  const [judgments, setJudgments] = useState<ReadonlyMap<string, QuickTriageJudgment>>(() => new Map());
  const cardRef = useRef<HTMLElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);
  const total = items.length;
  const finished = total > 0 && index >= total;
  const item = finished ? undefined : items[index];
  const current = item ? judgments.get(item.itemId) : undefined;

  const judge = (judgment: QuickTriageJudgment) => {
    if (!item) return;
    // 同一条同一判断不重发：← 回去看一眼又按了同一个键，不必多写一条事件。
    if (judgments.get(item.itemId) !== judgment) {
      onJudge(item, judgment);
      setJudgments((map) => new Map(map).set(item.itemId, judgment));
    }
    setIndex((value) => value + 1);
  };
  const back = () => setIndex((value) => Math.max(0, value - 1));
  // → 只能走到已经判过的条目的下一条：没判的不能跳过去，否则「过一遍」就成了翻页。
  const forward = () => {
    if (item && judgments.has(item.itemId)) setIndex((value) => Math.min(total, value + 1));
  };

  useEffect(() => {
    if (finished) doneRef.current?.focus({ preventScroll: true });
    else cardRef.current?.focus({ preventScroll: true });
  }, [finished, index]);

  const handlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    handlerRef.current = (event: KeyboardEvent) => {
      if (quickShortcutBlocked(event) || event.shiftKey) return;
      const { key } = event;
      if (key === "Escape") {
        event.preventDefault();
        onEnd();
        return;
      }
      if (key === "ArrowLeft") {
        event.preventDefault();
        back();
        return;
      }
      if (key === "ArrowRight") {
        event.preventDefault();
        forward();
        return;
      }
      if (finished) {
        if (key === "Enter" && !yieldsToNative(event)) {
          event.preventDefault();
          onEnd();
        }
        return;
      }
      const judgment = JUDGMENT_KEYS[key];
      if (judgment) {
        event.preventDefault();
        judge(judgment);
      }
    };
  });
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => handlerRef.current(event);
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  const counts = { known: 0, uncertain: 0, unknown: 0 };
  for (const value of judgments.values()) counts[value] += 1;
  const position = Math.min(total, index + 1);

  return (
    <section className="quick-triage" aria-label={t("快速过一遍")}>
      <header className="quick-topbar quick-triage-top">
        <div className="quick-topbar-title">
          <span aria-hidden="true">分</span>
          <div>
            <strong>{t("快速过一遍")}</strong>
            <small className={`quick-save-status${saveStatus.rejected ? " is-danger" : saveStatus.failed ? " is-warning" : ""}`} aria-live="polite">
              {quickSaveText(saveStatus, t)}
            </small>
          </div>
        </div>
        <div className="quick-progress">
          <span className="quick-progress-count"><b>{total ? position : 0}</b> / {total}</span>
          <span
            className="quick-progress-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={judgments.size}
            aria-label={t("分流进度")}
          >
            <i style={{ transform: `scaleX(${total ? judgments.size / total : 0})` }} />
          </span>
        </div>
        <span className="quick-triage-counts">{t("会 {known} · 不确定 {uncertain} · 不会 {unknown}", counts)}</span>
        <button type="button" className="quick-end" aria-keyshortcuts="Escape" onKeyDown={swallowRepeat} onClick={onEnd}>
          {t("结束")}<kbd aria-hidden="true">Esc</kbd>
        </button>
      </header>
      <p className="quick-triage-note">{t("分流说明")}</p>

      {loading ? (
        <div className="quick-triage-card" role="status"><p className="quick-feedback-hint">{t("正在取条目")}</p></div>
      ) : error ? (
        <div className="focus-language-message error" role="alert">{error}</div>
      ) : !total ? (
        <div className="quick-triage-card"><p className="quick-feedback-hint">{t("没有要过的条目")}</p></div>
      ) : finished ? (
        <div className="quick-triage-card is-done">
          <h2>{t("这一轮过完了")}</h2>
          <p>{t("会 {known} · 不确定 {uncertain} · 不会 {unknown}", counts)}</p>
          <div className="quick-triage-actions">
            <button type="button" className="quick-secondary" aria-keyshortcuts="ArrowLeft" onClick={back}>
              <kbd aria-hidden="true">←</kbd>{t("上一条")}
            </button>
            <button ref={doneRef} type="button" className="quick-primary" aria-keyshortcuts="Enter" onKeyDown={swallowRepeat} onClick={onEnd}>
              {t("回到总览")}<kbd aria-hidden="true">Enter</kbd>
            </button>
          </div>
        </div>
      ) : item ? (
        <article ref={cardRef} className="quick-triage-card" tabIndex={-1} aria-labelledby={`quick-triage-${item.itemId}`}>
          <header className="quick-card-meta">
            <span className="quick-type">{pick(QUICK_GROUP_COPY[item.group] ?? ["", ""])}</span>
            {current && <em>{t("已判：{judgment}", { judgment: t(JUDGMENT_COPY[current]) })}</em>}
          </header>
          <p id={`quick-triage-${item.itemId}`} className="quick-triage-ja" lang="ja">
            {item.wrong ? <><s>{item.wrong}</s><span aria-hidden="true"> → </span>{item.ja}</> : item.ja}
          </p>
          <dl className="quick-reveal-facts">
            {item.reading && <div><dt>{t("读音")}</dt><dd lang="ja">{item.reading}</dd></div>}
            {item.meaning && <div><dt>{t("意思")}</dt><dd lang="zh-CN">{item.meaning}</dd></div>}
          </dl>
          <div className="quick-triage-choices" role="group" aria-label={t("选择")}>
            {JUDGMENT_ORDER.map((judgment, offset) => (
              <button
                key={judgment}
                type="button"
                className={`quick-option quick-triage-${judgment}${current === judgment ? " is-chosen" : ""}`}
                aria-keyshortcuts={String(offset + 1)}
                aria-pressed={current === judgment}
                onClick={() => judge(judgment)}
              >
                <kbd aria-hidden="true">{offset + 1}</kbd>{t(JUDGMENT_COPY[judgment])}
              </button>
            ))}
          </div>
          <footer className="quick-card-actions">
            <button type="button" className="quick-quiet" aria-keyshortcuts="ArrowLeft" disabled={index === 0} onClick={back}>
              <kbd aria-hidden="true">←</kbd>{t("上一条")}
            </button>
            {current && (
              <button type="button" className="quick-quiet" aria-keyshortcuts="ArrowRight" onClick={forward}>
                {t("下一条")}<kbd aria-hidden="true">→</kbd>
              </button>
            )}
          </footer>
        </article>
      ) : null}
    </section>
  );
}
