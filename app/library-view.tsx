"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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

const LIBRARY_SCOPES: { id: LibraryScope; label: string }[] = [
  { id: "all", label: "全部内容" },
  { id: "evidence", label: "权威与证据" },
  { id: "action", label: "案件与行动" },
  { id: "interview", label: "面试资料" },
  { id: "language", label: "训练资料" },
  { id: "analysis", label: "AI 分析" },
];

const LIBRARY_PAGE_SIZE = 24;

function libraryCardSummary(note: Note) {
  const title = getTitle(note);
  const structured = getString(note.frontmatter.summary) || getString(note.frontmatter.result);
  const plain = stripMarkdown(
    note.content
      .replace(/<!--\s*\/?generated:[^>]*-->/giu, " ")
      .replace(/<!--\s*\/generated\s*-->/giu, " "),
  ).replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "u"), "").trim();
  const value = structured || plain || "打开原文查看内容。";
  return value.length > 150 ? `${value.slice(0, 149)}…` : value;
}

function LibraryView({
  notes,
  filter,
  query,
  onFilter,
  onQuery,
  onOpen,
}: {
  notes: Note[];
  filter: GroupKey | "all";
  query: string;
  onFilter: (filter: GroupKey | "all") => void;
  onQuery: (query: string) => void;
  onOpen: (note: Note) => void;
}) {
  const [scope, setScope] = useState<LibraryScope>(() => {
    const value = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("scope") ?? "";
    return LIBRARY_SCOPES.some((item) => item.id === value) ? value as LibraryScope : "all";
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
        item.id,
        groupMatched.filter((note) => libraryScopeMatches(note, item.id)).length,
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
  const activeScopeLabel = LIBRARY_SCOPES.find((item) => item.id === scope)?.label ?? "全部内容";
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
      <h1 className="sr-only">资料库</h1>
      <div className="library-workspace">
        <aside className="library-facets" aria-label="记忆筛选">
          {/* 检索这一页的关键词属于这一页，和下面的分区・场景筛选是一组，别放回顶栏。 */}
          <div className="library-search">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => { onQuery(event.target.value); setVisibleLimit(LIBRARY_PAGE_SIZE); }}
              placeholder="搜索标题与正文…"
              aria-label="搜索资料库"
            />
            {query && (
              <button onClick={() => onQuery("")} aria-label="清空搜索">×</button>
            )}
          </div>

          {activeFilterCount > 0 && (
            <div className="library-active-filters" aria-label="已选筛选">
              {filter !== "all" && (
                <button onClick={() => { onFilter("all"); setVisibleLimit(LIBRARY_PAGE_SIZE); }} aria-label={`移除分区筛选：${GROUPS[filter].label}`}>
                  {GROUPS[filter].label}<span aria-hidden="true">×</span>
                </button>
              )}
              {scope !== "all" && (
                <button onClick={() => { setScope("all"); setVisibleLimit(LIBRARY_PAGE_SIZE); }} aria-label={`移除场景筛选：${activeScopeLabel}`}>
                  {activeScopeLabel}<span aria-hidden="true">×</span>
                </button>
              )}
            </div>
          )}

          <details className="library-filter-details" ref={filterDetailsRef}>
            <summary><span>筛选{activeFilterCount > 0 ? ` · ${activeFilterCount} 项已选` : ""}</span></summary>
            <div className="library-filter-options">
              <div className="library-facet-block">
                <div className="library-facet-title"><span>内容分区</span><small>按来源目录</small></div>
                <div className="library-group-list">
                  <button
                    className={filter === "all" ? "active" : ""}
                    onClick={() => { onFilter("all"); setVisibleLimit(LIBRARY_PAGE_SIZE); }}
                  >
                    <span><i className="all" />全部分区</span><strong>{groupCounts.all}</strong>
                  </button>
                  {(Object.keys(GROUPS) as GroupKey[]).map((group) => (
                    <button
                      key={group}
                      className={filter === group ? "active" : ""}
                      onClick={() => { onFilter(group); setVisibleLimit(LIBRARY_PAGE_SIZE); }}
                    >
                      <span><i style={{ background: GROUPS[group].color }} />{GROUPS[group].label}</span>
                      <strong>{groupCounts[group]}</strong>
                    </button>
                  ))}
                </div>
              </div>

              <div className="library-facet-block">
                <div className="library-facet-title"><span>使用场景</span><small>可交叉筛选</small></div>
                <div className="library-scope-list">
                  {LIBRARY_SCOPES.map((item) => (
                    <button
                      key={item.id}
                      className={scope === item.id ? "active" : ""}
                      onClick={() => { setScope(item.id); setVisibleLimit(LIBRARY_PAGE_SIZE); }}
                    >
                      <span>{item.label}</span><strong>{scopeCounts[item.id]}</strong>
                    </button>
                  ))}
                </div>
              </div>

              <details className="library-query-help">
                <summary>搜索语法</summary>
                <p>上面的搜索框支持 <code>type:</code>、<code>status:</code> 和 <code>folder:</code>。跳转到任意笔记按 <code>⌘K</code>。</p>
              </details>
            </div>
          </details>
        </aside>

        <div className="library-results">
          <div className="library-result-head">
            <div>
              <small>{query ? `搜索 “${query}”` : `${filter === "all" ? "全部分区" : GROUPS[filter].label} · ${activeScopeLabel}`}</small>
              <h2>{orderedNotes.length} 篇记忆</h2>
            </div>
            <div className="library-result-actions">
              <label>
                <span>排序</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)}>
                  <option value="recent">最近更新</option>
                  <option value="connections">关联最多</option>
                  <option value="title">标题顺序</option>
                </select>
              </label>
              {hasFilters && <button className="clear-filter" onClick={resetFilters}>重置筛选</button>}
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
                    <span className="note-group"><i />{GROUPS[group].label}</span>
                    {actionCard ? (
                      <span className={`note-semantic semantic-${decision.semantic}`}>{decision.label}</span>
                    ) : (
                      <span className={`trust-badge ${trust.className}`}>{trust.label}</span>
                    )}
                  </div>
                  <h2>{getTitle(note)}</h2>
                  {actionCard ? (
                    <div className="note-card-decision">
                      <p>{decision.importance}</p>
                      <dl>
                        <div><dt>时间</dt><dd>{decision.when}</dd></div>
                        <div><dt>下一步</dt><dd>{decision.next}</dd></div>
                      </dl>
                    </div>
                  ) : (
                    <div className={`note-card-summary${analysisCard ? " is-analysis" : ""}`}>
                      <p>{libraryCardSummary(note)}</p>
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
              再显示 {Math.min(LIBRARY_PAGE_SIZE, orderedNotes.length - visibleNotes.length)} 篇
              <span>还有 {orderedNotes.length - visibleNotes.length} 篇</span>
            </button>
          )}

          {orderedNotes.length === 0 && (
            <div className="library-empty">
              <strong>没有符合当前条件的记忆</strong>
              <p>尝试减少关键词，或重置分区与使用场景。</p>
              {hasFilters && <button onClick={resetFilters}>重置筛选</button>}
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
