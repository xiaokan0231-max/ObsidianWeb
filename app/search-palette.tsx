"use client";

import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { stripMarkdown, getTitle, type Note } from "@/lib/notes";
import { getGroup, GROUPS, noteMatches, type GroupKey } from "@/lib/memory-atlas-data";
import { readRecentPaths, rememberRecentPath } from "@/lib/recent-notes";
import { searchSnippet, splitByTerms, highlightTerms, type SnippetPart } from "@/lib/search-snippet";
import type { UiLocale } from "@/lib/ui-locale";
import type { AppView } from "./app-route";
import { DEFAULT_PAGE_COMMAND_VIEWS, getPageCommands, getSecondaryNavigation } from "./navigation";
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
  pages: string;
  notes: string;
  recent: string;
  updated: string;
  loadingAll: string;
  keys: { move: string; open: string; close: string };
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
    pages: "页面",
    notes: "笔记",
    recent: "最近打开",
    updated: "最近更新",
    loadingAll: "正在载入全部资料…",
    keys: { move: "选择", open: "打开", close: "关闭" },
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
    pages: "ページ",
    notes: "ノート",
    recent: "最近開いたノート",
    updated: "最近更新されたノート",
    loadingAll: "すべての資料を読み込み中…",
    keys: { move: "選択", open: "開く", close: "閉じる" },
    groups: { self: "私", career: "職", study: "学", analysis: "析", system: "規" },
  },
};

/** 外壳交进来的动作（重读、切换主题…）。和页面命令同列，但不混进 PAGE_COMMANDS：那张表每个视图恰好一条。 */
export type PaletteAction = { id: string; label: string; description: string; keywords: string; run: () => void };

/** 日历没有二级菜单，借一个「暦」字和其他页面的印章并排。 */
const CALENDAR_GLYPH = "暦";

function Highlighted({ parts }: { parts: SnippetPart[] }) {
  return <>{parts.map((part, index) => part.hit ? <mark key={index}>{part.text}</mark> : <Fragment key={index}>{part.text}</Fragment>)}</>;
}

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
  allReady = true,
  actions = [],
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  onQuery: (query: string) => void;
  onClose: () => void;
  onNavigate: (view: AppView) => void;
  /**
   * 外壳按视图分 scope 加载笔记，没去过资料库时这里只有一部分。没到齐就说清楚在补，
   * 别让「没有匹配的资料」被读成库里真的没有。
   */
  allReady?: boolean;
  actions?: PaletteAction[];
}) {
  const { locale } = useUiLocale();
  const text = SEARCH_COPY[locale];
  const id = useId().replaceAll(":", "");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  // 最近打开只在浏览器里读：服务端与测试环境没有 localStorage。
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(dialogRef);

  useEffect(() => {
    inputRef.current?.focus();
    const timer = window.setTimeout(() => setRecentPaths(readRecentPaths()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const trimmed = query.trim();
  const recentNotes = useMemo(() => {
    const byPath = new Map(notes.map((note) => [note.path, note]));
    return recentPaths.map((path) => byPath.get(path)).filter((note): note is Note => Boolean(note));
  }, [notes, recentPaths]);
  // 空着时：有最近打开就列它；没有就列最近更新的，而不是笔记数组里碰巧排前面的 8 篇。
  const results = useMemo(() => {
    if (trimmed) return notes.filter((note) => noteMatches(note, query)).slice(0, 8);
    if (recentNotes.length) return recentNotes;
    return [...notes].sort((left, right) => (right.stat?.mtime ?? 0) - (left.stat?.mtime ?? 0)).slice(0, 8);
  }, [notes, query, trimmed, recentNotes]);
  const glyphs = useMemo(() => {
    const map = new Map<AppView, string>([["calendar", CALENDAR_GLYPH]]);
    for (const items of Object.values(getSecondaryNavigation(locale))) items?.forEach((item) => map.set(item.id, item.glyph));
    return map;
  }, [locale]);
  const commands = useMemo(() => {
    const pageCommands = getPageCommands(locale);
    const normalized = trimmed.toLocaleLowerCase();
    if (!normalized) return DEFAULT_PAGE_COMMAND_VIEWS.flatMap((view) =>
      pageCommands.filter((command) => command.view === view),
    );
    return pageCommands.filter((command) =>
      `${command.label} ${command.description} ${command.keywords}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [locale, trimmed]);
  const matchedActions = useMemo(() => {
    const normalized = trimmed.toLocaleLowerCase();
    if (!normalized) return [];
    return actions.filter((action) => `${action.label} ${action.description} ${action.keywords}`.toLocaleLowerCase().includes(normalized));
  }, [actions, trimmed]);
  const terms = useMemo(() => highlightTerms(query), [query]);
  const pageCount = commands.length + matchedActions.length;
  const itemCount = pageCount + results.length;
  const optionId = (index: number) => `${id}-option-${index}`;

  useEffect(() => {
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    // optionId 只依赖 id，列出 id 即可。
  }, [activeIndex, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openNote = (note: Note) => {
    rememberRecentPath(note.path);
    onOpen(note);
  };

  const activateItem = (index: number) => {
    const command = commands[index];
    if (command) {
      onNavigate(command.view);
      onClose();
      return;
    }
    const action = matchedActions[index - commands.length];
    if (action) {
      action.run();
      onClose();
      return;
    }
    const note = results[index - pageCount];
    if (note) openNote(note);
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
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-pages ${id}-notes`}
          aria-activedescendant={itemCount ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
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
            if (event.key === "Enter") { event.preventDefault(); activateItem(activeIndex); }
          }}
          placeholder={text.placeholder}
          aria-label={text.keyword}
        />
        <kbd>ESC</kbd>
      </div>
      <div className="search-panel-head">
        <span>{query ? text.results(query) : text.shortcuts}</span>
        {!allReady && <em className="search-loading" role="status">{text.loadingAll}</em>}
        <button onClick={onClose} aria-label={text.close}>×</button>
      </div>
      {pageCount > 0 && (
        <div className="command-shortcuts" role="listbox" id={`${id}-pages`} aria-label={text.commands}>
          <h3 className="search-group-title">{text.pages}</h3>
          {commands.map((command, index) => (
            <button
              key={command.view}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : ""}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => activateItem(index)}
            >
              <i aria-hidden="true">{glyphs.get(command.view) ?? "·"}</i>
              <strong>{command.label}</strong>
              <small>{command.description}</small>
            </button>
          ))}
          {matchedActions.map((action, offset) => {
            const index = commands.length + offset;
            return (
              <button
                key={action.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                className={`is-action${index === activeIndex ? " active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => activateItem(index)}
              >
                <i aria-hidden="true">⌘</i>
                <strong>{action.label}</strong>
                <small>{action.description}</small>
              </button>
            );
          })}
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
      <div className="search-results" role="listbox" id={`${id}-notes`} aria-label={text.notes}>
        {results.length > 0 && (
          <h3 className="search-group-title">{trimmed ? text.notes : recentNotes.length ? text.recent : text.updated}</h3>
        )}
        {results.map((note, index) => (
          <button
            key={note.path}
            id={optionId(pageCount + index)}
            role="option"
            aria-selected={pageCount + index === activeIndex}
            className={pageCount + index === activeIndex ? "active" : ""}
            onMouseEnter={() => setActiveIndex(pageCount + index)}
            onClick={() => openNote(note)}
          >
            <span
              className="result-group accent-chip"
              style={{ "--accent": GROUPS[getGroup(note.path)].cssVar } as CSSProperties}
            >
              {text.groups[getGroup(note.path)]}
            </span>
            <span className="result-copy">
              <strong><Highlighted parts={splitByTerms(getTitle(note), terms)} /></strong>
              <small><Highlighted parts={searchSnippet(stripMarkdown(note.content), query)} /></small>
            </span>
            <span className="result-arrow">↗</span>
          </button>
        ))}
        {query && pageCount === 0 && results.length === 0 && (
          <div className="empty-search">{allReady ? text.empty : text.loadingAll}</div>
        )}
      </div>
      <div className="search-help">
        <span className="search-keys">
          <kbd>↑</kbd><kbd>↓</kbd> {text.keys.move}
          <kbd>Enter</kbd> {text.keys.open}
          <kbd>Esc</kbd> {text.keys.close}
        </span>
        <span>{text.helpPrefix} <code>type:</code>、<code>status:</code>、<code>folder:</code> {text.helpSuffix}</span>
      </div>
    </div>
    </div>
  );
}
