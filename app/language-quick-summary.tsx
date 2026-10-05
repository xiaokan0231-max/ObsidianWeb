"use client";

import { useEffect, useRef } from "react";
import type { LanguageTrainingStage } from "@/lib/language/types";
import type { QuickDueGroup, QuickSetSummaryData } from "@/lib/language/quick-session";
import { QUICK_EMPTY } from "@/lib/language/quick-types";
import { formatClock } from "@/lib/training-rhythm";
import { CountUp } from "./count-up";
import { quickShortcutBlocked, swallowRepeat, yieldsToNative } from "./language-quick-drill";
import { QUICK_AGAIN_LOCK_MS, useQuickCopy } from "./language-quick-sync";

/*
 * 组间小结。口径都来自 summarizeQuickSet：
 * - 正确率只算首答的自动判分题；翻卡自评另计，不画成 ✓/×（它不是对错，只决定复习间隔）；「太简单」单列。
 * - 升阶 / 回落只来自服务端应答；还有没保存上的题时显示「—」，不显示 0——没保存上的可能正是升阶的那几条。
 * - 「下次复习」按服务端应答里的 nextDueAt 分组：练完马上知道这组题什么时候回来，第二天不会以为白练了。
 */

export type QuickRemaining = { due: number; fresh: number };

const STAGE_COPY: Record<LanguageTrainingStage, string> = {
  unseen: "未见过",
  recognized: "能识别",
  correctable: "能修正",
  retrievable: "能主动提取",
  transferable: "能迁移使用",
  stable: "训练稳定",
};

export function QuickSetSummary({
  summary,
  remaining,
  busy = false,
  focusMs,
  nextDue,
  onAgain,
  onLeave,
  onRestore,
}: {
  summary: QuickSetSummaryData;
  /** 今天还剩多少（来自最新的 quick/summary）；还没取到时为 null。 */
  remaining: QuickRemaining | null;
  busy?: boolean;
  /** 外壳专注计时的读数（与练习屏顶栏同一只表）；不给时退回各题用时之和。 */
  focusMs?: number | null;
  /** 本组的题什么时候回来（nextDueGroups）；还有没保存上的题时为 null。 */
  nextDue?: QuickDueGroup[] | null;
  onAgain: () => void;
  onLeave: () => void;
  /** 恢复本组按 X 排除的条目（记一条 restore）。 */
  onRestore?: (itemId: string) => void;
}) {
  const { t, label, locale } = useQuickCopy();
  // 删除型助词题的答案是「∅」，单独一个符号看不懂，补上「不填」。
  const show = (value: string) => value === QUICK_EMPTY ? `${QUICK_EMPTY} ${t("不填")}` : value;
  const againRef = useRef<HTMLButtonElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // 挂载时刻：之前的 QUICK_AGAIN_LOCK_MS 内「再来一组」不响应。0＝还没挂载完，同样不响应。
  const mountedAt = useRef(0);
  const { graded, self, retries, stages } = summary;
  const accuracy = graded.accuracy;
  const ratio = accuracy ?? 0;
  const elapsed = focusMs ?? summary.elapsedMs;

  // 焦点落在「再来一组」：按 Enter 直接接着练；页面滚动位置留在练习屏底部时把标题拉回视野。
  useEffect(() => {
    mountedAt.current = Date.now();
    sectionRef.current?.scrollIntoView?.({ block: "start" });
    againRef.current?.focus({ preventScroll: true });
  }, []);

  // 最后一题习惯性多按的 Enter 会落到这里：挂载后一小段时间内按钮与全局 Enter 都不响应，小结才不会被直接跳过。
  const again = () => {
    if (busy || !mountedAt.current || Date.now() - mountedAt.current < QUICK_AGAIN_LOCK_MS) return;
    onAgain();
  };
  const latestAgain = useRef(again);
  useEffect(() => {
    latestAgain.current = again;
  });

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
      latestAgain.current();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [onLeave]);

  const dueText = (group: QuickDueGroup) => group.days <= 0
    ? t("今天 {count} 题", { count: group.count })
    : group.days === 1
      ? t("明天 {count} 题", { count: group.count })
      : t("{days} 天后 {count} 题", { days: group.days, count: group.count });

  return (
    <section ref={sectionRef} className="quick-summary" aria-labelledby="quick-summary-title">
      <header className="quick-summary-head">
        <div>
          <small>SET COMPLETE · {t("本组小结")}</small>
          <h1 id="quick-summary-title">{summary.day} · {t("{count} 题快练", { count: summary.total })}</h1>
        </div>
        {elapsed !== null && elapsed !== undefined && <p>{t("本次专注 {time}", { time: formatClock(elapsed) })}</p>}
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
            {summary.easy > 0 && <li className="is-easy">{t("太简单 {count} 题", { count: summary.easy })}</li>}
            {summary.suspended > 0 && <li>{t("不再出 {count} 题", { count: summary.suspended })}</li>}
          </ul>
          <p className="quick-summary-next">
            <span>{t("下次复习")}</span>
            {nextDue === null || nextDue === undefined
              ? (stages.known ? "—" : t("保存完后显示"))
              : nextDue.length ? nextDue.map(dueText).join(locale === "ja" ? "・" : " · ") : "—"}
          </p>
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
          {stages.known && stages.promoted.length > 0 && (
            <details className="quick-summary-promoted">
              <summary>{t("展开升阶条目")}</summary>
              <ul>
                {stages.promoted.map((change) => (
                  <li key={change.itemId}>
                    <span lang="ja">{change.stem ?? change.itemId}</span>
                    {change.answer && <><span aria-hidden="true">→</span><strong>{show(change.answer)}</strong></>}
                    <small>{label(STAGE_COPY[change.before])} → {label(STAGE_COPY[change.after])}</small>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>

      {summary.suspendedItems.length > 0 && (
        <section className="quick-summary-excluded" aria-labelledby="quick-summary-excluded">
          <h2 id="quick-summary-excluded">{t("本组排除的条目")} <span>{summary.suspendedItems.length}</span></h2>
          <ul>
            {summary.suspendedItems.map((item) => (
              <li key={item.itemId}>
                <span lang="ja">{item.stem}</span>
                <span aria-hidden="true">→</span>
                <strong>{show(item.answer)}</strong>
                <button type="button" className="quick-inline-action" disabled={!onRestore} onClick={() => onRestore?.(item.itemId)}>{t("恢复")}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

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
        <button ref={againRef} type="button" className="quick-primary" disabled={busy} aria-keyshortcuts="Enter" onKeyDown={swallowRepeat} onClick={again}>
          {t("再来一组")}<kbd aria-hidden="true">Enter</kbd>
        </button>
      </footer>
    </section>
  );
}
