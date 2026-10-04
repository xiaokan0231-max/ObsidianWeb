"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { stripMarkdown, getTitle, type Note } from "@/lib/notes";
import { getGroup, GROUPS, noteMatches, type GroupKey } from "@/lib/memory-atlas-data";
import type { UiLocale } from "@/lib/ui-locale";
import type { AppView } from "./app-route";
import { DEFAULT_PAGE_COMMAND_VIEWS, getPageCommands } from "./navigation";
import { useDialogFocus } from "./use-dialog-focus";
import { useUiLocale } from "./ui-locale";

type SearchCopy = {
  dialog: string;
  placeholder: string;
  keyword: string;
  results: (query: string) => string;
  shortcuts: string;
  close: string;
  commands: string;
  activeSelection: string;
  priorityErrors: string;
  analysis: string;
  awaitingResults: string;
  empty: string;
  helpPrefix: string;
  helpSuffix: string;
  groups: Record<GroupKey, string>;
};

const SEARCH_COPY: Record<UiLocale, SearchCopy> = {
  "zh-CN": {
    dialog: "搜索资料库",
    placeholder: "搜索资料、公司、日语错误…",
    keyword: "搜索关键词",
    results: (query) => `“${query}” 的结果`,
    shortcuts: "快捷查询",
    close: "关闭搜索",
    commands: "页面命令",
    activeSelection: "进行中的选考",
    priorityErrors: "高优先日语错误",
    analysis: "AI 分析",
    awaitingResults: "等待结果",
    empty: "没有匹配的资料，试试更短的关键词。",
    helpPrefix: "支持",
    helpSuffix: "组合查询",
    groups: { self: "我", career: "职", study: "学", analysis: "析", system: "规" },
  },
  ja: {
    dialog: "資料ライブラリを検索",
    placeholder: "資料・企業・日本語の誤りを検索…",
    keyword: "検索キーワード",
    results: (query) => `「${query}」の検索結果`,
    shortcuts: "クイック検索",
    close: "検索を閉じる",
    commands: "ページへの移動",
    activeSelection: "進行中の選考",
    priorityErrors: "優先度の高い日本語の誤り",
    analysis: "AI 分析",
    awaitingResults: "結果待ち",
    empty: "一致する資料がありません。短いキーワードを試してください。",
    helpPrefix: "検索条件：",
    helpSuffix: "（組み合わせ可能）",
    groups: { self: "私", career: "職", study: "学", analysis: "析", system: "規" },
  },
};

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
  const { locale } = useUiLocale();
  const text = SEARCH_COPY[locale];
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
    const pageCommands = getPageCommands(locale);
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return DEFAULT_PAGE_COMMAND_VIEWS.flatMap((view) =>
      pageCommands.filter((command) => command.view === view),
    );
    return pageCommands.filter((command) =>
      `${command.label} ${command.description} ${command.keywords}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [locale, query]);
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
      aria-label={text.dialog}
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
          placeholder={text.placeholder}
          aria-label={text.keyword}
        />
        <kbd>ESC</kbd>
      </div>
      <div className="search-panel-head">
        <span>{query ? text.results(query) : text.shortcuts}</span>
        <button onClick={onClose} aria-label={text.close}>×</button>
      </div>
      {commands.length > 0 && (
        <div className="command-shortcuts" aria-label={text.commands}>
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
          <button onClick={() => onQuery("status:応募済|書類通過|面接中")}>{text.activeSelection}</button>
          <button onClick={() => onQuery("重要度:高")}>{text.priorityErrors}</button>
          <button onClick={() => onQuery("type:ai-report")}>{text.analysis}</button>
          <button onClick={() => onQuery("待ち")}>{text.awaitingResults}</button>
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
              className="result-group accent-chip"
              style={{ "--accent": GROUPS[getGroup(note.path)].color } as CSSProperties}
            >
              {text.groups[getGroup(note.path)]}
            </span>
            <span className="result-copy">
              <strong>{getTitle(note)}</strong>
              <small>{stripMarkdown(note.content).slice(0, 92)}</small>
            </span>
            <span className="result-arrow">↗</span>
          </button>
        ))}
        {query && commands.length === 0 && results.length === 0 && (
          <div className="empty-search">{text.empty}</div>
        )}
      </div>
      <div className="search-help">{text.helpPrefix} <code>type:</code>、<code>status:</code>、<code>folder:</code> {text.helpSuffix}</div>
    </div>
    </div>
  );
}
