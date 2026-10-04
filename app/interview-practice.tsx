"use client";

import ScopeLoading from "./scope-loading";
import { memo, useMemo, useState } from "react";
import { postJson } from "@/lib/client-api";
import { getString, getType, type Note } from "@/lib/notes";
import {
  interviewPracticeKey,
  parseInterviewPractice,
  type InterviewPracticeAction,
  type InterviewPracticeRating,
} from "@/lib/review-practice";
import { textCodec, useUrlState } from "./use-url-state";
import { practiceStatusLabel } from "@/lib/ui-labels";
import { useUiLocale } from "./ui-locale";

const PRACTICE_MENU_JA: Record<string, string> = {
  "练习队列": "練習キュー",
  "待练": "練習待ち",
  "已完成": "完了",
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

function InterviewPractice({
  notes,
  loading = false,
  today,
  onNoteWritten,
}: {
  notes: Note[];
  /** 面试 scope 还没到：此时队列为空不等于「今天清空了」，别先闪一句假的完成提示。 */
  loading?: boolean;
  today: string;
  onNoteWritten: (note: Note) => void;
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
    if (!selected) return;
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

  return (
    <section className="practice-view">
      <h1 className="sr-only">回答重练</h1>

      <div className="practice-tabs" role="tablist" aria-label={ui("练习队列")}>
        <button className={!showCompleted ? "active" : ""} onClick={() => { setShowCompleted(false); selectItem(""); }}>{ui("待练")} {current.length}</button>
        <button className={showCompleted ? "active" : ""} onClick={() => { setShowCompleted(true); selectItem(""); }}>{ui("已完成")} {completed.length}</button>
      </div>

      {visible.length === 0 && loading ? (
        <ScopeLoading label="回答队列" />
      ) : visible.length === 0 ? (
        <div className="practice-empty">
          <strong>{showCompleted ? "还没有已完成的回答" : "今天的回答队列已经清空"}</strong>
          <p>{showCompleted ? "完成一次重练后会保留在这里。" : "从面试复盘中选择“加入重练”，下一题会出现在这里。"}</p>
        </div>
      ) : (
        <div className="practice-workspace">
          <aside className="practice-queue" aria-label="回答题目">
            {visible.map((item, index) => (
              <button
                key={item.key}
                className={item.key === selected?.key ? "active" : ""}
                onClick={() => selectItem(item.key)}
              >
                <small>{String(index + 1).padStart(2, "0")} · {practiceStatusLabel(item.status)}</small>
                <strong>{item.questionTitle || item.blockId}</strong>
                <span>{item.company}{item.round ? ` · ${item.round}` : ""}</span>
              </button>
            ))}
          </aside>

          {selected && (
            <article className="practice-card">
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
                <button className="practice-reveal" onClick={() => setRevealed(true)}>我已经回答 · 查看改善稿</button>
              ) : (
                <div className="practice-answer">
                  <small>IMPROVED ANSWER · AI DRAFT</small>
                  <p lang="ja">{selected.improvedAnswerJa}</p>
                  {selected.evidenceSentenceIds.length > 0 && (
                    <span>证据句：{selected.evidenceSentenceIds.join(" · ")}</span>
                  )}
                </div>
              )}

              {!showCompleted && revealed && (
                <div className="practice-actions">
                  <div>
                    <span>这次说得怎么样？</span>
                    {(Object.keys(RATING_LABEL) as InterviewPracticeRating[]).map((rating) => (
                      <button key={rating} disabled={busy} onClick={() => void act("attempt", rating)}>
                        {RATING_LABEL[rating]}
                      </button>
                    ))}
                  </div>
                  <div>
                    <button className="practice-complete" disabled={busy} onClick={() => void act("complete")}>完成这题</button>
                    <button disabled={busy} onClick={() => void act("snooze")}>明日再练</button>
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
