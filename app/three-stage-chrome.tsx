"use client";

// 3D 舞台共享 chrome：与场景无关的 React 部件与 hooks。
// 这里的 JSX 结构必须与 globals.css 的 .space-graph-* 规则逐字节对齐——
// 两个视图（星图／航道）共用同一套样式，改标记等于同时改两个视图。
// 本模块不 import three，保持 chunk 边界干净。
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function useStageFullscreen(stageRef: RefObject<HTMLDivElement | null>) {
  const [fullscreen, setFullscreen] = useState(false);

  const toggleFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage || !document.fullscreenEnabled) return;
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
      } else {
        await stage.requestFullscreen();
      }
    } catch {
      // 埋め込みブラウザが権限を拒否しても、ステージ本体と他の操作は壊さない。
    }
  }, [stageRef]);

  useEffect(() => {
    const syncFullscreen = () => {
      setFullscreen(document.fullscreenElement === stageRef.current);
    };
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "f" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      void toggleFullscreen();
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("keydown", handleShortcut);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreen);
      document.removeEventListener("keydown", handleShortcut);
    };
  }, [stageRef, toggleFullscreen]);

  return { fullscreen, toggleFullscreen };
}

// 「穿越」编排：portal 动画 → 若在全屏先退出（Fullscreen API 只渲染全屏子树，
// 不退出的话应用根下的笔记抽屉永远不会出现在用户眼前）→ 下一帧再真正打开。
// 请求令牌保证快速连点时只有最后一次生效。
export function useStagePortal(options: {
  stageRef: RefObject<HTMLDivElement | null>;
  onOpen: (id: string) => void;
  canOpen?: (id: string) => boolean;
}) {
  const { stageRef, onOpen, canOpen } = options;
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openingTimerRef = useRef<number | null>(null);
  const openingRequestRef = useRef(0);
  const onOpenRef = useRef(onOpen);
  const canOpenRef = useRef(canOpen);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    canOpenRef.current = canOpen;
  }, [canOpen]);

  const openNode = useCallback((id: string) => {
    if (canOpenRef.current && !canOpenRef.current(id)) return;
    const request = ++openingRequestRef.current;
    if (openingTimerRef.current !== null) {
      window.clearTimeout(openingTimerRef.current);
    }
    setOpeningId(id);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    openingTimerRef.current = window.setTimeout(() => {
      void (async () => {
        if (openingRequestRef.current !== request) return;
        const stage = stageRef.current;
        if (stage && document.fullscreenElement === stage) {
          try {
            await document.exitFullscreen();
          } catch {
            // 某些嵌入式浏览器会拒绝退出请求，仍然继续打开笔记。
          }
        }
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        if (openingRequestRef.current !== request) return;
        onOpenRef.current(id);
        openingTimerRef.current = window.setTimeout(() => {
          if (openingRequestRef.current === request) setOpeningId(null);
        }, reducedMotion ? 80 : 320);
      })();
    }, reducedMotion ? 120 : 680);
  }, [stageRef]);

  useEffect(() => () => {
    openingRequestRef.current += 1;
    if (openingTimerRef.current !== null) {
      window.clearTimeout(openingTimerRef.current);
    }
  }, []);

  return { openingId, openNode };
}

export type StageSearchItem = {
  id: string;
  title: string;
  path: string;
  excerpt: string;
  color: string;
  kindLabel: string;
};

export type StageSearchState<T extends StageSearchItem> = {
  query: string;
  setQuery: (value: string) => void;
  normalizedQuery: string;
  results: T[];
  cursor: number;
  setCursor: (index: number) => void;
  windowStart: number;
  visibleResults: T[];
  handleKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  selectResult: (index: number) => void;
};

// 全文搜索状态机：标题/路径/正文 8:3:1 计分，全部词都命中才算数。
// 并列名次的裁决交给视图注入（星图按连接数、航道按日期）。
export function useStageSearch<T extends StageSearchItem>(options: {
  items: T[];
  inputRef: RefObject<HTMLInputElement | null>;
  onPick: (id: string) => void;
  tiebreak?: (left: T, right: T) => number;
}): StageSearchState<T> {
  const { items, inputRef, onPick, tiebreak } = options;
  const [query, setQueryState] = useState("");
  const [cursor, setCursor] = useState(0);
  const onPickRef = useRef(onPick);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setCursor(0);
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const results = useMemo(() => {
    if (!normalizedQuery) return [];
    const terms = normalizedQuery.split(/\s+/).filter(Boolean);
    return items
      .flatMap((item) => {
        const title = item.title.toLocaleLowerCase();
        const path = item.path.toLocaleLowerCase();
        const content = item.excerpt.toLocaleLowerCase();
        const searchable = `${title}\n${path}\n${content}`;
        if (!terms.every((term) => searchable.includes(term))) return [];
        const score = terms.reduce((total, term) => (
          total
          + (title.includes(term) ? 8 : 0)
          + (path.includes(term) ? 3 : 0)
          + (content.includes(term) ? 1 : 0)
        ), 0);
        return [{ item, score }];
      })
      .toSorted((left, right) => (
        right.score - left.score
        || (tiebreak ? tiebreak(left.item, right.item) : 0)
        || left.item.title.localeCompare(right.item.title)
      ))
      .map(({ item }) => item);
  }, [items, normalizedQuery, tiebreak]);

  const windowStart = Math.min(
    Math.max(0, cursor - 2),
    Math.max(0, results.length - 6),
  );
  const visibleResults = results.slice(windowStart, windowStart + 6);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.key === "Escape"
        && normalizedQuery
        && !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        event.stopPropagation();
        setQueryState("");
        setCursor(0);
        return;
      }
      if (
        event.key !== "/"
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || isEditableTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener("keydown", focusSearch, true);
    return () => document.removeEventListener("keydown", focusSearch, true);
  }, [inputRef, normalizedQuery]);

  const selectResult = useCallback((index: number) => {
    const result = results[index];
    if (!result) return;
    setCursor(index);
    onPickRef.current(result.id);
    inputRef.current?.blur();
  }, [inputRef, results]);

  const handleKeyDown = useCallback((
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((current) => (
        results.length === 0 ? 0 : (current + 1) % results.length
      ));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((current) => (
        results.length === 0
          ? 0
          : (current - 1 + results.length) % results.length
      ));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectResult(cursor);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (query) {
        setQueryState("");
        setCursor(0);
      } else {
        inputRef.current?.blur();
      }
    }
  }, [cursor, inputRef, query, results.length, selectResult]);

  return {
    query,
    setQuery,
    normalizedQuery,
    results,
    cursor,
    setCursor,
    windowStart,
    visibleResults,
    handleKeyDown,
    selectResult,
  };
}

export function StageSearchRadar<T extends StageSearchItem>({
  inputRef,
  search,
  meta,
  resultsId,
  placeholder,
  inputAriaLabel,
  listAriaLabel,
  clearAriaLabel,
  hitUnit,
  enterLabel,
  emptyHint,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  search: StageSearchState<T>;
  meta: (item: T) => string;
  resultsId: string;
  placeholder: string;
  inputAriaLabel: string;
  listAriaLabel: string;
  clearAriaLabel: string;
  hitUnit: string;
  enterLabel: string;
  emptyHint: string;
}) {
  return (
    <div
      className="space-graph-search"
      data-active={search.normalizedQuery ? "true" : "false"}
    >
      <div className="space-graph-search-field">
        <span aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          type="search"
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={search.handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-label={inputAriaLabel}
          aria-controls={resultsId}
          aria-expanded={Boolean(search.normalizedQuery)}
        />
        {search.query ? (
          <button
            type="button"
            aria-label={clearAriaLabel}
            onClick={() => {
              search.setQuery("");
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        ) : (
          <kbd>/</kbd>
        )}
      </div>
      {search.normalizedQuery && (
        <div id={resultsId} className="space-graph-search-results">
          <header>
            <span>FULL TEXT RADAR</span>
            <strong>
              {search.results.length > 0
                ? `${search.results.length} 个${hitUnit}命中`
                : `没有匹配的${hitUnit}`}
            </strong>
          </header>
          {search.results.length > 0 ? (
            <div role="listbox" aria-label={listAriaLabel}>
              {search.visibleResults.map((item, visibleIndex) => {
                const resultIndex = search.windowStart + visibleIndex;
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={resultIndex === search.cursor}
                    key={item.id}
                    data-active={resultIndex === search.cursor ? "true" : "false"}
                    style={{ "--search-accent": item.color } as React.CSSProperties}
                    onMouseEnter={() => search.setCursor(resultIndex)}
                    onClick={() => search.selectResult(resultIndex)}
                  >
                    <i aria-hidden="true" />
                    <span>
                      <strong>{item.title}</strong>
                      <small>{meta(item)}</small>
                    </span>
                    <b>{resultIndex + 1}</b>
                  </button>
                );
              })}
            </div>
          ) : (
            <p>{emptyHint}</p>
          )}
          <footer>
            <span><kbd>↑</kbd><kbd>↓</kbd> 切换</span>
            <span><kbd>Enter</kbd> {enterLabel}</span>
            <span><kbd>Esc</kbd> 清空</span>
          </footer>
        </div>
      )}
    </div>
  );
}

export function StageControls({
  fullscreen,
  fullscreenAriaLabel,
  onToggleFullscreen,
  resetLabel,
  onResetView,
  paused,
  onTogglePaused,
  shortcutHelp,
  onToggleShortcuts,
  extra,
}: {
  fullscreen: boolean;
  fullscreenAriaLabel: string;
  onToggleFullscreen: () => void;
  resetLabel: string;
  onResetView: () => void;
  paused: boolean;
  onTogglePaused: () => void;
  shortcutHelp: boolean;
  onToggleShortcuts: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="space-graph-controls">
      <button
        type="button"
        aria-label={fullscreen ? "退出全屏" : fullscreenAriaLabel}
        onClick={onToggleFullscreen}
      >
        {fullscreen ? "退出全屏" : "全屏"} <kbd>F</kbd>
      </button>
      <button type="button" onClick={onResetView}>
        {resetLabel}
      </button>
      {extra}
      <button
        type="button"
        aria-pressed={paused}
        onClick={onTogglePaused}
      >
        {paused ? "继续呼吸" : "暂停动态"}
      </button>
      <button
        type="button"
        aria-expanded={shortcutHelp}
        onClick={onToggleShortcuts}
      >
        快捷键 <kbd>?</kbd>
      </button>
    </div>
  );
}

export function StageShortcuts({
  title,
  ariaLabel,
  entries,
  onClose,
}: {
  title: string;
  ariaLabel: string;
  entries: { keys: string[]; label: string }[];
  onClose: () => void;
}) {
  return (
    <aside className="space-graph-shortcuts" aria-label={ariaLabel}>
      <header>
        <div><span>COMMAND DECK</span><strong>{title}</strong></div>
        <button type="button" onClick={onClose} aria-label="关闭快捷键">×</button>
      </header>
      <div>
        {entries.map((entry) => (
          <span key={entry.label}>
            {entry.keys.map((key) => <kbd key={key}>{key}</kbd>)}
            <b>{entry.label}</b>
          </span>
        ))}
      </div>
    </aside>
  );
}

export function StagePortal({
  accent,
  kicker,
  title,
  note,
}: {
  accent: string;
  kicker: string;
  title: string;
  note: string;
}) {
  return (
    <div
      className="space-graph-portal"
      style={{ "--node-accent": accent } as React.CSSProperties}
      role="status"
      aria-live="assertive"
    >
      <div className="space-graph-portal-rings" aria-hidden="true">
        <i />
        <i />
        <i />
        <b />
      </div>
      <div>
        <span>{kicker}</span>
        <strong>{title}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}
