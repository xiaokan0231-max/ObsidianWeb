"use client";

import ScopeLoading from "./scope-loading";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { postJson } from "@/lib/client-api";
import { isTypingTarget } from "@/lib/keyboard";
import { getString, getType, type Note } from "@/lib/notes";
import type { AdvisoryEvidenceRef } from "@/lib/interview-advisory";
import {
  interviewPracticeKey,
  parseInterviewPractice,
  practiceCompletedOn,
  stepPracticeKey,
  type InterviewPracticeAction,
  type InterviewPracticeRating,
} from "@/lib/review-practice";
import { reviewSourcePath } from "@/lib/review-paths";
import { textCodec, useUrlState } from "./use-url-state";
import { practiceStatusLabel } from "@/lib/ui-labels";
import { appViewHref, reviewEvidenceSearch } from "./app-route";
import { useUiLocale } from "./ui-locale";

const PRACTICE_MENU_JA: Record<string, string> = {
  "练习队列": "練習キュー",
  "待练": "練習待ち",
  "已完成": "完了",
  "今日已完成": "今日の完了",
  "今日进度": "今日の進み具合",
  "证据句：": "根拠の文：",
  "Space 揭示 · 1 / 2 / 3 自评 · Enter 完成 · N 明日再练 · ↑↓ 切题": "Space 表示 · 1 / 2 / 3 自己評価 · Enter 完了 · N 明日に回す · ↑↓ 切替",
};

type PracticeItem = ReturnType<typeof parseInterviewPractice>[number] & {
  key: string;
  practicePath: string;
  company: string;
  date: string;
  round: string;
};

const RATING_LABEL: Record<InterviewPracticeRating, string> = {
  smooth: "顺畅",
  stuck: "卡顿",
  unknown: "不会",
};

// 自评的数字键与按钮顺序一一对应：按钮上印的 <kbd> 就是这张表，改顺序时两边一起变。
const RATING_KEYS: Record<string, InterviewPracticeRating> = { "1": "smooth", "2": "stuck", "3": "unknown" };

function InterviewPractice({
  notes,
  loading = false,
  today,
  onNoteWritten,
  onOpenEvidence,
}: {
  notes: Note[];
  /** 面试 scope 还没到：此时队列为空不等于「今天清空了」，别先闪一句假的完成提示。 */
  loading?: boolean;
  today: string;
  onNoteWritten: (note: Note) => void;
  /** 证据句在应用内打开复盘原文；不传时链接照常整页跳转（新标签打开也一样能用）。 */
  onOpenEvidence?: (ref: AdvisoryEvidenceRef) => void;
}) {
  const { locale } = useUiLocale();
  const ui = (label: string) => locale === "ja" ? PRACTICE_MENU_JA[label] ?? label : label;
  const [showCompleted, setShowCompleted] = useState(false);
  // 选中的题放进 URL：去原笔记查完再回来，仍停在这一题。已完成／过期的键找不到时落回队首，不会空白。
  const [selectedKey, setSelectedKey] = useUrlState("item", "", textCodec);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const queueRef = useRef<HTMLElement>(null);
  const viewRef = useRef<HTMLElement>(null);

  const items = useMemo<PracticeItem[]>(() => notes
    .filter((note) => getType(note) === "interview-answer-practice")
    .flatMap((note) => parseInterviewPractice(note.content).map((entry) => ({
      ...entry,
      key: interviewPracticeKey(note.path, entry.blockId),
      practicePath: note.path,
      company: getString(note.frontmatter.company),
      date: getString(note.frontmatter.date),
      round: getString(note.frontmatter.round),
    })))
    .sort((left, right) => (right.queuedAt || "").localeCompare(left.queuedAt || "")), [notes]);

  const current = items.filter((item) =>
    item.status !== "completed" &&
    (item.status !== "snoozed" || !item.dueAt || item.dueAt <= today),
  );
  const completed = items.filter((item) => item.status === "completed");
  const visible = showCompleted ? completed : current;
  const selected = visible.find((item) => item.key === selectedKey) ?? visible[0] ?? null;
  const doneToday = practiceCompletedOn(items, today);
  const progressTotal = current.length + doneToday;

  const selectItem = (key: string) => {
    setSelectedKey(key);
    setRevealed(false);
    setMessage("");
    setError("");
  };

  const act = async (
    action: InterviewPracticeAction,
    rating?: InterviewPracticeRating,
  ) => {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const payload = await postJson<{ ok?: boolean; error?: string; note?: Note; dueAt?: string }>("/api/review/practice/action", {
        practicePath: selected.practicePath,
        blockId: selected.blockId,
        action,
        rating,
      });
      if (!payload.note) throw new Error(payload.error || "记录练习失败");
      onNoteWritten(payload.note);
      if (action === "attempt") setMessage(`已记录：${rating ? RATING_LABEL[rating] : "本次练习"}`);
      if (action === "complete") { setMessage("已完成，正在切换下一题。"); setRevealed(false); setSelectedKey(""); }
      if (action === "snooze") { setMessage(`已安排到 ${payload.dueAt ?? "明日"}。`); setRevealed(false); setSelectedKey(""); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "记录练习失败");
    } finally {
      setBusy(false);
    }
  };

  // 键盘流里的最新状态：监听只挂一次，每次按键读这里，不必随每次渲染拆装 window 监听。
  const keyState = useRef({ selected, visible, revealed, showCompleted, busy, act, selectItem });
  useEffect(() => {
    keyState.current = { selected, visible, revealed, showCompleted, busy, act, selectItem };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      // 抽屉、⌘K、回答库浮层叠在本页之上时，方向键和空格是它们自己的滚动；只接页面本身或本页内的按键。
      const target = event.target;
      const fromPage = target === document.body || target === document.documentElement;
      if (!fromPage && !(target instanceof Node && viewRef.current?.contains(target))) return;
      const state = keyState.current;
      if (!state.selected) return;
      const key = event.key;
      // 焦点在按钮或链接上时，Space / Enter 是它自己的「按下」；再抢一次就会把同一题记两遍。
      const onControl = event.target instanceof Element && event.target.closest("button, a, [role='button']");
      if ((key === " " || key === "Enter") && onControl) return;
      if (key === "ArrowDown" || key === "ArrowUp") {
        const next = stepPracticeKey(state.visible.map((item) => item.key), state.selected.key, key === "ArrowDown" ? 1 : -1);
        event.preventDefault();
        if (next && next !== state.selected.key) {
          state.selectItem(next);
          // 队列独立滚动：切到视口外的题时把它带进来，免得「选中了却看不见」。
          window.requestAnimationFrame(() => {
            queueRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
          });
        }
        return;
      }
      if (state.showCompleted || state.busy) return;
      if (key === " " && !state.revealed) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (!state.revealed) return;
      const rating = RATING_KEYS[key];
      if (rating) {
        event.preventDefault();
        void state.act("attempt", rating);
      } else if (key === "Enter") {
        event.preventDefault();
        void state.act("complete");
      } else if (key === "n" || key === "N") {
        event.preventDefault();
        void state.act("snooze");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const evidenceSource = selected ? reviewSourcePath(selected.practicePath, "practice") : null;

  return (
    <section className="practice-view" ref={viewRef}>
      <h1 className="sr-only">回答重练</h1>

      <div className="practice-tabs" role="tablist" aria-label={ui("练习队列")}>
        <button role="tab" aria-selected={!showCompleted} className={!showCompleted ? "active" : ""} onClick={() => { setShowCompleted(false); selectItem(""); }}>{ui("待练")} {current.length}</button>
        <button role="tab" aria-selected={showCompleted} className={showCompleted ? "active" : ""} onClick={() => { setShowCompleted(true); selectItem(""); }}>{ui("已完成")} {completed.length}</button>
      </div>

      {!loading && progressTotal > 0 && (
        <header className="kill-map-head practice-progress" aria-label={ui("今日进度")}>
          <div>
            <strong>{doneToday} / {progressTotal}</strong>
            <span>{ui("待练")} {current.length} · {ui("今日已完成")} {doneToday}</span>
          </div>
          <i aria-hidden="true"><em style={{ width: `${(doneToday / progressTotal) * 100}%` }} /></i>
          <small className="practice-keys">{ui("Space 揭示 · 1 / 2 / 3 自评 · Enter 完成 · N 明日再练 · ↑↓ 切题")}</small>
        </header>
      )}

      {visible.length === 0 && loading ? (
        <ScopeLoading label="回答队列" />
      ) : visible.length === 0 ? (
        <div className="practice-empty">
          <strong>{showCompleted ? "还没有已完成的回答" : "今天的回答队列已经清空"}</strong>
          <p>{showCompleted ? "完成一次重练后会保留在这里。" : "从面试复盘中选择“加入重练”，下一题会出现在这里。"}</p>
        </div>
      ) : (
        <div className="practice-workspace">
          <aside className="practice-queue" aria-label="回答题目" ref={queueRef}>
            {visible.map((item, index) => (
              <button
                key={item.key}
                className={item.key === selected?.key ? "active" : ""}
                aria-current={item.key === selected?.key ? "true" : undefined}
                onClick={() => selectItem(item.key)}
              >
                <small>{String(index + 1).padStart(2, "0")} · {practiceStatusLabel(item.status)}</small>
                <strong>{item.questionTitle || item.blockId}</strong>
                <span>{item.company}{item.round ? ` · ${item.round}` : ""}</span>
              </button>
            ))}
          </aside>

          {selected && (
            <article className="practice-card" key={selected.key}>
              <header>
                <span>{selected.date || "日期未知"} · {selected.company || "面试回答"}</span>
                <strong>{selected.blockId}{selected.round ? ` · ${selected.round}` : ""}</strong>
              </header>
              <div className="practice-question">
                <small>QUESTION</small>
                <h2 lang="ja">{selected.questionTitle}</h2>
                {!showCompleted && <p>请先完整说一遍，再揭示参考答案。</p>}
              </div>

              {!revealed && !showCompleted ? (
                <button className="practice-reveal" onClick={() => setRevealed(true)}>我已经回答 · 查看改善稿 <kbd>Space</kbd></button>
              ) : (
                <div className="practice-answer">
                  <small>IMPROVED ANSWER · AI DRAFT</small>
                  <p lang="ja">{selected.improvedAnswerJa}</p>
                  {selected.evidenceSentenceIds.length > 0 && (
                    <span className="practice-evidence">
                      {ui("证据句：")}
                      {selected.evidenceSentenceIds.map((sentenceId) => {
                        if (!evidenceSource) return <b key={sentenceId}>{sentenceId}</b>;
                        const ref = { sourcePath: evidenceSource, blockId: selected.blockId, sentenceIds: [sentenceId] };
                        return (
                          <a
                            key={sentenceId}
                            href={appViewHref("review", reviewEvidenceSearch(ref))}
                            onClick={(event) => {
                              if (!onOpenEvidence || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                              event.preventDefault();
                              onOpenEvidence(ref);
                            }}
                          >{sentenceId}</a>
                        );
                      })}
                    </span>
                  )}
                </div>
              )}

              {!showCompleted && revealed && (
                <div className="practice-actions">
                  <div>
                    <span>这次说得怎么样？</span>
                    {(Object.keys(RATING_LABEL) as InterviewPracticeRating[]).map((rating, index) => (
                      <button key={rating} disabled={busy} onClick={() => void act("attempt", rating)}>
                        <kbd>{index + 1}</kbd>{RATING_LABEL[rating]}
                      </button>
                    ))}
                  </div>
                  <div>
                    <button className="practice-complete" disabled={busy} onClick={() => void act("complete")}><kbd>Enter</kbd>完成这题</button>
                    <button disabled={busy} onClick={() => void act("snooze")}><kbd>N</kbd>明日再练</button>
                  </div>
                </div>
              )}
              {message && <div className="practice-message" role="status">{message}</div>}
              {error && <div className="inline-write-error" role="alert">{error}</div>}
            </article>
          )}
        </div>
      )}
    </section>
  );
}

export default memo(InterviewPractice);
