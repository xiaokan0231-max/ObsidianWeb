"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  findInterviewPrepLibrary,
  interviewPrepPlainText,
  type InterviewPrepItem,
} from "@/lib/interview-prep";
import { parseInline } from "@/lib/interview-prep-doc";
import type { Note } from "@/lib/notes";
import { Inlines } from "./prep-doc-render";
import { copySelectionWithoutRuby } from "./ruby-copy";

function GuidanceBlock({
  title,
  text,
  tone,
}: {
  title: string;
  text: string;
  tone?: "warm" | "safe";
}) {
  if (!text) return null;
  return (
    <section className={`prep-guidance-card ${tone ?? ""}`}>
      <h3>{title}</h3>
      <p>{interviewPrepPlainText(text)}</p>
    </section>
  );
}

export default function InterviewPrep({
  notes,
  onOpen,
  initialCardId,
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  /** 本场面试のドキュメントから `[[面接標準回答集#pNN …]]` を踏んで来たときに開くカード */
  initialCardId?: string | null;
}) {
  const library = useMemo(() => findInterviewPrepLibrary(notes), [notes]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  // 飛び込みで来たカードを最初の選択にする。以降は本人の選択が優先される
  const [selectedId, setSelectedId] = useState<string | null>(initialCardId ?? null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const categories = useMemo(
    () => library ? ["全部", ...new Set(library.items.map((item) => item.category))] : ["全部"],
    [library],
  );
  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return (library?.items ?? []).filter((item) => {
      if (category !== "全部" && item.category !== category) return false;
      if (!keyword) return true;
      return [
        item.title,
        item.question,
        item.purpose,
        item.category,
        item.tags.join(" "),
        item.standardAnswer,
      ].some((value) => value.toLocaleLowerCase().includes(keyword));
    });
  }, [category, library, query]);
  const selected =
    filteredItems.find((item) => item.id === selectedId) ??
    filteredItems[0] ??
    null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index)) return;
      if (index < 0 || index >= Math.min(filteredItems.length, 9)) return;
      event.preventDefault();
      setSelectedId(filteredItems[index].id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filteredItems]);

  const copyAnswer = async (item: InterviewPrepItem) => {
    await navigator.clipboard.writeText(interviewPrepPlainText(item.standardAnswer));
    setCopiedId(item.id);
    window.setTimeout(() => setCopiedId((current) => current === item.id ? null : current), 1600);
  };

  if (!library) {
    return (
      <div className="prep-view">
        <div className="prep-empty">
          <span>INTERVIEW PREP</span>
          <h1>还没有标准回答库</h1>
          <p>在 Vault 中建立 type: interview-prep-library 的笔记后，这里会自动读取。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="prep-view">
      <section className="prep-command">
        <label>
          <span aria-hidden="true">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索问题、能力或关键词…"
            aria-label="搜索标准回答"
          />
        </label>
        <div className="prep-categories" role="tablist" aria-label="答案分类">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={category === item}
              className={category === item ? "active" : ""}
              onClick={() => {
                setCategory(item);
                setSelectedId(null);
              }}
            >{item}</button>
          ))}
        </div>
        <button className="prep-source" type="button" onClick={() => onOpen(library.note)}>
          打开 Obsidian 原笔记 ↗
        </button>
      </section>

      {filteredItems.length === 0 ? (
        <p className="prep-no-result">没有符合当前搜索和分类的答案。</p>
      ) : (
        <div className="prep-workbench">
          <nav className="prep-question-list" aria-label="面试问题">
            <header>
              <div>
                <span>{filteredItems.length}</span>
                <small>个参考答案</small>
              </div>
              <p><kbd>1–9</kbd> 快速切换</p>
            </header>
            {filteredItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={selected?.id === item.id ? "active" : ""}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="prep-index">{index < 9 ? index + 1 : "·"}</span>
                <span className="prep-question-copy">
                  <small>{item.category} · {item.priority === "S" ? "优先必练" : `${item.priority}级`}</small>
                  <strong>{item.title}</strong>
                  <em>{item.question}</em>
                </span>
                <i aria-hidden="true">→</i>
              </button>
            ))}
          </nav>

          {selected && (
            <article className="prep-answer">
              <header>
                <div>
                  <div className="prep-answer-meta">
                    <span>{selected.category}</span>
                    <span className={selected.priority === "S" ? "priority" : ""}>
                      {selected.priority === "S" ? "PRIORITY" : `${selected.priority} LEVEL`}
                    </span>
                  </div>
                  <h2>{selected.title}</h2>
                  <p lang="ja">{selected.question}</p>
                </div>
                <span className="prep-answer-id">{selected.id}</span>
              </header>

              {selected.purpose && (
                <p className="prep-purpose">
                  <span>这题要让对方得到什么</span>
                  {interviewPrepPlainText(selected.purpose)}
                </p>
              )}

              <section className="prep-standard" onCopy={copySelectionWithoutRuby}>
                <header>
                  <div>
                    <span>STANDARD REFERENCE</span>
                    <h3>标准参考答案</h3>
                  </div>
                  <button type="button" onClick={() => void copyAnswer(selected)}>
                    {copiedId === selected.id ? "已复制 ✓" : "复制日语答案"}
                  </button>
                </header>
                <p lang="ja"><Inlines nodes={parseInline(selected.standardAnswer)} /></p>
              </section>

              {selected.shortAnswer && (
                <section className="prep-short">
                  <span>30秒版 · 压力下先说这个</span>
                  <p lang="ja">{interviewPrepPlainText(selected.shortAnswer)}</p>
                </section>
              )}

              <div className="prep-guidance-grid">
                <GuidanceBlock title="回答结构" text={selected.structure} />
                <GuidanceBlock title="使用边界" text={selected.boundary} tone="warm" />
              </div>

              {selected.evidence && (
                <section className="prep-evidence">
                  <span>只使用已经确认的事实</span>
                  <p>{interviewPrepPlainText(selected.evidence)}</p>
                </section>
              )}
            </article>
          )}
        </div>
      )}
    </div>
  );
}
