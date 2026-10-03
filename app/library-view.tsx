"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { type UiLocale } from "@/lib/ui-locale";
import { useUiLocale } from "./ui-locale";
import { noteDecisionMeta } from "./note-decision";
import { formatDate, getString, getTitle, getType, stripMarkdown, type Note } from "@/lib/notes";
import {
  getGroup,
  GROUPS,
  libraryScopeMatches,
  noteFolder,
  noteLinks,
  noteMatches,
  trustLayer,
  type GroupKey,
  type LibraryScope,
} from "@/lib/memory-atlas-data";

type LibrarySort = "recent" | "connections" | "title";

const LIBRARY_SCOPES: LibraryScope[] = ["all", "evidence", "action", "interview", "language", "analysis"];

const libraryZh = {
  library: "资料库",
  filterLabel: "资料筛选",
  searchPlaceholder: "搜索标题与正文…",
  searchLabel: "搜索资料库",
  clearSearch: "清空搜索",
  selectedFilters: "已选筛选",
  removeGroup: (label: string) => `移除分区筛选：${label}`,
  removeScope: (label: string) => `移除场景筛选：${label}`,
  filter: "筛选",
  selectedCount: (count: number) => ` · ${count} 项已选`,
  groupsTitle: "内容分区",
  groupsHint: "按来源目录",
  allGroups: "全部分区",
  groups: { self: "关于我", career: "求职", study: "日语学习", analysis: "AI 分析", system: "系统" } satisfies Record<GroupKey, string>,
  scopesTitle: "使用场景",
  scopesHint: "可交叉筛选",
  scopes: { all: "全部内容", evidence: "权威与证据", action: "案件与行动", interview: "面试资料", language: "训练资料", analysis: "AI 分析" } satisfies Record<LibraryScope, string>,
  searchSyntax: "搜索语法",
  syntaxBefore: "上面的搜索框支持",
  syntaxAnd: "和",
  syntaxAfter: "。跳转到任意笔记按",
  searchResult: (query: string) => `搜索 “${query}”`,
  loading: "正在读取全部资料…",
  resultCount: (count: number) => `${count} 篇资料`,
  sort: "排序",
  recent: "最近更新",
  connections: "关联最多",
  title: "标题顺序",
  reset: "重置筛选",
  semantics: { fact: "事实", analysis: "分析", action: "本人行动", waiting: "外部等待", risk: "风险" },
  trust: { "trust-authority": "权威事实", "trust-evidence": "证据层", "trust-analysis": "分析 / 假设", "trust-reference": "导航 / 素材" },
  time: "时间",
  next: "下一步",
  openContent: "打开原文查看内容。",
  showMore: (count: number) => `再显示 ${count} 篇`,
  remaining: (count: number) => `还有 ${count} 篇`,
  empty: "没有符合当前条件的资料",
  emptyHint: "尝试减少关键词，或重置分区与使用场景。",
};
type LibraryCopy = typeof libraryZh;
const LIBRARY_COPY: Record<UiLocale, LibraryCopy> = {
  "zh-CN": libraryZh,
  ja: {
    library: "資料庫", filterLabel: "資料の絞り込み", searchPlaceholder: "タイトルと本文を検索…", searchLabel: "資料庫を検索", clearSearch: "検索をクリア", selectedFilters: "選択中の条件",
    removeGroup: (label) => `カテゴリの条件を解除：${label}`, removeScope: (label) => `用途の条件を解除：${label}`,
    filter: "絞り込み", selectedCount: (count) => ` · ${count} 件選択中`, groupsTitle: "カテゴリ", groupsHint: "保存先フォルダ別", allGroups: "すべてのカテゴリ",
    groups: { self: "自己紹介", career: "就職活動", study: "日本語学習", analysis: "AI 分析", system: "システム" },
    scopesTitle: "用途", scopesHint: "カテゴリと併用可能",
    scopes: { all: "すべての資料", evidence: "確定情報・証拠", action: "応募案件・行動", interview: "面接資料", language: "練習資料", analysis: "AI 分析" },
    searchSyntax: "検索構文", syntaxBefore: "検索欄では", syntaxAnd: "と", syntaxAfter: "が使えます。任意のノートへ移動するには",
    searchResult: (query) => `「${query}」の検索結果`, loading: "すべての資料を読み込み中…", resultCount: (count) => `${count} 件の資料`,
    sort: "並び替え", recent: "更新日時", connections: "関連の多い順", title: "タイトル順", reset: "条件をリセット",
    semantics: { fact: "事実", analysis: "分析", action: "自分の行動", waiting: "外部からの返信待ち", risk: "リスク" },
    trust: { "trust-authority": "確定情報", "trust-evidence": "証拠", "trust-analysis": "分析 / 仮説", "trust-reference": "案内 / 素材" },
    time: "日時", next: "次の行動", openContent: "原文を開いて内容を確認してください。",
    showMore: (count) => `さらに ${count} 件を表示`, remaining: (count) => `残り ${count} 件`, empty: "条件に一致する資料はありません", emptyHint: "キーワードを減らすか、カテゴリと用途の条件をリセットしてください。",
  },
};

const LIBRARY_PAGE_SIZE = 24;

function libraryCardSummary(note: Note, fallback: string) {
  const title = getTitle(note);
  const structured = getString(note.frontmatter.summary) || getString(note.frontmatter.result);
  const plain = stripMarkdown(
    note.content
      .replace(/<!--\s*\/?generated:[^>]*-->/giu, " ")
      .replace(/<!--\s*\/generated\s*-->/giu, " "),
  ).replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "u"), "").trim();
  const value = structured || plain || fallback;
  return value.length > 150 ? `${value.slice(0, 149)}…` : value;
}

function LibraryView({
  notes,
  filter,
  query,
  onFilter,
  onQuery,
  onOpen,
  loading = false,
}: {
  notes: Note[];
  /** 全量がまだ届いていない：件数を「N 篇」と断言せず読取中と出す。 */
  loading?: boolean;
  filter: GroupKey | "all";
  query: string;
  onFilter: (filter: GroupKey | "all") => void;
  onQuery: (query: string) => void;
  onOpen: (note: Note) => void;
}) {
  const { locale } = useUiLocale();
  const copy = LIBRARY_COPY[locale];
  const [scope, setScope] = useState<LibraryScope>(() => {
    const value = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("scope") ?? "";
    return LIBRARY_SCOPES.some((item) => item === value) ? value as LibraryScope : "all";
  });
  const [sort, setSort] = useState<LibrarySort>(() => {
    const value = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("sort") ?? "";
    return value === "connections" || value === "title" ? value : "recent";
  });
  const [visibleLimit, setVisibleLimit] = useState(LIBRARY_PAGE_SIZE);
  const filterDetailsRef = useRef<HTMLDetailsElement>(null);

  const queryMatched = useMemo(
    () => notes.filter((note) => noteMatches(note, query)),
    [notes, query],
  );
  const groupMatched = useMemo(
    () => queryMatched.filter((note) => filter === "all" || getGroup(note.path) === filter),
    [queryMatched, filter],
  );
  const scopeCounts = useMemo(
    () => Object.fromEntries(
      LIBRARY_SCOPES.map((item) => [
        item,
        groupMatched.filter((note) => libraryScopeMatches(note, item)).length,
      ]),
    ) as Record<LibraryScope, number>,
    [groupMatched],
  );
  const scopeMatched = useMemo(
    () => queryMatched.filter((note) => libraryScopeMatches(note, scope)),
    [queryMatched, scope],
  );
  const groupCounts = useMemo(() => {
    const counts = Object.fromEntries(
      (Object.keys(GROUPS) as GroupKey[]).map((group) => [
        group,
        scopeMatched.filter((note) => getGroup(note.path) === group).length,
      ]),
    ) as Record<GroupKey, number>;
    return { ...counts, all: scopeMatched.length };
  }, [scopeMatched]);
  const orderedNotes = useMemo(() => {
    const result = groupMatched.filter((note) => libraryScopeMatches(note, scope));
    return result.toSorted((left, right) => {
      if (sort === "connections") {
        return noteLinks(right).length - noteLinks(left).length ||
          right.stat.mtime - left.stat.mtime;
      }
      if (sort === "title") {
        return getTitle(left).localeCompare(getTitle(right), "zh-CN");
      }
      return right.stat.mtime - left.stat.mtime;
    });
  }, [groupMatched, scope, sort]);
  const visibleNotes = orderedNotes.slice(0, visibleLimit);
  const activeScopeLabel = copy.scopes[scope];
  const hasFilters = Boolean(query) || filter !== "all" || scope !== "all";
  const activeFilterCount = Number(filter !== "all") + Number(scope !== "all");

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 820px)");
    const syncDisclosure = () => {
      if (filterDetailsRef.current) filterDetailsRef.current.open = !mobile.matches;
    };
    syncDisclosure();
    mobile.addEventListener("change", syncDisclosure);
    return () => mobile.removeEventListener("change", syncDisclosure);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (scope === "all") params.delete("scope");
    else params.set("scope", scope);
    if (sort === "recent") params.delete("sort");
    else params.set("sort", sort);
    const next = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
  }, [scope, sort]);

  const resetFilters = () => {
    onQuery("");
    onFilter("all");
    setScope("all");
    setVisibleLimit(LIBRARY_PAGE_SIZE);
  };

  return (
    <section className="library-view">
      <h1 className="sr-only">{copy.library}</h1>
      <div className="library-workspace">
        <aside className="library-facets" aria-label={copy.filterLabel}>
          {/* 检索这一页的关键词属于这一页，和下面的分区・场景筛选是一组，别放回顶栏。 */}
          <div className="library-search">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => { onQuery(event.target.value); setVisibleLimit(LIBRARY_PAGE_SIZE); }}
              placeholder={copy.searchPlaceholder}
              aria-label={copy.searchLabel}
            />
            {query && (
              <button onClick={() => onQuery("")} aria-label={copy.clearSearch}>×</button>
            )}
          </div>

          {activeFilterCount > 0 && (
            <div className="library-active-filters" aria-label={copy.selectedFilters}>
              {filter !== "all" && (
                <button onClick={() => { onFilter("all"); setVisibleLimit(LIBRARY_PAGE_SIZE); }} aria-label={copy.removeGroup(copy.groups[filter])}>
                  {copy.groups[filter]}<span aria-hidden="true">×</span>
                </button>
              )}
              {scope !== "all" && (
                <button onClick={() => { setScope("all"); setVisibleLimit(LIBRARY_PAGE_SIZE); }} aria-label={copy.removeScope(activeScopeLabel)}>
                  {activeScopeLabel}<span aria-hidden="true">×</span>
                </button>
              )}
            </div>
          )}

          <details className="library-filter-details" ref={filterDetailsRef}>
            <summary><span>{copy.filter}{activeFilterCount > 0 ? copy.selectedCount(activeFilterCount) : ""}</span></summary>
            <div className="library-filter-options">
              <div className="library-facet-block">
                <div className="library-facet-title"><span>{copy.groupsTitle}</span><small>{copy.groupsHint}</small></div>
                <div className="library-group-list">
                  <button
                    className={filter === "all" ? "active" : ""}
                    onClick={() => { onFilter("all"); setVisibleLimit(LIBRARY_PAGE_SIZE); }}
                  >
                    <span><i className="all" />{copy.allGroups}</span><strong>{groupCounts.all}</strong>
                  </button>
                  {(Object.keys(GROUPS) as GroupKey[]).map((group) => (
                    <button
                      key={group}
                      className={filter === group ? "active" : ""}
                      onClick={() => { onFilter(group); setVisibleLimit(LIBRARY_PAGE_SIZE); }}
                    >
                      <span><i style={{ background: GROUPS[group].color }} />{copy.groups[group]}</span>
                      <strong>{groupCounts[group]}</strong>
                    </button>
                  ))}
                </div>
              </div>

              <div className="library-facet-block">
                <div className="library-facet-title"><span>{copy.scopesTitle}</span><small>{copy.scopesHint}</small></div>
                <div className="library-scope-list">
                  {LIBRARY_SCOPES.map((item) => (
                    <button
                      key={item}
                      className={scope === item ? "active" : ""}
                      onClick={() => { setScope(item); setVisibleLimit(LIBRARY_PAGE_SIZE); }}
                    >
                      <span>{copy.scopes[item]}</span><strong>{scopeCounts[item]}</strong>
                    </button>
                  ))}
                </div>
              </div>

              <details className="library-query-help">
                <summary>{copy.searchSyntax}</summary>
                <p>{copy.syntaxBefore} <code>type:</code>、<code>status:</code> {copy.syntaxAnd} <code>folder:</code>{copy.syntaxAfter} <code>⌘K</code>。</p>
              </details>
            </div>
          </details>
        </aside>

        <div className="library-results">
          <div className="library-result-head">
            <div>
              <small>{query ? copy.searchResult(query) : `${filter === "all" ? copy.allGroups : copy.groups[filter]} · ${activeScopeLabel}`}</small>
              <h2>{loading ? copy.loading : copy.resultCount(orderedNotes.length)}</h2>
            </div>
            <div className="library-result-actions">
              <label>
                <span>{copy.sort}</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)}>
                  <option value="recent">{copy.recent}</option>
                  <option value="connections">{copy.connections}</option>
                  <option value="title">{copy.title}</option>
                </select>
              </label>
              {hasFilters && <button className="clear-filter" onClick={resetFilters}>{copy.reset}</button>}
            </div>
          </div>

          <div className="note-grid">
            {visibleNotes.map((note) => {
              const group = getGroup(note.path);
              const trust = trustLayer(note);
              const decision = noteDecisionMeta(note);
              const type = getType(note);
              const actionCard = type === "todo" || type === "job-case" || type === "interview-prep";
              const analysisCard = trust.className === "trust-analysis";
              return (
                <button
                  className="note-card"
                  key={note.path}
                  data-semantic={decision.semantic}
                  onClick={() => onOpen(note)}
                  style={{
                    "--note-accent": GROUPS[group].color,
                  } as CSSProperties}
                >
                  <div className="note-card-top">
                    <span className="note-group"><i />{copy.groups[group]}</span>
                    {actionCard ? (
                      <span className={`note-semantic semantic-${decision.semantic}`}>{copy.semantics[decision.semantic]}</span>
                    ) : (
                      <span className={`trust-badge ${trust.className}`}>{copy.trust[trust.className as keyof LibraryCopy["trust"]]}</span>
                    )}
                  </div>
                  <h2>{getTitle(note)}</h2>
                  {actionCard ? (
                    <div className="note-card-decision">
                      <p>{decision.importance}</p>
                      <dl>
                        <div><dt>{copy.time}</dt><dd>{decision.when}</dd></div>
                        <div><dt>{copy.next}</dt><dd>{decision.next}</dd></div>
                      </dl>
                    </div>
                  ) : (
                    <div className={`note-card-summary${analysisCard ? " is-analysis" : ""}`}>
                      <p>{libraryCardSummary(note, copy.openContent)}</p>
                    </div>
                  )}
                  <div className="note-card-foot">
                    <span className="note-card-source" title={noteFolder(note.path)}>{noteFolder(note.path)}</span>
                    <time dateTime={new Date(note.stat.mtime).toISOString()}>{formatDate(note.stat.mtime)}</time>
                  </div>
                </button>
              );
            })}
          </div>

          {visibleNotes.length < orderedNotes.length && (
            <button
              className="library-load-more"
              onClick={() => setVisibleLimit((current) => current + LIBRARY_PAGE_SIZE)}
            >
              {copy.showMore(Math.min(LIBRARY_PAGE_SIZE, orderedNotes.length - visibleNotes.length))}
              <span>{copy.remaining(orderedNotes.length - visibleNotes.length)}</span>
            </button>
          )}

          {orderedNotes.length === 0 && (
            <div className="library-empty">
              <strong>{copy.empty}</strong>
              <p>{copy.emptyHint}</p>
              {hasFilters && <button onClick={resetFilters}>{copy.reset}</button>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// 外壳的 UI state（⌘K・overlay・移动端菜单）变化时不重渲染整个视圖。
// props 都是稳定引用（notes 整体替换・useCallback 回调・原始值），memo 直接命中。
export default memo(LibraryView);
