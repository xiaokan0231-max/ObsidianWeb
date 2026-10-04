"use client";

import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { type UiLocale } from "@/lib/ui-locale";
import { useUiLocale } from "./ui-locale";
import { noteDecisionMeta } from "./note-decision";
import { enumCodec, useUrlState } from "./use-url-state";
import { isTypingTarget } from "@/lib/keyboard";
import { highlightTerms, type SnippetPart } from "@/lib/search-snippet";
import {
  compareRelevance,
  libraryCardSummary,
  libraryHits,
  librarySnippet,
  libraryTitleParts,
  markRecencyBreaks,
  noteHasTags,
  noteTags,
  tagListCodec,
  topLibraryTags,
  type LibraryHits,
  type RecencyBucket,
} from "@/lib/library-search";
import { formatDate, getTitle, getType, type Note } from "@/lib/notes";
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

type LibrarySort = "relevance" | "recent" | "connections" | "title";
/** auto：有关键词时按相关度，没有时按最近更新。只有人明确选过别的排序才写进 URL。 */
type LibrarySortChoice = LibrarySort | "auto";
type LibraryLayout = "card" | "list";

const LIBRARY_SCOPES: LibraryScope[] = ["all", "evidence", "action", "interview", "language", "analysis"];
const SORT_CHOICES: readonly LibrarySortChoice[] = ["auto", "relevance", "recent", "connections", "title"];
const NO_TAGS: string[] = [];

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
  relevance: "相关度",
  reset: "重置筛选",
  tagsTitle: "标签",
  tagsHint: "多选 · 同时满足",
  removeTag: (label: string) => `移除标签筛选：${label}`,
  layout: "显示方式",
  layouts: { card: "卡片", list: "列表" } satisfies Record<LibraryLayout, string>,
  buckets: { today: "今天", week: "本周", month: "本月", older: "更早" } satisfies Record<RecencyBucket, string>,
  hits: (count: number) => `命中 ${count} 处`,
  keyboardHint: "j / k 在结果间移动，Enter 打开。",
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
    sort: "並び替え", recent: "更新日時", connections: "関連の多い順", title: "タイトル順", relevance: "関連度順", reset: "条件をリセット",
    tagsTitle: "タグ", tagsHint: "複数選択・すべて一致", removeTag: (label) => `タグの条件を解除：${label}`,
    layout: "表示形式", layouts: { card: "カード", list: "リスト" },
    buckets: { today: "今日", week: "今週", month: "今月", older: "それ以前" },
    hits: (count) => `${count} 件ヒット`, keyboardHint: "j / k で結果を移動し、Enter で開きます。",
    semantics: { fact: "事実", analysis: "分析", action: "自分の行動", waiting: "外部からの返信待ち", risk: "リスク" },
    trust: { "trust-authority": "確定情報", "trust-evidence": "証拠", "trust-analysis": "分析 / 仮説", "trust-reference": "案内 / 素材" },
    time: "日時", next: "次の行動", openContent: "原文を開いて内容を確認してください。",
    showMore: (count) => `さらに ${count} 件を表示`, remaining: (count) => `残り ${count} 件`, empty: "条件に一致する資料はありません", emptyHint: "キーワードを減らすか、カテゴリと用途の条件をリセットしてください。",
  },
};

const LIBRARY_PAGE_SIZE = 24;

const titleCollator = new Intl.Collator("zh-CN");

// 卡片 / 列表的选择是本机偏好（换台电脑不必跟着走），所以放 localStorage 而不是 URL。
// 用 useSyncExternalStore：服务端与首帧一律是卡片，水合后再换成存下的值，不会对不上。
const LAYOUT_KEY = "echo:library-layout";
const LAYOUT_EVENT = "echo:library-layout";
let layoutInMemory: LibraryLayout | null = null;

function readLayout(): LibraryLayout {
  if (layoutInMemory) return layoutInMemory;
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === "list" ? "list" : "card";
  } catch {
    return "card";
  }
}

function writeLayout(layout: LibraryLayout) {
  // 存储被禁用时仍要能切换：本次打开期间记在内存里。
  layoutInMemory = layout;
  try { window.localStorage.setItem(LAYOUT_KEY, layout); } catch { /* 只在本次打开内生效。 */ }
  window.dispatchEvent(new Event(LAYOUT_EVENT));
}

function subscribeLayout(onChange: () => void) {
  window.addEventListener(LAYOUT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(LAYOUT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function Highlighted({ parts }: { parts: readonly SnippetPart[] }) {
  return <>{parts.map((part, index) => part.hit ? <mark key={index} className="note-hit">{part.text}</mark> : part.text)}</>;
}

/** 入场错峰只给前 24 张做装饰；后面「再显示」出来的直接出现，不让人等。 */
const STAGGERED_CARDS = 24;

type LibraryCardProps = {
  note: Note;
  query: string;
  layout: LibraryLayout;
  index: number;
  hits: LibraryHits | null;
  copy: LibraryCopy;
  onOpen: (note: Note) => void;
};

// 抽成 memo：键盘移动焦点、切换排序时，内容没变的卡片不必重渲染。
const LibraryCard = memo(function LibraryCard({ note, query, layout, index, hits, copy, onOpen }: LibraryCardProps) {
  const group = getGroup(note.path);
  const trust = trustLayer(note);
  const decision = noteDecisionMeta(note);
  const type = getType(note);
  const actionCard = type === "todo" || type === "job-case" || type === "interview-prep";
  const analysisCard = trust.className === "trust-analysis";
  const titleParts = libraryTitleParts(note, query);
  const snippet = librarySnippet(note, query);
  const badge = actionCard ? (
    <span className={`note-semantic semantic-${decision.semantic}`}>{copy.semantics[decision.semantic]}</span>
  ) : (
    <span className={`trust-badge ${trust.className}`}>{copy.trust[trust.className as keyof LibraryCopy["trust"]]}</span>
  );
  const style = {
    "--note-accent": GROUPS[group].color,
    "--card-index": index < STAGGERED_CARDS ? index : 0,
  } as CSSProperties;
  const time = <time dateTime={new Date(note.stat.mtime).toISOString()}>{formatDate(note.stat.mtime)}</time>;
  const hitCount = hits && hits.total > 0 ? <span className="note-card-hits">{copy.hits(hits.total)}</span> : null;

  if (layout === "list") {
    return (
      <button className="note-card note-card--row" data-library-card="" data-semantic={decision.semantic} onClick={() => onOpen(note)} style={style}>
        <span className="note-group"><i />{copy.groups[group]}</span>
        <h2><Highlighted parts={titleParts} /></h2>
        {badge}
        <span className="note-card-source" title={noteFolder(note.path)}>{noteFolder(note.path)}</span>
        {hitCount}
        {time}
      </button>
    );
  }

  return (
    <button className="note-card" data-library-card="" data-semantic={decision.semantic} onClick={() => onOpen(note)} style={style}>
      <div className="note-card-top">
        <span className="note-group"><i />{copy.groups[group]}</span>
        {badge}
      </div>
      <h2><Highlighted parts={titleParts} /></h2>
      {actionCard && !snippet ? (
        <div className="note-card-decision">
          <p>{decision.importance}</p>
          <dl>
            <div><dt>{copy.time}</dt><dd>{decision.when}</dd></div>
            <div><dt>{copy.next}</dt><dd>{decision.next}</dd></div>
          </dl>
        </div>
      ) : (
        <div className={`note-card-summary${analysisCard ? " is-analysis" : ""}${snippet ? " is-snippet" : ""}`}>
          <p>{snippet ? <Highlighted parts={snippet} /> : libraryCardSummary(note) || copy.openContent}</p>
        </div>
      )}
      <div className="note-card-foot">
        <span className="note-card-source" title={noteFolder(note.path)}>{noteFolder(note.path)}</span>
        {hitCount}
        {time}
      </div>
    </button>
  );
});

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
  const [scope, setScope] = useUrlState<LibraryScope>("scope", "all", enumCodec(LIBRARY_SCOPES));
  const [sortChoice, setSortChoice] = useUrlState<LibrarySortChoice>("sort", "auto", enumCodec(SORT_CHOICES));
  const [selectedTags, setSelectedTags] = useUrlState<string[]>("tags", NO_TAGS, tagListCodec);
  const layout = useSyncExternalStore<LibraryLayout>(subscribeLayout, readLayout, () => "card");
  const [visibleLimit, setVisibleLimit] = useState(LIBRARY_PAGE_SIZE);
  const filterDetailsRef = useRef<HTMLDetailsElement>(null);
  const sectionRef = useRef<HTMLElement>(null);

  const hasTerms = highlightTerms(query).length > 0;
  const sort: LibrarySort = sortChoice === "auto" || (sortChoice === "relevance" && !hasTerms)
    ? (hasTerms ? "relevance" : "recent")
    : sortChoice;

  const queryMatched = useMemo(
    () => notes.filter((note) => noteMatches(note, query)),
    [notes, query],
  );
  // 标签是「同时满足」；分区、场景的计数都跟着已选标签走，不然点进去的数字和看到的对不上。
  const tagMatched = useMemo(
    () => (selectedTags.length ? queryMatched.filter((note) => noteHasTags(note, selectedTags)) : queryMatched),
    [queryMatched, selectedTags],
  );
  const groupMatched = useMemo(
    () => tagMatched.filter((note) => filter === "all" || getGroup(note.path) === filter),
    [tagMatched, filter],
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
    () => tagMatched.filter((note) => libraryScopeMatches(note, scope)),
    [tagMatched, scope],
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
  const filteredNotes = useMemo(
    () => groupMatched.filter((note) => libraryScopeMatches(note, scope)),
    [groupMatched, scope],
  );
  // 标签候选取「不看已选标签」的当前范围：选了一个之后，其余候选不至于一下子全消失。
  const tagFacet = useMemo(() => {
    const range = queryMatched.filter((note) =>
      (filter === "all" || getGroup(note.path) === filter) && libraryScopeMatches(note, scope));
    return topLibraryTags(range, selectedTags).map(({ tag }) => ({
      tag,
      count: filteredNotes.filter((note) => noteTags(note).includes(tag)).length,
    }));
  }, [queryMatched, filter, scope, selectedTags, filteredNotes]);
  const hitsByNote = useMemo(
    () => (hasTerms ? new Map(filteredNotes.map((note) => [note, libraryHits(note, query)])) : null),
    [filteredNotes, query, hasTerms],
  );
  const orderedNotes = useMemo(() => {
    return filteredNotes.toSorted((left, right) => {
      if (sort === "relevance" && hitsByNote) {
        return compareRelevance(hitsByNote.get(left)!, hitsByNote.get(right)!) ||
          right.stat.mtime - left.stat.mtime;
      }
      if (sort === "connections") {
        return noteLinks(right).length - noteLinks(left).length ||
          right.stat.mtime - left.stat.mtime;
      }
      if (sort === "title") {
        return titleCollator.compare(getTitle(left), getTitle(right));
      }
      return right.stat.mtime - left.stat.mtime;
    });
  }, [filteredNotes, sort, hitsByNote]);
  const visibleNotes = orderedNotes.slice(0, visibleLimit);
  const rows = sort === "recent" ? markRecencyBreaks(visibleNotes) : null;
  const activeScopeLabel = copy.scopes[scope];
  const hasFilters = Boolean(query) || filter !== "all" || scope !== "all" || selectedTags.length > 0;
  const activeFilterCount = Number(filter !== "all") + Number(scope !== "all") + selectedTags.length;

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 820px)");
    const syncDisclosure = () => {
      if (filterDetailsRef.current) filterDetailsRef.current.open = !mobile.matches;
    };
    syncDisclosure();
    mobile.addEventListener("change", syncDisclosure);
    return () => mobile.removeEventListener("change", syncDisclosure);
  }, []);

  // j / k 在结果间移动焦点，Enter 打开（焦点已在卡片上时由按钮自己响应）。
  // 原笔记详情等对话框打开时让出：页面上有 aria-modal 的层就不处理。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || document.querySelector('[aria-modal="true"]')) return;
      const section = sectionRef.current;
      // 阅读层打开时外壳被设成 inert：这一页还挂着但不该再响应按键。
      if (!section || section.closest("[inert]")) return;
      const cards = [...section.querySelectorAll<HTMLElement>("[data-library-card]")];
      if (!cards.length) return;
      const current = cards.findIndex((card) => card === document.activeElement);
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const next = current < 0
          ? (event.key === "j" ? 0 : cards.length - 1)
          : Math.max(0, Math.min(cards.length - 1, current + (event.key === "j" ? 1 : -1)));
        cards[next].focus({ preventScroll: true });
        cards[next].scrollIntoView({ block: "nearest" });
      } else if (event.key === "Enter" && current < 0 && document.activeElement === document.body) {
        // 焦点不在任何控件上时，Enter 打开结果里的第一篇。
        event.preventDefault();
        cards[0].click();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const resetPage = () => setVisibleLimit(LIBRARY_PAGE_SIZE);
  const resetFilters = () => {
    onQuery("");
    onFilter("all");
    setScope("all");
    setSelectedTags(NO_TAGS);
    resetPage();
  };
  const toggleTag = (tag: string) => {
    setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
    resetPage();
  };
  const chooseSort = (value: LibrarySort) => {
    // 选回「当下的默认」就交还给 auto：之后输入关键词时还能自动切到相关度。
    setSortChoice(value === (hasTerms ? "relevance" : "recent") ? "auto" : value);
  };

  return (
    <section className="library-view" ref={sectionRef}>
      <h1 className="sr-only">{copy.library}</h1>
      <div className="library-workspace">
        <aside className="library-facets" aria-label={copy.filterLabel}>
          {/* 检索这一页的关键词属于这一页，和下面的分区・场景筛选是一组，别放回顶栏。 */}
          <div className="library-search">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => { onQuery(event.target.value); resetPage(); }}
              placeholder={copy.searchPlaceholder}
              aria-label={copy.searchLabel}
            />
            {query && (
              <button onClick={() => { onQuery(""); resetPage(); }} aria-label={copy.clearSearch}>×</button>
            )}
          </div>

          {activeFilterCount > 0 && (
            <div className="library-active-filters" aria-label={copy.selectedFilters}>
              {filter !== "all" && (
                <button onClick={() => { onFilter("all"); resetPage(); }} aria-label={copy.removeGroup(copy.groups[filter])}>
                  {copy.groups[filter]}<span aria-hidden="true">×</span>
                </button>
              )}
              {scope !== "all" && (
                <button onClick={() => { setScope("all"); resetPage(); }} aria-label={copy.removeScope(activeScopeLabel)}>
                  {activeScopeLabel}<span aria-hidden="true">×</span>
                </button>
              )}
              {selectedTags.map((tag) => (
                <button key={tag} onClick={() => toggleTag(tag)} aria-label={copy.removeTag(tag)}>
                  #{tag}<span aria-hidden="true">×</span>
                </button>
              ))}
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
                    onClick={() => { onFilter("all"); resetPage(); }}
                  >
                    <span><i className="all" />{copy.allGroups}</span><strong>{groupCounts.all}</strong>
                  </button>
                  {(Object.keys(GROUPS) as GroupKey[]).map((group) => (
                    <button
                      key={group}
                      className={filter === group ? "active" : ""}
                      onClick={() => { onFilter(group); resetPage(); }}
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
                      onClick={() => { setScope(item); resetPage(); }}
                    >
                      <span>{copy.scopes[item]}</span><strong>{scopeCounts[item]}</strong>
                    </button>
                  ))}
                </div>
              </div>

              {tagFacet.length > 0 && (
                <div className="library-facet-block">
                  <div className="library-facet-title"><span>{copy.tagsTitle}</span><small>{copy.tagsHint}</small></div>
                  <div className="library-tag-list">
                    {tagFacet.map(({ tag, count }) => {
                      const selected = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          aria-pressed={selected}
                          data-zero={!selected && count === 0 ? "true" : undefined}
                          onClick={() => toggleTag(tag)}
                        >
                          <span>#{tag}</span><strong>{count}</strong>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <details className="library-query-help">
                <summary>{copy.searchSyntax}</summary>
                <p>{copy.syntaxBefore} <code>type:</code>、<code>status:</code> {copy.syntaxAnd} <code>folder:</code>{copy.syntaxAfter} <code>⌘K</code>。{copy.keyboardHint}</p>
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
              <div className="library-layout-switch" role="group" aria-label={copy.layout}>
                {(["card", "list"] as const).map((item) => (
                  <button key={item} type="button" aria-pressed={layout === item} onClick={() => writeLayout(item)}>
                    {copy.layouts[item]}
                  </button>
                ))}
              </div>
              <label>
                <span>{copy.sort}</span>
                <select value={sort} onChange={(event) => chooseSort(event.target.value as LibrarySort)}>
                  {hasTerms && <option value="relevance">{copy.relevance}</option>}
                  <option value="recent">{copy.recent}</option>
                  <option value="connections">{copy.connections}</option>
                  <option value="title">{copy.title}</option>
                </select>
              </label>
              {hasFilters && <button className="clear-filter" onClick={resetFilters}>{copy.reset}</button>}
            </div>
          </div>

          <div className={`note-grid${layout === "list" ? " note-grid--list" : ""}`}>
            {(rows ?? visibleNotes.map((note) => ({ item: note, bucket: null, first: false }))).map(({ item: note, bucket, first }, index) => (
              <LibraryRow key={note.path} heading={first && bucket ? copy.buckets[bucket] : null}>
                <LibraryCard
                  note={note}
                  query={query}
                  layout={layout}
                  index={index}
                  hits={hitsByNote?.get(note) ?? null}
                  copy={copy}
                  onOpen={onOpen}
                />
              </LibraryRow>
            ))}
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

/** 分组小标题和卡片同属网格：标题横跨整行并吸顶，卡片照常排。Fragment 带 key，换序时卡片节点不重建。 */
function LibraryRow({ heading, children }: { heading: string | null; children: ReactNode }) {
  return (
    <>
      {heading && <h3 className="library-date-heading">{heading}</h3>}
      {children}
    </>
  );
}

// 外壳的 UI state（⌘K・overlay・移动端菜单）变化时不重渲染整个视圖。
// props 都是稳定引用（notes 整体替换・useCallback 回调・原始值），memo 直接命中。
export default memo(LibraryView);
