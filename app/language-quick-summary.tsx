"use client";

import { useEffect, useRef } from "react";
import type { QuickSetSummaryData } from "@/lib/language/quick-session";
import { QUICK_EMPTY } from "@/lib/language/quick-types";
import { formatClock } from "@/lib/training-rhythm";
import { CountUp } from "./count-up";
import { quickShortcutBlocked, swallowRepeat, yieldsToNative } from "./language-quick-drill";
import { useQuickCopy } from "./language-quick-sync";

/*
 * 组间小结。口径都来自 summarizeQuickSet：
 * - 正确率只算首答的自动判分题；翻卡自评另计，不画成 ✓/×（它不是对错，只决定复习间隔）。
 * - 升阶 / 回落只来自服务端应答；还有没保存上的题时显示「—」，不显示 0——没保存上的可能正是升阶的那几条。
 */

export type QuickRemaining = { due: number; fresh: number };

export function QuickSetSummary({
  summary,
  remaining,
  busy = false,
  onAgain,
  onLeave,
}: {
  summary: QuickSetSummaryData;
  /** 今天还剩多少（来自最新的 quick/summary）；还没取到时为 null。 */
  remaining: QuickRemaining | null;
  busy?: boolean;
  onAgain: () => void;
  onLeave: () => void;
}) {
  const { t } = useQuickCopy();
  // 删除型助词题的答案是「∅」，单独一个符号看不懂，补上「不填」。
  const show = (value: string) => value === QUICK_EMPTY ? `${QUICK_EMPTY} ${t("不填")}` : value;
  const againRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const { graded, self, retries, stages } = summary;
  const accuracy = graded.accuracy;
  const ratio = accuracy ?? 0;

  // 焦点落在「再来一组」：按 Enter 直接接着练；页面滚动位置留在练习屏底部时把标题拉回视野。
  useEffect(() => {
    sectionRef.current?.scrollIntoView?.({ block: "start" });
    againRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (quickShortcutBlocked(event) || event.shiftKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onLeave();
        return;
      }
      if (event.key !== "Enter" || yieldsToNative(event)) return;
      event.preventDefault();
      if (!busy) onAgain();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [busy, onAgain, onLeave]);

  return (
    <section ref={sectionRef} className="quick-summary" aria-labelledby="quick-summary-title">
      <header className="quick-summary-head">
        <div>
          <small>SET COMPLETE · {t("本组小结")}</small>
          <h1 id="quick-summary-title">{summary.day} · {t("{count} 题快练", { count: summary.total })}</h1>
        </div>
        {summary.elapsedMs !== null && <p>{t("本次专注 {time}", { time: formatClock(summary.elapsedMs) })}</p>}
      </header>

      <div className="quick-summary-grid">
        <div className="quick-summary-score">
          <div className="language-settle-ring">
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle className="track" cx="60" cy="60" r="52" pathLength={1} />
              {ratio > 0 && <circle className="hit" cx="60" cy="60" r="52" pathLength={1} style={{ strokeDashoffset: 1 - ratio }} />}
            </svg>
            <div>
              {accuracy === null
                ? <strong>—</strong>
                : <p><CountUp as="strong" value={Math.round(accuracy * 100)} duration={900} /><span>%</span></p>}
              <small>{t("正确率")}</small>
            </div>
          </div>
          <div className="quick-summary-score-copy">
            <strong>{t("答对 {correct} / 判分 {total}", { correct: graded.correct, total: graded.total })}</strong>
            <small>{t("只算首答的判分题")}</small>
          </div>
        </div>

        <div className="quick-summary-facts">
          <h2>{t("本组")}</h2>
          <ul>
            {self.total > 0 && (
              <li className="is-self">{t("自评 {count} 题另计", { count: self.total, remembered: self.remembered, fuzzy: self.fuzzy, forgot: self.forgot })}</li>
            )}
            <li>{t("重出 {count} 题：改对 {fixed}", { count: retries.total, fixed: retries.fixed })}</li>
            {summary.gaveUp > 0 && <li>{t("不知道 {count} 题", { count: summary.gaveUp })}</li>}
            {summary.suspended > 0 && <li>{t("不再出 {count} 题", { count: summary.suspended })}</li>}
          </ul>
        </div>

        <div className="quick-summary-stages">
          <h2>{t("本组升阶")}</h2>
          <p className="quick-summary-big">
            {stages.known
              ? <><CountUp as="strong" value={stages.promoted.length} /><span>{t("项")}</span></>
              : <strong>—</strong>}
          </p>
          <small>{stages.known ? t("按服务端应答") : t("{count} 题尚未保存", { count: stages.pending })}</small>
          {stages.known && stages.demoted.length > 0 && <p className="quick-summary-down">{t("回落 {count} 项", { count: stages.demoted.length })}</p>}
        </div>
      </div>

      <section className="quick-summary-mistakes" aria-labelledby="quick-summary-mistakes">
        <h2 id="quick-summary-mistakes">{t("错题回看")} <span>{summary.mistakes.length}</span></h2>
        {summary.mistakes.length ? (
          <ol>
            {summary.mistakes.map((mistake) => {
              const selfRated = mistake.type === "flip";
              return (
                <li key={mistake.cardId} className={selfRated ? "is-self" : "is-fail"}>
                  {/* 自评的「模糊／忘了」只是要复习，不画成 ×。 */}
                  <b aria-hidden="true">{selfRated ? "↺" : "×"}</b>
                  <div className="quick-mistake-main">
                    <span lang="ja">{mistake.stem}</span>
                    <span aria-hidden="true">→</span>
                    <strong lang={mistake.type === "meaning_choice" ? "zh-CN" : "ja"}>{show(mistake.answer)}</strong>
                  </div>
                  <small>
                    {selfRated
                      ? t("需要复习")
                      : `${t("你选了")} ${mistake.gaveUp ? t("不知道") : (mistake.response ? show(mistake.response) : "—")}`}
                  </small>
                  <em className={`retry-${mistake.retry}`}>
                    {mistake.retry === "fixed" ? t("重出后答对") : mistake.retry === "wrong" ? t("重出仍错") : "—"}
                  </em>
                </li>
              );
            })}
          </ol>
        ) : summary.answered > 0
          ? <p className="quick-summary-clean">{t("全部答对")}</p>
          : <p className="quick-summary-empty">{t("本组没有作答")}</p>}
      </section>

      <footer className="quick-summary-foot">
        <p>
          <span>{t("今天还剩")}</span>
          {t("到期 {due} · 新题 {fresh}", { due: remaining ? remaining.due : "—", fresh: remaining ? remaining.fresh : "—" })}
        </p>
        <button type="button" className="quick-secondary" aria-keyshortcuts="Escape" onKeyDown={swallowRepeat} onClick={onLeave}>
          {t("回到总览")}<kbd aria-hidden="true">Esc</kbd>
        </button>
        <button ref={againRef} type="button" className="quick-primary" disabled={busy} aria-keyshortcuts="Enter" onKeyDown={swallowRepeat} onClick={onAgain}>
          {t("再来一组")}<kbd aria-hidden="true">Enter</kbd>
        </button>
      </footer>
    </section>
  );
}
