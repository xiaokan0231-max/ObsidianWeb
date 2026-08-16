"use client";

import { memo, useState } from "react";
import { noteDecisionMeta } from "./note-decision";
import { todoStaleReason } from "@/lib/focus-action";
import { jobSection } from "@/lib/jobs";
import { getString, getType, type Note } from "@/lib/notes";
import {
  todoAction,
  todoAudience,
  todoPriority,
  todoStatus,
  TODO_PRIORITY,
  TODO_STATUS,
} from "@/lib/memory-atlas-data";

function TodoView({
  notes,
  today,
  onOpen,
}: {
  notes: Note[];
  /** 「今日」は殻が持つ。memo 越しなので中で求めると日付を跨いでも凍る（H5 と同型）。 */
  today: string;
  onOpen: (note: Note) => void;
}) {
  const [tab, setTab] = useState<string>("all");
  const [audience, setAudience] = useState<"user" | "system">("user");
  const todos = notes
    .filter((note) => getType(note) === "todo")
    .sort((a, b) => {
      const pa = TODO_PRIORITY[todoPriority(a)]?.rank ?? 9;
      const pb = TODO_PRIORITY[todoPriority(b)]?.rank ?? 9;
      if (pa !== pb) return pa - pb;
      return TODO_STATUS.indexOf(todoStatus(a)) - TODO_STATUS.indexOf(todoStatus(b));
    });

  const scopedTodos = todos.filter((note) => todoAudience(note) === audience);
  const open = scopedTodos.filter((n) => todoStatus(n) !== "完了");
  const visible =
    tab === "all" ? scopedTodos : scopedTodos.filter((n) => todoStatus(n) === tab);
  const statuses = TODO_STATUS.filter((st) => scopedTodos.some((n) => todoStatus(n) === st));
  const systemCount = todos.filter((note) => todoAudience(note) === "system" && todoStatus(note) !== "完了").length;
  const highPriorityOpen = open.filter((note) => todoPriority(note) === "high").length;

  return (
    <section className="todo-view">
      <div className="section-intro page-head page-head-simple">
        <div>
          <span className="eyebrow"><i /> {audience === "user" ? "ACTION LIST" : "INTERNAL MAINTENANCE"}</span>
          <h1>{audience === "user" ? "行动清单" : "系统维护"}</h1>
          <p>
            {audience === "user"
              ? "这里保留全部可执行行动，日常决策仍从总览的“现在先完成这一件事”开始。"
              : "数据补账、同步修复等内部工作只供维护和追溯，不参与首页重点排序。"}
          </p>
        </div>
        <div className="jobs-stat">
          <div><strong>{open.length}</strong><span>未完了</span></div>
          <div><strong>{audience === "user" ? highPriorityOpen : scopedTodos.length}</strong><span>{audience === "user" ? "高优先" : "内部记录"}</span></div>
        </div>
      </div>

      {audience === "system" && (
        <button
          className="todo-back-to-actions"
          onClick={() => {
            setAudience("user");
            setTab("all");
          }}
        >
          ← 返回行动清单
        </button>
      )}

      <div className="jobs-controls">
        <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>全部 <small>{scopedTodos.length}</small></button>
        {statuses.map((st) => (
          <button key={st} className={tab === st ? "active" : ""} onClick={() => setTab(st)}>
            {st} <small>{scopedTodos.filter((n) => todoStatus(n) === st).length}</small>
          </button>
        ))}
      </div>

      <div className="todo-list">
        {visible.map((note) => {
          const pri = todoPriority(note);
          const st = todoStatus(note);
          // 失効＝やること自体が意味を失った待办。赤い催促のまま放置すると
          // 「已逾期」が嘘になるので、収尾の合図に変える。理由で言い方を変える——
          // 案件が終わったのに「事件已过」と出すと、何が終わったのか読めない。
          const stale = st !== "完了" ? todoStaleReason(note, today, notes) : null;
          const decision = noteDecisionMeta(note);
          const why = jobSection(note, "なぜ必要か") || jobSection(note, "課題");
          const what = jobSection(note, "やること");
          return (
            <article
              className={`todo-card pri-${pri} ${st === "完了" ? "is-done" : ""} ${stale ? "is-stale" : ""}`}
              data-semantic={stale ? "fact" : decision.semantic}
              key={note.path}
            >
              <header className="todo-head">
                <div className="todo-titles">
                  <span className={`todo-pri pri-${pri}`}>{TODO_PRIORITY[pri]?.label ?? pri}</span>
                  <h2>{todoAction(note)}</h2>
                </div>
                <span className={`todo-status st-${st}`}>{st}</span>
                {stale && (
                  <span className="todo-stale-badge">
                    {stale === "case-closed" ? "案件已结束 · 可关掉" : "日子已过 · 可关掉"}
                  </span>
                )}
              </header>
              {getString(note.frontmatter.category) && (
                <div className="todo-cat">{getString(note.frontmatter.category)}</div>
              )}
              {why && (
                <div className="job-block">
                  <span className="job-block-label">背景</span>
                  <p>{why.slice(0, 210)}{why.length > 210 ? "…" : ""}</p>
                </div>
              )}
              {what && (
                <div className="job-block">
                  <span className="job-block-label">やること</span>
                  <p>{what.slice(0, 180)}{what.length > 180 ? "…" : ""}</p>
                </div>
              )}
              <footer className="job-card-foot">
                <button className="job-detail" onClick={() => onOpen(note)}>詳細を開く</button>
              </footer>
            </article>
          );
        })}
      </div>

      {audience === "user" && systemCount > 0 && (
        <details className="todo-maintenance-entry">
          <summary>管理工具</summary>
          <div>
            <span>数据补账、同步修复等内部事项</span>
            <button
              onClick={() => {
                setAudience("system");
                setTab("all");
              }}
            >
              查看系统维护 <small>{systemCount}</small> →
            </button>
          </div>
        </details>
      )}

      {scopedTodos.length === 0 && (
        <div className="jobs-empty">
          <p>{audience === "user" ? "当前没有行动。" : "当前没有系统维护事项。"}</p>
          <small>在 Vault 的 <code>20_求職/_TODO/</code> 下新建 <code>type: todo</code> 的笔记即可显示。</small>
        </div>
      )}
      {scopedTodos.length > 0 && visible.length === 0 && <div className="jobs-empty"><p>该状态下没有事项。</p></div>}
    </section>
  );
}

// 外壳的 UI state（⌘K・overlay・移动端菜单）变化时不重渲染整个视圖。
// props 都是稳定引用（notes 整体替换・useCallback 回调・原始值），memo 直接命中。
export default memo(TodoView);
