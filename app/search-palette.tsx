"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { stripMarkdown, getTitle, type Note } from "@/lib/notes";
import { getGroup, GROUPS, noteMatches } from "@/lib/memory-atlas-data";
import type { AppView } from "./app-route";
import { useDialogFocus } from "./use-dialog-focus";

const PAGE_COMMANDS: Array<{
  view: AppView;
  label: string;
  description: string;
  keywords: string;
}> = [
  { view: "todo", label: "行动清单", description: "处理今天要做的事", keywords: "行动 清单 todo 开始 完成" },
  { view: "practice", label: "回答重练", description: "开始今天的素振り", keywords: "回答 重练 练习 practice 面试" },
  { view: "jobs", label: "岗位机会", description: "判断下一项応募", keywords: "岗位 机会 求职 応募 job" },
];

/**
 * 全库检索是「跳到任意笔记」的导航工具，不是某一页的主操作，
 * 所以它不再占着顶栏一条 650px 的输入框，而是 ⌘K 唤出的浮层。
 * 关键词是这里的局部 state：资料库那页有自己的搜索框，两者互不干扰。
 */
export default function SearchPalette({
  notes,
  onOpen,
  onQuery,
  onClose,
  onNavigate,
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  onQuery: (query: string) => void;
  onClose: () => void;
  onNavigate: (view: AppView) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(
    () => notes.filter((note) => noteMatches(note, query)).slice(0, 8),
    [notes, query],
  );
  const commands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return PAGE_COMMANDS;
    return PAGE_COMMANDS.filter((command) =>
      `${command.label} ${command.description} ${command.keywords}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [query]);
  const itemCount = commands.length + results.length;

  const activateItem = (index: number) => {
    const command = commands[index];
    if (command) {
      onNavigate(command.view);
      onClose();
      return;
    }
    const note = results[index - commands.length];
    if (note) onOpen(note);
  };

  return (
    <div
      className="search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="搜索记忆库"
      onMouseDown={(event) => {
        // 只认背景本身的点击，面板内部按下再拖到背景松手不算关闭。
        if (event.target === event.currentTarget) onClose();
      }}
    >
    <div className="search-panel" ref={dialogRef} tabIndex={-1}>
      <div className="search-palette-input">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
          onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => Math.min(Math.max(0, itemCount - 1), index + 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            }
            if (event.key === "Enter") activateItem(activeIndex);
          }}
          placeholder="搜索记忆、公司、日语错误…"
          aria-label="搜索关键词"
        />
        <kbd>ESC</kbd>
      </div>
      <div className="search-panel-head">
        <span>{query ? `“${query}” 的结果` : "快捷查询"}</span>
        <button onClick={onClose} aria-label="关闭搜索">×</button>
      </div>
      {commands.length > 0 && (
        <div className="command-shortcuts" aria-label="页面命令">
          {commands.map((command, index) => (
            <button
              key={command.view}
              className={index === activeIndex ? "active" : ""}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => activateItem(index)}
            >
              <strong>{command.label}</strong>
              <small>{command.description}</small>
            </button>
          ))}
        </div>
      )}
      {!query && (
        <div className="saved-queries">
          {/* status 是 7 个枚举值，「進行中」跨其中三个，所以用 | 而不是不存在的「選考中」。 */}
          <button onClick={() => onQuery("status:応募済|書類通過|面接中")}>进行中的选考</button>
          <button onClick={() => onQuery("重要度:高")}>高优先日语错误</button>
          <button onClick={() => onQuery("type:ai-report")}>AI 分析</button>
          <button onClick={() => onQuery("待ち")}>等待结果</button>
        </div>
      )}
      <div className="search-results">
        {results.map((note, index) => (
          <button
            key={note.path}
            className={commands.length + index === activeIndex ? "active" : ""}
            onMouseEnter={() => setActiveIndex(commands.length + index)}
            onClick={() => onOpen(note)}
          >
            <span
              className="result-group"
              style={{ background: GROUPS[getGroup(note.path)].tint, color: GROUPS[getGroup(note.path)].color }}
            >
              {GROUPS[getGroup(note.path)].short}
            </span>
            <span className="result-copy">
              <strong>{getTitle(note)}</strong>
              <small>{stripMarkdown(note.content).slice(0, 92)}</small>
            </span>
            <span className="result-arrow">↗</span>
          </button>
        ))}
        {query && commands.length === 0 && results.length === 0 && (
          <div className="empty-search">没有匹配的记忆，试试更短的关键词。</div>
        )}
      </div>
      <div className="search-help">支持 <code>type:</code>、<code>status:</code>、<code>folder:</code> 组合查询</div>
    </div>
    </div>
  );
}
