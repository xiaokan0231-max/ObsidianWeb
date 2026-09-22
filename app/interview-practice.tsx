"use client";

import { memo, useMemo, useState } from "react";
import { getString, getType, type Note } from "@/lib/notes";
import {
  interviewPracticeKey,
  parseInterviewPractice,
  type InterviewPracticeAction,
  type InterviewPracticeRating,
} from "@/lib/review-practice";

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
  today,
  onNoteWritten,
}: {
  notes: Note[];
  today: string;
  onNoteWritten: (note: Note) => void;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
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
      const response = await fetch("/api/review/practice/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          practicePath: selected.practicePath,
          blockId: selected.blockId,
          action,
          rating,
        }),
      });
      const payload = (await response.json()) as { error?: string; note?: Note; dueAt?: string };
      if (!response.ok || !payload.note) throw new Error(payload.error || "记录练习失败");
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

      <div className="practice-tabs" role="tablist" aria-label="练习队列">
        <button className={!showCompleted ? "active" : ""} onClick={() => { setShowCompleted(false); selectItem(""); }}>待练 {current.length}</button>
        <button className={showCompleted ? "active" : ""} onClick={() => { setShowCompleted(true); selectItem(""); }}>已完成 {completed.length}</button>
      </div>

      {visible.length === 0 ? (
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
                <small>{String(index + 1).padStart(2, "0")} · {item.status}</small>
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
