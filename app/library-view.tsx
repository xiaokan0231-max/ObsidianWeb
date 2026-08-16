"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { noteDecisionMeta } from "./note-decision";
import { formatDate, getTitle, getType, type Note } from "@/lib/notes";
import {
  getGroup,
  GROUPS,
  libraryScopeMatches,
  noteFolder,
  noteLinks,
  noteMatches,
  trustLayer,
  typeLabel,
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

export default function LibraryView({
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
  const [scope, setScope] = useState<LibraryScope>("all");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [visibleLimit, setVisibleLimit] = useState(LIBRARY_PAGE_SIZE);

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

  const resetFilters = () => {
    onQuery("");
    onFilter("all");
    setScope("all");
    setVisibleLimit(LIBRARY_PAGE_SIZE);
  };

  return (
    <section className="library-view">
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

          <div className="library-query-help">
            <span>精确搜索</span>
            <p>上面的搜索框支持 <code>type:</code>、<code>status:</code> 和 <code>folder:</code>。跳转到任意笔记按 <code>⌘K</code>。</p>
          </div>
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
              const links = noteLinks(note).length;
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
                    <span className={`note-semantic semantic-${decision.semantic}`}>{decision.label}</span>
                  </div>
                  <span className="note-card-what">发生了什么</span>
                  <h2>{getTitle(note)}</h2>
                  <div className="note-card-decision">
                    <span>为什么重要</span>
                    <p>{decision.importance}</p>
                    <dl>
                      <div><dt>何时处理</dt><dd>{decision.when}</dd></div>
                      <div><dt>下一步</dt><dd>{decision.next}</dd></div>
                    </dl>
                  </div>
                  <div className="note-card-source">{noteFolder(note.path)}</div>
                  <div className="note-card-foot">
                    <span className={`trust-badge ${trust.className}`}>{trust.label}</span>
                    <span>{typeLabel(getType(note))}</span>
                    <span>{links ? `${links} 条关联` : "暂无关联"}</span>
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
