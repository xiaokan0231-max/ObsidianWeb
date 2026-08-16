"use client";

import {
  Fragment,
  lazy,
  Suspense,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import InterviewReview from "./interview-review";
import InterviewPrep from "./interview-prep";
import InterviewSession from "./interview-session";
import InterviewSharedAsset from "./interview-shared-asset";
import { isTypingTarget } from "./prep-search";
import JapaneseTraining from "./japanese-training";
import LanguageExpressionCourses from "./language-expression-courses";
import JobsAnalytics from "./jobs-analytics";
import JobsView, { type JobsInitialFilters } from "./jobs-view";
import {
  appViewFromPathname,
  appViewHref,
  type AppView,
} from "./app-route";
import type {
  KnowledgeGraphSceneLink,
  KnowledgeGraphSceneNode,
} from "./knowledge-graph-three";
import { buildFocusBrief, focusDateLabel } from "@/lib/focus-action";
import {
  buildTimelineScene,
  type TimelineSceneEventInput,
  type TimelineSceneNoteInput,
} from "@/lib/timeline-scene";
import { compareJobs, jobSection, toJobCard } from "@/lib/jobs";
import {
  REVIEW_DIMENSION_META,
  type ReviewDimensionKey,
} from "@/lib/review-deep";
import {
  isRoundSpecificAsset,
  type SharedAssetTarget,
} from "@/lib/interview-shared-assets";
import { findInterviewPrepDocs } from "@/lib/interview-prep-doc";
import {
  formatDate,
  getString,
  getTitle,
  getType,
  noteBasename,
  stripFrontmatter,
  stripMarkdown,
  type Note,
} from "@/lib/notes";
import {
  buildKnowledgeGraph,
  GRAPH_RELATION_LABELS,
  selectKnowledgeGraphView,
  type GraphNodeKind,
  type GraphViewMode,
  type KnowledgeGraph,
} from "@/lib/knowledge-graph";
import {
  ACTIVE_JOB_STATUSES,
  buildDerivedData,
  buildReviewPreview,
  calendarCompanyIdentity,
  careerStatus,
  noteLinks,
  getGroup,
  countdownLabel,
  getLatestNoteDate,
  GROUPS,
  libraryScopeMatches,
  localDateKey,
  noteFolder,
  noteMatches,
  notePreview,
  normalizeHeading,
  seeded,
  todoAction,
  todoAudience,
  todoPriority,
  todoStatus,
  TODO_PRIORITY,
  TODO_STATUS,
  trustLayer,
  typeLabel,
  type CalendarEvent,
  type DerivedData,
  type GroupKey,
  type LibraryScope,
} from "@/lib/memory-atlas-data";

const ThreeKnowledgeGraph = lazy(() => import("./knowledge-graph-three"));
const ThreeTimeCorridor = lazy(() => import("./timeline-three"));

export type { Note };

type VaultResponse = {
  connected: boolean;
  fetchedAt?: number;
  error?: string;
  notes: Note[];
};

type View = AppView;
type PrimaryNavId =
  | "overview"
  | "progress"
  | "opportunities"
  | "calendar"
  | "interview"
  | "training"
  | "resources";

type PrimaryNavigationItem = {
  id: PrimaryNavId;
  label: string;
  mobileLabel: string;
  glyph: string;
  target: View;
  views: View[];
};

type SecondaryNavigationItem = {
  id: View;
  label: string;
  // 二级菜单是「章节标签」：汉字印章负责一眼辨认，拉丁小字负责分层，两者都不是装饰的可选项。
  glyph: string;
  caption: string;
};

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

// 一级菜单表达用户目标，不再逐页暴露实现视图。顺序先处理已在进行的案件，再寻找新机会。
const NAVIGATION: PrimaryNavigationItem[] = [
  {
    id: "overview",
    label: "总览",
    mobileLabel: "总览",
    glyph: "⌂",
    target: "overview",
    views: ["overview", "todo"],
  },
  {
    id: "progress",
    label: "求职进展",
    mobileLabel: "进展",
    glyph: "◑",
    target: "analytics",
    views: ["analytics"],
  },
  {
    id: "opportunities",
    label: "岗位机会",
    mobileLabel: "岗位",
    glyph: "★",
    target: "jobs",
    views: ["jobs"],
  },
  {
    id: "calendar",
    label: "日历",
    mobileLabel: "日历",
    glyph: "▦",
    target: "calendar",
    views: ["calendar"],
  },
  {
    id: "interview",
    label: "面试作战",
    mobileLabel: "面试",
    glyph: "戦",
    target: "session",
    views: ["session", "prep", "review"],
  },
  {
    id: "training",
    label: "训练中心",
    mobileLabel: "训练",
    glyph: "語",
    target: "language",
    views: ["language", "topics"],
  },
  {
    id: "resources",
    label: "资料库",
    mobileLabel: "资料",
    glyph: "▤",
    target: "library",
    views: ["library", "timeline", "graph"],
  },
];

const SECONDARY_NAVIGATION: Partial<Record<PrimaryNavId, SecondaryNavigationItem[]>> = {
  interview: [
    { id: "session", label: "当前面试", glyph: "場", caption: "LIVE" },
    { id: "prep", label: "通用准备", glyph: "備", caption: "PLAYBOOK" },
    { id: "review", label: "面试复盘", glyph: "復", caption: "REVIEW" },
  ],
  training: [
    { id: "language", label: "日语训练", glyph: "話", caption: "NIHONGO" },
    { id: "topics", label: "专项训练", glyph: "専", caption: "FOCUS" },
  ],
  resources: [
    { id: "library", label: "全部资料", glyph: "庫", caption: "ARCHIVE" },
    { id: "timeline", label: "时间线", glyph: "歴", caption: "TIMELINE" },
    { id: "graph", label: "关系图", glyph: "網", caption: "GRAPH" },
  ],
};

/**
 * 二级导航住在哪：
 * 资料库的三项是**同一批笔记的三种看法**（列表・时序・关系），切换是浏览时的常态动作，
 * 值得在内容区顶部常驻一条章节标签带。
 * 面试作战・训练中心的子项是三件**不同的事**，内容互不相干，切换属于换任务——
 * 那种跳转归左栏。而且这两个分区的页面自己已经有一层切换（当前面试的 6 章节导航、
 * 专项训练的 5 种练法），再压一条带子就是三层标签叠在 150px 里。
 *
 * 移动端没有左栏，所以那两个分区的带子在 820px 以下会回来（CSS 按 data-placement 切）。
 */
const TOP_BAR_SECTION_IDS = new Set<PrimaryNavId>(["resources"]);

/** 单键快捷键（R）在输入场景必须让路，否则在搜索框里打 r 就会触发重读。 */


const MOBILE_PRIMARY_NAV_IDS = new Set<PrimaryNavId>([
  "overview",
  "progress",
  "opportunities",
  "interview",
]);

/**
 * 侧栏折叠态存在 `<html data-rail>` 上而不是 React state：
 * layout.tsx 里的内联脚本在首帧前就把属性写好，刷新时不会先展开再collapse 抖一下。
 * React 这边只用 useSyncExternalStore 读它，供按钮的 aria / 箭头方向使用。
 */
const RAIL_STORAGE_KEY = "echo:rail";
const RAIL_EVENT = "echo:railchange";

function subscribeRail(onChange: () => void) {
  window.addEventListener(RAIL_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(RAIL_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function isRailCollapsed() {
  return document.documentElement.dataset.rail === "collapsed";
}

function RailToggle() {
  // 服务端与首帧一律按展开渲染，内联脚本已经把视觉切好了。
  const collapsed = useSyncExternalStore(subscribeRail, isRailCollapsed, () => false);

  const toggle = () => {
    const next = isRailCollapsed() ? "expanded" : "collapsed";
    document.documentElement.dataset.rail = next;
    try {
      localStorage.setItem(RAIL_STORAGE_KEY, next);
    } catch {
      // 隐私模式下写不进去也不影响本次会话。
    }
    window.dispatchEvent(new Event(RAIL_EVENT));
  };

  return (
    <button
      type="button"
      className="rail-toggle"
      onClick={toggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? "展开侧边导航" : "收起侧边导航"}
    >
      <i aria-hidden="true">‹</i>
      <span>收起</span>
    </button>
  );
}

/**
 * 本场面试の上に重ねる全画面ビューの外殻。
 *
 * 中身（回答库カード／共通素材）は違っても、閉じた時に元いた場所へ戻す挙動は
 * 同じでなければならない。以前は2つの overlay が同じ useEffect を各自持っていて、
 * 復元のコツを書いた注釈は片方にしか残っていなかった——読む側からは
 * 「注釈の無い方は単純な処理」に見えるので、次に触る人がそちらを削る。
 */
function InterviewOverlay({
  className,
  contentClassName,
  titleId,
  eyebrow,
  title,
  origin,
  onClose,
  children,
}: {
  className: string;
  contentClassName: string;
  titleId: string;
  eyebrow: ReactNode;
  title: ReactNode;
  origin: { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
}) {
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // 背面の本场面试はマウントしたまま残す。ただし history.back() と
    // overflow の復元に任せるだけではブラウザの自動スクロール復元と競合し、
    // 元のカード参照ではなく節の先頭へ戻ることがある。開く直前の座標を正本にする。
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    const scrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    backRef.current?.focus();
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
      previousFocus?.focus({ preventScroll: true });
      const restore = () => window.scrollTo({ left: origin.x, top: origin.y });
      // rAF はバックグラウンドタブで止まる。popstate と sticky 要素の再計算後にも
      // 必ず走る timer で二段固定し、最後にブラウザ本来の設定へ戻す。
      restore();
      window.setTimeout(restore, 0);
      window.setTimeout(() => {
        restore();
        window.history.scrollRestoration = scrollRestoration;
      }, 80);
    };
  }, [origin.x, origin.y]);

  return (
    <section className={className} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="prep-card-overlay-bar">
        <button ref={backRef} type="button" onClick={onClose}>
          <span aria-hidden="true">←</span>
          返回本场面试
        </button>
        <div>
          <small>{eyebrow}</small>
          <strong id={titleId}>{title}</strong>
        </div>
        <span><kbd>Esc</kbd> 也可返回</span>
      </header>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}

function PrepCardOverlay({
  notes,
  cardId,
  origin,
  onOpen,
  onClose,
}: {
  notes: Note[];
  cardId: string;
  origin: { x: number; y: number };
  onOpen: (note: Note) => void;
  onClose: () => void;
}) {
  return (
    <InterviewOverlay
      className="prep-card-overlay"
      contentClassName="prep-card-overlay-content"
      titleId="prep-card-overlay-title"
      eyebrow="STANDARD ANSWER LIBRARY"
      title={`回答库 · ${cardId}`}
      origin={origin}
      onClose={onClose}
    >
      <InterviewPrep key={cardId} notes={notes} onOpen={onOpen} initialCardId={cardId} />
    </InterviewOverlay>
  );
}

function SharedAssetOverlay({
  note,
  target,
  origin,
  onOpenCard,
  onOpenWiki,
  onClose,
}: {
  note: Note;
  target: SharedAssetTarget;
  origin: { x: number; y: number };
  onOpenCard: (cardId: string) => void;
  onOpenWiki: (target: string, section?: string) => void;
  onClose: () => void;
}) {
  return (
    <InterviewOverlay
      className="prep-card-overlay shared-asset-overlay"
      contentClassName="prep-card-overlay-content shared-asset-overlay-content"
      titleId="shared-asset-overlay-title"
      eyebrow={isRoundSpecificAsset(target) ? "THIS ROUND · MOTIVATION" : "COMMON INTERVIEW ASSET"}
      title={target.label}
      origin={origin}
      onClose={onClose}
    >
      <InterviewSharedAsset
        key={`${target.note}#${target.section ?? ""}#${target.defaultSection ?? ""}`}
        note={note}
        target={target}
        onOpenCard={onOpenCard}
        onOpenWiki={onOpenWiki}
      />
    </InterviewOverlay>
  );
}

function MemoryAtlas({ initialView = "overview" }: { initialView?: AppView }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [view, setView] = useState<View>(initialView);
  const [reviewInitialKey, setReviewInitialKey] = useState<string | null>(null);
  // 本场面试を残したまま、その上に全幅で開く回答库カード
  const [prepOverlayCard, setPrepOverlayCard] = useState<string | null>(null);
  const [prepOverlayOrigin, setPrepOverlayOrigin] = useState({ x: 0, y: 0 });
  const [sharedAssetOverlay, setSharedAssetOverlay] = useState<SharedAssetTarget | null>(null);
  const [sharedAssetOrigin, setSharedAssetOrigin] = useState({ x: 0, y: 0 });
  // 求職分析から「進行中 N 件をすべて見る」で飛んできた時だけ、求人一覧に状態フィルタを引き継ぐ。
  const [jobsInitialFilters, setJobsInitialFilters] = useState<JobsInitialFilters | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  /*
   * 资料库那一页的筛选词。以前它和顶栏那个全局搜索框共用同一个 state，
   * 于是「页面状态住在全局 chrome 里」：在顶栏打字，底下的卡片列表跟着变，
   * 同时还弹出一个跳转面板盖在上面。现在搜索面板自己持有局部关键词，
   * 这个 state 只服务资料库自己的搜索框。
   */
  const [libraryQuery, setLibraryQuery] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("q") ?? "",
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState<GroupKey | "all">(() => {
    if (typeof window === "undefined") return "all";
    const group = new URLSearchParams(window.location.search).get("group");
    return group === "all" || (group !== null && group in GROUPS)
      ? group as GroupKey | "all"
      : "all";
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  // 模块间切换不继承上一页的滚动位置，否则新页面会从标题或工具栏中段开始。
  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 });
  }, [view]);

  const loadVault = useCallback(async (options?: { fresh?: boolean }) => {
    setLoading(true);
    setError("");
    try {
      // fresh は R キー専用の「サーバのキャッシュも信じない」通路。通常は増分キャッシュで足りる。
      const url = options?.fresh ? "/api/vault?refresh=1" : "/api/vault";
      const response = await fetch(url, { cache: "no-store" });
      const payload = (await response.json()) as VaultResponse;
      if (!response.ok || !payload.connected) {
        throw new Error(payload.error || "无法连接 Obsidian");
      }
      setNotes(payload.notes);
      setFetchedAt(payload.fetchedAt ?? Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法连接 Obsidian");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 写路由已经把更新后的那条 note 放在响应里，这里只做单条替换。
   * 以前每次写入都 loadVault() 整库重拉（服务端 300 个 GET + 6MB JSON），
   * spinner 还要按住整条链路——为了换一条已经在手里的数据。
   */
  const patchNote = useCallback((note: Note) => {
    setNotes((current) => {
      const index = current.findIndex((item) => item.path === note.path);
      if (index < 0) return [...current, note];
      const next = [...current];
      next[index] = note;
      return next;
    });
  }, []);

  const openPrepCard = useCallback((cardId: string) => {
    // setState→overlay の effect を待つと、focus と overflow の変更後の座標を
    // 拾ってしまう。クリックハンドラ内で、画面が動く前の位置を同期保存する。
    const origin = { x: window.scrollX, y: window.scrollY };
    setPrepOverlayOrigin(origin);
    const currentState =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
    window.history.pushState(
      {
        ...currentState,
        __echoPrepCardOverlay: cardId,
        __echoPrepCardOrigin: origin,
      },
      "",
      window.location.href,
    );
    setPrepOverlayCard(cardId);
  }, []);

  const closePrepCard = useCallback(() => {
    if (window.history.state?.__echoPrepCardOverlay) {
      window.history.back();
      return;
    }
    setPrepOverlayCard(null);
  }, []);

  const openSharedAsset = useCallback((asset: SharedAssetTarget) => {
    const origin = { x: window.scrollX, y: window.scrollY };
    setSharedAssetOrigin(origin);
    const currentState =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
    window.history.pushState(
      {
        ...currentState,
        __echoSharedAssetOverlay: asset,
        __echoSharedAssetOrigin: origin,
      },
      "",
      window.location.href,
    );
    setSharedAssetOverlay(asset);
  }, []);

  const closeSharedAsset = useCallback(() => {
    if (window.history.state?.__echoSharedAssetOverlay) {
      window.history.back();
      return;
    }
    setSharedAssetOverlay(null);
  }, []);

  useEffect(() => {
    const syncOverlays = (state: unknown) => {
      const cardId =
        state && typeof state === "object" && "__echoPrepCardOverlay" in state
          ? (state as { __echoPrepCardOverlay?: unknown }).__echoPrepCardOverlay
          : null;
      const origin =
        state && typeof state === "object" && "__echoPrepCardOrigin" in state
          ? (state as { __echoPrepCardOrigin?: unknown }).__echoPrepCardOrigin
          : null;
      if (
        origin &&
        typeof origin === "object" &&
        "x" in origin &&
        "y" in origin &&
        typeof origin.x === "number" &&
        typeof origin.y === "number"
      ) {
        setPrepOverlayOrigin({ x: origin.x, y: origin.y });
      }
      setPrepOverlayCard(typeof cardId === "string" ? cardId : null);

      const asset =
        state && typeof state === "object" && "__echoSharedAssetOverlay" in state
          ? (state as { __echoSharedAssetOverlay?: unknown }).__echoSharedAssetOverlay
          : null;
      const assetOrigin =
        state && typeof state === "object" && "__echoSharedAssetOrigin" in state
          ? (state as { __echoSharedAssetOrigin?: unknown }).__echoSharedAssetOrigin
          : null;
      if (
        assetOrigin &&
        typeof assetOrigin === "object" &&
        "x" in assetOrigin &&
        "y" in assetOrigin &&
        typeof assetOrigin.x === "number" &&
        typeof assetOrigin.y === "number"
      ) {
        setSharedAssetOrigin({ x: assetOrigin.x, y: assetOrigin.y });
      }
      if (
        asset &&
        typeof asset === "object" &&
        "note" in asset &&
        "label" in asset &&
        "hint" in asset &&
        typeof asset.note === "string" &&
        typeof asset.label === "string" &&
        typeof asset.hint === "string"
      ) {
        setSharedAssetOverlay({
          note: asset.note,
          label: asset.label,
          hint: asset.hint,
          ...("section" in asset && typeof asset.section === "string"
            ? { section: asset.section }
            : {}),
          ...("defaultSection" in asset && typeof asset.defaultSection === "string"
            ? { defaultSection: asset.defaultSection }
            : {}),
          // 履歴から復元する時も scope を落とさない。落とすと「戻る」の後だけ
          // 本轮专属の志望動機が共通素材として表示されていた。
          ...("scope" in asset && asset.scope === "round"
            ? { scope: asset.scope }
            : {}),
        });
      } else {
        setSharedAssetOverlay(null);
      }
    };
    const syncRoute = () => {
      const routedView = appViewFromPathname(window.location.pathname);
      if (!routedView) return;
      setView(routedView);
      if (routedView === "library") {
        const params = new URLSearchParams(window.location.search);
        setLibraryQuery(params.get("q") ?? "");
        const group = params.get("group");
        setGroupFilter(
          group === "all" || (group !== null && group in GROUPS)
            ? group as GroupKey | "all"
            : "all",
        );
      }
      if (routedView === "graph") {
        const group = new URLSearchParams(window.location.search).get("group");
        setGroupFilter(
          group === "all" || (group !== null && group in GROUPS)
            ? group as GroupKey | "all"
            : "all",
        );
      }
    };
    const onPopState = (event: PopStateEvent) => {
      syncOverlays(event.state);
      syncRoute();
    };
    syncOverlays(window.history.state);
    syncRoute();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // rAF は非アクティブなタブでは発火しないため timer で初回ロードする。
    const timer = window.setTimeout(() => void loadVault(), 0);
    return () => window.clearTimeout(timer);
  }, [loadVault]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // 面板挂载后自己聚焦输入框，这里不需要再持有 ref。
        setSearchOpen(true);
      }
      // R = 重读 vault。顶栏不再有按钮，所以这条必须挡住输入场景，否则打字就会触发。
      if (
        event.key.toLowerCase() === "r" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        void loadVault({ fresh: true });
      }
      if (event.key === "Escape") {
        // 回答库の上に原笔记 drawer を開いている時は、一段ずつ閉じる。
        if (selectedPath) {
          setSelectedPath(null);
          setSelectedSection(null);
          return;
        }
        if (prepOverlayCard) {
          event.preventDefault();
          closePrepCard();
          return;
        }
        if (sharedAssetOverlay) {
          event.preventDefault();
          closeSharedAsset();
          return;
        }
        setSearchOpen(false);
        setSelectedPath(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closePrepCard,
    closeSharedAsset,
    loadVault,
    prepOverlayCard,
    selectedPath,
    sharedAssetOverlay,
  ]);

  const notesByBasename = useMemo(() => {
    const index = new Map<string, Note>();
    notes.forEach((note) => index.set(noteBasename(note.path), note));
    return index;
  }, [notes]);

  const selectedNote = selectedPath
    ? notes.find((note) => note.path === selectedPath) ?? null
    : null;
  const sharedAssetNote = sharedAssetOverlay
    ? notes.find((note) => note.path === sharedAssetOverlay.note) ??
      notesByBasename.get(sharedAssetOverlay.note) ??
      null
    : null;

  const openNote = useCallback((note: Note) => {
    setSelectedPath(note.path);
    setSelectedSection(null);
    setSearchOpen(false);
  }, []);

  const openWikiLink = useCallback(
    (target: string, section?: string) => {
      const note = notesByBasename.get(target) ?? notes.find((item) => item.path.endsWith(`/${target}.md`));
      if (note) {
        setSelectedPath(note.path);
        setSelectedSection(section || null);
        setSearchOpen(false);
      }
    },
    [notes, notesByBasename],
  );

  const derived = useMemo(() => buildDerivedData(notes), [notes]);

  // 顶栏「下一件」：只取已确定日程里最近的一场，没有就不占位。
  const nextEvent = useMemo(
    () =>
      derived.calendarEvents
        .filter((event) => event.phase === "upcoming")
        .toSorted((left, right) =>
          `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`),
        )[0] ?? null,
    [derived.calendarEvents],
  );

  const sourceLabel = error ? "连接中断" : loading ? "正在读取" : "Obsidian 已连接";
  const sourceDetail = fetchedAt ? `${formatDate(fetchedAt)} 同步` : "本地数据源";

  const navigateToView = useCallback((
    nextView: View,
    search?: URLSearchParams | string,
    preserveJobsInitialFilters = false,
  ) => {
    if (nextView === "review") setReviewInitialKey(null);
    // ナビから直接来た時は分析画面由来のフィルタを持ち越さない。
    if (nextView === "jobs" && !preserveJobsInitialFilters) setJobsInitialFilters(null);
    setMobileMoreOpen(false);
    window.history.pushState({ __echoAppView: nextView }, "", appViewHref(nextView, search));
    setView(nextView);
  }, []);

  const runSavedQuery = (savedQuery: string) => {
    const params = new URLSearchParams();
    params.set("q", savedQuery);
    setLibraryQuery(savedQuery);
    navigateToView("library", params);
    setSearchOpen(false);
  };

  const syncInterviewSelection = useCallback((company: string, prepPath: string) => {
    const params = new URLSearchParams();
    if (company) params.set("company", company);
    if (prepPath) params.set("prep", prepPath);
    window.history.replaceState(
      { ...(window.history.state ?? {}), __echoAppView: "session" },
      "",
      appViewHref("session", params),
    );
  }, []);

  useEffect(() => {
    if (view !== "library" && view !== "graph") return;
    const params = new URLSearchParams(window.location.search);
    if (view === "library") {
      if (libraryQuery.trim()) params.set("q", libraryQuery.trim());
      else params.delete("q");
    } else {
      params.delete("q");
    }
    if (groupFilter === "all") params.delete("group");
    else params.set("group", groupFilter);
    window.history.replaceState(
      { ...(window.history.state ?? {}), __echoAppView: view },
      "",
      appViewHref(view, params),
    );
  }, [groupFilter, libraryQuery, view]);

  const activeNavigation =
    NAVIGATION.find((item) => item.views.includes(view)) ?? NAVIGATION[0];
  const secondaryNavigation =
    SECONDARY_NAVIGATION[activeNavigation.id] ?? [];
  const secondaryPlacement = TOP_BAR_SECTION_IDS.has(activeNavigation.id)
    ? "bar"
    : "rail";
  const activeSecondaryLabel =
    secondaryNavigation.find((item) => item.id === view)?.label ?? "";
  // 左栏只展开当前分区的子项，顶层始终只有 7 个目标。
  const railSecondary = secondaryPlacement === "rail" ? secondaryNavigation : [];
  const mobilePrimaryNavigation = NAVIGATION.filter((item) =>
    MOBILE_PRIMARY_NAV_IDS.has(item.id),
  );
  const mobileMoreNavigation = NAVIGATION.filter(
    (item) => !MOBILE_PRIMARY_NAV_IDS.has(item.id),
  );
  const mobileMoreActive = mobileMoreNavigation.some((item) =>
    item.views.includes(view),
  );

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="主导航">
        <button className="brand" onClick={() => navigateToView("overview")} aria-label="返回总览">
          <span className="brand-mark">回</span>
          <span className="brand-copy">
            <strong>回声</strong>
            <small>CAREER WAR ROOM</small>
          </span>
        </button>

        <nav className="side-nav">
          {NAVIGATION.map((item) => {
            const isActiveSection = item.views.includes(view);
            const subItems = isActiveSection ? railSecondary : [];
            return (
              <Fragment key={item.id}>
                <button
                  className={isActiveSection ? "active" : ""}
                  onClick={() => navigateToView(item.target)}
                  // 有二级项时当前页是子项（左栏或顶部带子里那个），父项不该也自称 page。
                  aria-current={
                    isActiveSection && secondaryNavigation.length === 0 ? "page" : undefined
                  }
                  // 折叠态把文字视觉隐藏，靠这个属性画出 hover 提示气泡。
                  data-label={item.label}
                >
                  <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>
                  <span>{item.label}</span>
                </button>
                {subItems.length > 0 && (
                  <div
                    className="side-subnav"
                    role="group"
                    aria-label={`${item.label}二级导航`}
                  >
                    {subItems.map((sub) => (
                      <button
                        key={sub.id}
                        className={view === sub.id ? "active" : ""}
                        onClick={() => navigateToView(sub.id)}
                        aria-current={view === sub.id ? "page" : undefined}
                        data-label={sub.label}
                      >
                        <span className="nav-glyph" aria-hidden="true">{sub.glyph}</span>
                        <span>{sub.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </Fragment>
            );
          })}
        </nav>

        <RailToggle />
      </aside>

      <main className="main-stage">
        {/*
          这一行原来是「全局搜索框 + 刷新按钮」，两个都是工具而不是信息，去掉后就空了。
          现在放三样每一页都成立的东西：我在哪、下一件有时限的事、数据源是不是新的。
          两个动作降级为快捷键（⌘K 搜索 / R 重读），提示就写在右侧状态旁边。
        */}
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark">回</span>
            <strong>回声</strong>
          </div>

          <div className="topbar-where">
            <span aria-hidden="true">{activeNavigation.glyph}</span>
            <strong>{activeNavigation.label}</strong>
            {activeSecondaryLabel && <small>{activeSecondaryLabel}</small>}
          </div>

          {/* 当前面试页已经有“本场”倒计时；再放全局下一场会让两家公司同时争夺上下文。 */}
          {nextEvent && view !== "session" && (
            <button
              className="topbar-next"
              onClick={() => navigateToView(nextEvent.phase === "upcoming" ? "calendar" : "calendar")}
              title={`${nextEvent.date}${nextEvent.time ? ` ${nextEvent.time}` : ""} ${nextEvent.label}`}
            >
              <small>下一件</small>
              <em>{countdownLabel(nextEvent.date)}{nextEvent.time ? ` ${nextEvent.time}` : ""}</em>
              <strong>{nextEvent.company}</strong>
              <i aria-hidden="true">→</i>
            </button>
          )}

          <button
            className="topbar-source"
            onClick={() => void loadVault({ fresh: true })}
            disabled={loading}
            title={`${sourceLabel} · ${sourceDetail}（按 R 重新读取）`}
          >
            <span className={`status-dot ${error ? "error" : loading ? "loading" : ""}`} />
            <span className="topbar-source-copy">
              <strong>{sourceLabel}</strong>
              <small>{sourceDetail}</small>
            </span>
          </button>

          <div className="topbar-keys" aria-hidden="true">
            <span><kbd>⌘K</kbd>搜索</span>
            <span><kbd>R</kbd>重读</span>
          </div>
        </header>

        {error ? (
          <ConnectionError error={error} onRetry={() => void loadVault()} />
        ) : loading && notes.length === 0 ? (
          <LoadingState />
        ) : (
          <>
            {secondaryNavigation.length > 0 && (
              <nav
                className="section-nav"
                data-placement={secondaryPlacement}
                aria-label={`${activeNavigation.label}二级导航`}
              >
                {/* 分区名现在由顶栏的位置指示器说，这条带子只负责章节标签本身。 */}
                <div className="section-nav-tabs">
                  {secondaryNavigation.map((item) => (
                    <button
                      key={item.id}
                      className={view === item.id ? "active" : ""}
                      onClick={() => navigateToView(item.id)}
                      aria-current={view === item.id ? "page" : undefined}
                    >
                      <i aria-hidden="true">{item.glyph}</i>
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.caption}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </nav>
            )}
            <div className="view-container">
              {view === "overview" && (
                <Overview
                  notes={notes}
                  derived={derived}
                  onOpen={openNote}
                  onView={navigateToView}
                  onQuery={runSavedQuery}
                  onOpenReview={(key) => {
                    setReviewInitialKey(key ?? null);
                    navigateToView("review");
                  }}
                />
              )}
              {view === "review" && (
                <InterviewReview
                  notes={notes}
                  onVaultChanged={loadVault}
                  onNoteWritten={patchNote}
                  initialSelectedKey={reviewInitialKey}
                />
              )}
              {view === "session" && (
                <InterviewSession
                  notes={notes}
                  onOpen={openNote}
                  onOpenWiki={openWikiLink}
                  onOpenCard={openPrepCard}
                  onOpenAsset={openSharedAsset}
                  initialCompany={typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("company") ?? ""}
                  initialPath={typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("prep") ?? ""}
                  onSelectionChange={syncInterviewSelection}
                />
              )}
              {view === "prep" && (
                <InterviewPrep
                  notes={notes}
                  onOpen={openNote}
                />
              )}
              {view === "language" && (
                <JapaneseTraining onVaultChanged={loadVault} />
              )}
              {view === "topics" && (
                <LanguageExpressionCourses
                  notes={notes}
                  onVaultChanged={loadVault}
                  onNoteWritten={patchNote}
                />
              )}
              {view === "jobs" && (
                <JobsView
                  notes={notes}
                  onOpen={openNote}
                  onVaultChanged={loadVault}
                  onNoteWritten={patchNote}
                  initialFilters={jobsInitialFilters}
                />
              )}
              {view === "analytics" && (
                <JobsAnalytics
                  notes={notes}
                  onOpen={openNote}
                  onViewJobs={(filters) => {
                    setJobsInitialFilters(filters ?? null);
                    const params = new URLSearchParams();
                    if (filters?.statuses?.length) params.set("status", filters.statuses.join(","));
                    if (filters?.ratings?.length) params.set("rating", filters.ratings.join(","));
                    navigateToView("jobs", params, true);
                  }}
                />
              )}
              {view === "todo" && (
                <TodoView notes={notes} onOpen={openNote} />
              )}
              {view === "graph" && (
                <GraphView
                  notes={notes}
                  filter={groupFilter}
                  onFilter={setGroupFilter}
                  onOpen={openNote}
                />
              )}
              {view === "calendar" && (
                <CalendarView
                  events={derived.calendarEvents}
                  notes={notes}
                  onOpen={openNote}
                  onPrepare={(company) => {
                    const params = new URLSearchParams();
                    params.set("company", company);
                    navigateToView("session", params);
                  }}
                />
              )}
              {view === "timeline" && (
                <TimelineView
                  items={derived.timeline}
                  events={derived.calendarEvents}
                  onOpen={openNote}
                />
              )}
              {view === "library" && (
                <LibraryView
                  notes={notes}
                  filter={groupFilter}
                  query={libraryQuery}
                  onFilter={setGroupFilter}
                  onQuery={setLibraryQuery}
                  onOpen={openNote}
                />
              )}
            </div>
          </>
        )}
      </main>

      <nav className="mobile-nav" aria-label="移动端主导航">
        {mobilePrimaryNavigation.map((item) => (
          <button
            key={item.id}
            className={item.views.includes(view) ? "active" : ""}
            onClick={() => navigateToView(item.target)}
            aria-current={item.views.includes(view) ? "page" : undefined}
          >
            <span aria-hidden="true">{item.glyph}</span>
            {item.mobileLabel}
          </button>
        ))}
        <button
          className={mobileMoreActive || mobileMoreOpen ? "active" : ""}
          onClick={() => setMobileMoreOpen((open) => !open)}
          aria-expanded={mobileMoreOpen}
          aria-controls="mobile-more-menu"
        >
          <span aria-hidden="true">•••</span>
          更多
        </button>
      </nav>

      {mobileMoreOpen && (
        <nav id="mobile-more-menu" className="mobile-more-menu" aria-label="移动端更多导航">
          <small>更多功能</small>
          {mobileMoreNavigation.map((item) => (
            <button
              key={item.id}
              className={item.views.includes(view) ? "active" : ""}
              onClick={() => navigateToView(item.target)}
            >
              <span aria-hidden="true">{item.glyph}</span>
              {item.label}
            </button>
          ))}
        </nav>
      )}

      {searchOpen && (
        <SearchPalette
          notes={notes}
          onOpen={openNote}
          onQuery={runSavedQuery}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {sharedAssetOverlay && sharedAssetNote && (
        <SharedAssetOverlay
          note={sharedAssetNote}
          target={sharedAssetOverlay}
          origin={sharedAssetOrigin}
          onOpenCard={openPrepCard}
          onOpenWiki={openWikiLink}
          onClose={closeSharedAsset}
        />
      )}

      {prepOverlayCard && (
        <PrepCardOverlay
          notes={notes}
          cardId={prepOverlayCard}
          origin={prepOverlayOrigin}
          onOpen={openNote}
          onClose={closePrepCard}
        />
      )}

      {selectedNote && (
        <NoteDrawer
          note={selectedNote}
          section={selectedSection}
          allNotes={notes}
          onClose={() => {
            setSelectedPath(null);
            setSelectedSection(null);
          }}
          onOpenWiki={openWikiLink}
          onOpen={openNote}
        />
      )}
    </div>
  );
}

/**
 * 全库检索是「跳到任意笔记」的导航工具，不是某一页的主操作，
 * 所以它不再占着顶栏一条 650px 的输入框，而是 ⌘K 唤出的浮层。
 * 关键词是这里的局部 state：资料库那页有自己的搜索框，两者互不干扰。
 */
function SearchPalette({
  notes,
  onOpen,
  onQuery,
  onClose,
}: {
  notes: Note[];
  onOpen: (note: Note) => void;
  onQuery: (query: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(
    () => notes.filter((note) => noteMatches(note, query)).slice(0, 8),
    [notes, query],
  );

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
    <div className="search-panel">
      <div className="search-palette-input">
        <span className="search-icon" aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter" && results[0]) onOpen(results[0]);
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
        {results.map((note) => (
          <button key={note.path} onClick={() => onOpen(note)}>
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
        {query && results.length === 0 && (
          <div className="empty-search">没有匹配的记忆，试试更短的关键词。</div>
        )}
      </div>
      <div className="search-help">支持 <code>type:</code>、<code>status:</code>、<code>folder:</code> 组合查询</div>
    </div>
    </div>
  );
}

function Overview({
  notes,
  derived,
  onOpen,
  onView,
  onQuery,
  onOpenReview,
}: {
  notes: Note[];
  derived: DerivedData;
  onOpen: (note: Note) => void;
  onView: (view: View) => void;
  onQuery: (query: string) => void;
  onOpenReview: (key?: string) => void;
}) {
  const jobs = useMemo(() => derived.cases.map(toJobCard), [derived.cases]);
  const reviewPreview = useMemo(() => buildReviewPreview(notes), [notes]);
  const currentStageRank: Record<string, number> = { 面接中: 0, 書類通過: 1, 応募済: 2 };
  const currentCases = jobs
    .filter((job) => ACTIVE_JOB_STATUSES.has(job.status))
    .sort(
      (left, right) =>
        (currentStageRank[left.status] ?? 9) - (currentStageRank[right.status] ?? 9) ||
        right.statusUpdated.localeCompare(left.statusUpdated),
    );
  const recentChanges = jobs
    .filter((job) => !ACTIVE_JOB_STATUSES.has(job.status) && job.status !== "未応募")
    .slice(0, 3);
  const focusBrief = useMemo(() => buildFocusBrief(notes), [notes]);
  const primaryFocus = focusBrief.primary;
  const waitingFocus = focusBrief.waiting[0] ?? null;

  const openJobs = jobs
    .filter((job) => job.status === "未応募")
    .sort((left, right) => compareJobs(left, right, "rating"));
  const topSalary = openJobs
    .map((job) => job.salary.max ?? 0)
    .filter((value) => value > 0)
    .sort((left, right) => right - left)[0];
  const openTodos = notes
    .filter(
      (note) =>
        getType(note) === "todo" &&
        todoAudience(note) === "user" &&
        todoStatus(note) !== "完了",
    )
    .sort(
      (left, right) =>
        (TODO_PRIORITY[todoPriority(left)]?.rank ?? 9) - (TODO_PRIORITY[todoPriority(right)]?.rank ?? 9) ||
        getLatestNoteDate(right).localeCompare(getLatestNoteDate(left)),
    );
  const upcoming = derived.calendarEvents.filter((event) => event.phase === "upcoming");
  const scoreDoc = reviewPreview.scoreDoc;
  const actionReviewDoc = reviewPreview.actionDoc;
  const score = scoreDoc?.deepReview ? Math.round(scoreDoc.deepReview.overallScore) : null;
  const dimensionKeys = Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[];

  return (
    <div className="overview-view">
      <section className="memory-hero feature-shell">
        <div className="eyebrow"><span /> TODAY&apos;S BRIEF · {formatDate(localDateKey())}</div>
        <div className="hero-layout">
          <div className="hero-primary">
            <div className="hero-primary-topline">
              <span>现在先完成这一件事</span>
              {primaryFocus && <small>{primaryFocus.context}</small>}
            </div>
            <h1>{primaryFocus?.action ?? "当前没有可执行的重点行动"}</h1>
            {primaryFocus ? (
              <>
                <div className="hero-primary-reason">
                  <span>{primaryFocus.reason}</span>
                  <i>{primaryFocus.status}</i>
                </div>
                <p>
                  {primaryFocus.detail ||
                    "这项行动来自未完成待办；完整背景和执行清单保留在 Vault 原文中。"}
                </p>
              </>
            ) : (
              <p>外部等待不会冒充成你的行动。可以检查行动清单，或继续观察正在推进的案件。</p>
            )}
            <div className="hero-primary-actions">
              <button
                className="primary-action"
                onClick={() => primaryFocus && onOpen(primaryFocus.note)}
                disabled={!primaryFocus}
              >
                {primaryFocus?.cta ?? "查看待办"} <span>→</span>
              </button>
              <button className="hero-secondary-action" onClick={() => onView("todo")}>
                查看全部行动
              </button>
            </div>
          </div>

          <aside className="hero-watch">
            <div className="hero-watch-head">
              <span>等待对方</span>
              <small>{focusBrief.waiting.length} 件观察中</small>
            </div>
            {waitingFocus ? (
              <button type="button" onClick={() => onOpen(waitingFocus.note)}>
                <small>{waitingFocus.company || waitingFocus.waitingFor}</small>
                <strong>{waitingFocus.label}</strong>
                <span>
                  {waitingFocus.followUpAt
                    ? `${focusDateLabel(waitingFocus.followUpAt)}后未回复则跟进`
                    : `${waitingFocus.waitingFor}行动中`}
                </span>
              </button>
            ) : (
              <div className="hero-watch-empty">
                <strong>没有外部回复需要盯住</strong>
                <span>等待事项会与本人可执行行动分开展示。</span>
              </div>
            )}
            <footer>
              <span>{currentCases.length} 个应募案件进行中</span>
              {focusBrief.waiting.length > 1 && <span>另有 {focusBrief.waiting.length - 1} 件等待</span>}
            </footer>
          </aside>
        </div>
        <div className="hero-stats">
          <Stat value={openJobs.length} label="条待应募岗位" />
          <Stat value={currentCases.length} label="个案件进行中" />
          <Stat value={openTodos.length} label="件待办未完成" />
          <Stat value={reviewPreview.pendingDecisions} label="个复盘点待裁定" />
        </div>
      </section>

      <section className="overview-grid">
        <article className="panel review-preview-panel">
          <PanelHeading
            kicker="ANSWER QUALITY"
            title="面试复盘进度"
            action="全部复盘"
            onAction={() => onOpenReview()}
          />
          {reviewPreview.docs.length === 0 ? (
            <p className="panel-empty">还没有可以复盘的整理稿。</p>
          ) : (
            <>
              <div className="review-preview-summary">
                <div className={`review-preview-score ${score === null ? "empty" : score >= 80 ? "high" : score >= 65 ? "mid" : "low"}`}>
                  <strong>{score ?? "—"}</strong>
                  <span>{score === null ? "暂无评分" : "/ 100"}</span>
                </div>
                <div className="review-preview-copy">
                  <small>最近一场已评分</small>
                  <strong>{scoreDoc?.company ?? "等待首份深度复盘"}</strong>
                  <span>{scoreDoc ? `${formatDate(scoreDoc.date)} · ${scoreDoc.round}` : "完成证据裁定后即可生成"}</span>
                  <p>{scoreDoc?.deepReview?.weaknesses[0] ?? "先完成待裁定点，再进入回答质量分析。"}</p>
                </div>
              </div>
              {scoreDoc?.deepReview?.dimensions && (
                <div className="review-preview-dimensions" aria-label="最近一场面试五维评分">
                  {dimensionKeys.map((key) => {
                    const value = Math.round(scoreDoc.deepReview?.dimensions?.[key].score ?? 0);
                    return (
                      <div key={key}>
                        <span>{REVIEW_DIMENSION_META[key].label}</span>
                        <strong>{value}</strong>
                        <i><b style={{ width: `${value}%` }} /></i>
                      </div>
                    );
                  })}
                </div>
              )}
              <dl className="review-preview-stats">
                <div><dt>已深度复盘</dt><dd>{reviewPreview.reviewedCount} / {reviewPreview.docs.length}</dd></div>
                <div><dt>待裁定</dt><dd>{reviewPreview.pendingDecisions}</dd></div>
                <div><dt>可以生成</dt><dd>{reviewPreview.readyCount}</dd></div>
              </dl>
              <button
                className="review-preview-action"
                type="button"
                onClick={() => onOpenReview(actionReviewDoc?.key)}
                disabled={!actionReviewDoc}
              >
                <span>
                  <small>下一步</small>
                  <strong>
                    {actionReviewDoc?.pendingDecisions
                      ? `继续裁定 · ${actionReviewDoc.company}`
                      : actionReviewDoc && !actionReviewDoc.deepReview
                        ? `生成深度复盘 · ${actionReviewDoc.company}`
                        : `查看最近复盘 · ${actionReviewDoc?.company ?? ""}`}
                  </strong>
                </span>
                <b>→</b>
              </button>
            </>
          )}
        </article>

        <article className="panel todo-preview-panel">
          <PanelHeading
            kicker="NEXT ACTIONS"
            title="行动清单"
            action="全部行动"
            onAction={() => onView("todo")}
          />
          <div className="todo-preview-list">
            {openTodos.length === 0 ? (
              <p className="panel-empty">当前没有需要推进的行动。</p>
            ) : (
              openTodos.slice(0, 5).map((note) => (
                <button key={note.path} onClick={() => onOpen(note)}>
                  <span className={`todo-pri pri-${todoPriority(note)}`}>
                    {TODO_PRIORITY[todoPriority(note)]?.label ?? todoPriority(note)}
                  </span>
                  <span className="todo-preview-body">
                    <strong>{todoAction(note)}</strong>
                    <small>{getString(note.frontmatter.category)}</small>
                  </span>
                  <span className={`todo-status st-${todoStatus(note)}`}>{todoStatus(note)}</span>
                </button>
              ))
            )}
          </div>
        </article>

        <article className="panel pipeline-panel wide">
          <PanelHeading
            kicker="CAREER PIPELINE"
            title="求职进行时"
            action="全部案件"
            onAction={() => onView("jobs")}
          />
          <div className="pipeline-split">
            <div className="pipeline-list" aria-label="当前进行中的求职记录">
              {currentCases.slice(0, 6).map((job) => {
                const statusDisplay = careerStatus(job.status);
                const latestDate = job.statusUpdated || job.date || getLatestNoteDate(job.note);
                const nextAction = job.nextAction || job.position || "案件详情";
                return (
                  <button key={job.path} onClick={() => onOpen(job.note)}>
                    <span
                      className={`pipeline-status status-${statusDisplay.tone}`}
                      title={job.status}
                    >
                      {statusDisplay.label}
                    </span>
                    <span className="pipeline-company">
                      <span className="pipeline-company-head">
                        <strong>{job.company}</strong>
                        <time dateTime={latestDate}>{formatDate(latestDate)}</time>
                      </span>
                      <small title={nextAction}>{nextAction}</small>
                    </span>
                    <span className="pipeline-arrow">↗</span>
                  </button>
                );
              })}
              {currentCases.length === 0 && <p className="panel-empty">目前没有进行中的案件。</p>}
            </div>
            <aside className="pipeline-schedule">
              <div className="pipeline-aside-heading">
                <span className="panel-kicker">接下来的面试</span>
                <button onClick={() => onView("calendar")}>打开日历 ↗</button>
              </div>
              <div className="pipeline-upcoming">
                {upcoming.length === 0 ? (
                  <p className="panel-empty">暂无已排期的面试。日历里出现新日程后会自动出现在这里。</p>
                ) : (
                  upcoming.slice(0, 2).map((event) => (
                    <button key={event.id} onClick={() => onOpen(event.note)}>
                      <time dateTime={event.date}>
                        {formatDate(event.date)}{event.time && ` ${event.time}`}
                      </time>
                      <strong>{event.company}</strong>
                      <small>{event.label}</small>
                    </button>
                  ))
                )}
              </div>
              <div className="pipeline-recent">
                <span className="panel-kicker">最近变化</span>
                {recentChanges.map((job) => {
                  const statusDisplay = careerStatus(job.status);
                  const latestDate = job.statusUpdated || job.date || getLatestNoteDate(job.note);
                  return (
                    <button key={job.path} onClick={() => onOpen(job.note)}>
                      <span className={`pipeline-status status-${statusDisplay.tone}`}>{statusDisplay.label}</span>
                      <strong>{job.company}</strong>
                      <time dateTime={latestDate}>{formatDate(latestDate)}</time>
                    </button>
                  );
                })}
              </div>
            </aside>
          </div>
        </article>

        <article className="panel jobs-preview-panel">
          <PanelHeading
            kicker="AI JOB MATCH"
            title="下一个投哪家"
            action="打开筛选台"
            onAction={() => onView("jobs")}
          />
          <div className="jobs-preview-stats">
            <div><strong>{openJobs.length}</strong><span>条未应募</span></div>
            <div><strong>{openJobs.filter((job) => job.rating >= 8).length}</strong><span>8 点以上</span></div>
            <div><strong>{topSalary ? `${topSalary}万` : "—"}</strong><span>未应募最高</span></div>
          </div>
          <div className="jobs-preview-list">
            {openJobs.length === 0 ? (
              <p className="panel-empty">没有未应募的推荐岗位。</p>
            ) : (
              openJobs.slice(0, 4).map((job) => (
                <button key={job.path} onClick={() => onOpen(job.note)}>
                  <span className={`jobs-preview-rating rating-${job.rating}`}>{job.rating}</span>
                  <span className="jobs-preview-body">
                    <strong>{job.company}</strong>
                    <small>{job.position || job.location}</small>
                  </span>
                  <span className="jobs-preview-salary">{job.salary.max ? `${job.salary.max}万` : ""}</span>
                </button>
              ))
            )}
          </div>
        </article>

        <article className="panel learning-panel">
          <PanelHeading
            kicker="LEARNING LOOP"
            title="日语纠错闭环"
            action="打开词典"
            onAction={() => onQuery("folder:30_日本語学習")}
          />
          <div className="learning-visual">
            <div className="learning-ring" style={{ "--progress": `${Math.min(100, (derived.promoted / Math.max(1, derived.totalErrors)) * 100)}%` } as CSSProperties}>
              <div><strong>{derived.promoted}</strong><span>已晋升</span></div>
            </div>
            <div className="learning-copy">
              <p><strong>{derived.totalErrors}</strong> 条逐字稿错误等待复习</p>
              <p><strong>{derived.highPriorityErrors}</strong> 条被标为高优先级</p>
              <button onClick={() => onQuery("重要度:高")}>只看高优先 <span>→</span></button>
            </div>
          </div>
          <div className="learning-flow" aria-label="日语知识晋升流程">
            <span>逐字稿</span><b>→</b><span>误用辞典</span><b>→</b><span>人工确认</span><b>→</b><span>矫正定稿</span>
          </div>
        </article>

        <article className="panel memory-health">
          <PanelHeading
            kicker="MEMORY HEALTH"
            title="记忆健康度"
            action="查看全部"
            onAction={() => onView("library")}
          />
          <div className="health-score-row">
            <div className="health-score">
              <strong>{Math.max(0, derived.selfNotes - derived.incompleteSelf)}</strong>
              <span>/ {derived.selfNotes}</span>
            </div>
            <p>“关于我”权威文档已完成</p>
          </div>
          <div className="health-bars">
            <HealthBar label="证据字段完整度" value={derived.evidenceCompleteness} tone="green" />
            <HealthBar
              label="个人事实完整度"
              value={derived.selfNotes ? ((derived.selfNotes - derived.incompleteSelf) / derived.selfNotes) * 100 : 0}
              tone="orange"
            />
            <HealthBar
              label="关系连接度"
              value={notes.length ? ((notes.length - derived.orphanCount) / notes.length) * 100 : 0}
              tone="violet"
            />
          </div>
          <button className="health-alert" onClick={() => onQuery("folder:10_关于我 迁移时") }>
            <span>!</span>
            <div>
              <strong>{derived.incompleteSelf} 份权威文档仍有待补字段</strong>
              <small>技术栈、STAR、硬性约束与日语定稿应优先人工确认</small>
            </div>
            <b>→</b>
          </button>
        </article>

        <article className="panel graph-preview-panel wide">
          <div className="graph-preview-copy">
            <span className="panel-kicker">KNOWLEDGE GRAPH</span>
            <h2>关系比文件夹<br />更接近思考本身。</h2>
            <p>从公司、复盘、语言错误到 AI 结论，沿着双链找回一段判断是如何形成的。</p>
            <button onClick={() => onView("graph")}>进入关系图 <span>↗</span></button>
          </div>
          <MiniGraph notes={notes} />
        </article>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return <div className="stat" data-zero={value === 0}><strong>{value.toString().padStart(2, "0")}</strong><span>{label}</span></div>;
}

function PanelHeading({
  kicker,
  title,
  action,
  onAction,
}: {
  kicker: string;
  title: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="panel-heading">
      <div><span className="panel-kicker">{kicker}</span><h2>{title}</h2></div>
      <button onClick={onAction}>{action} <span>↗</span></button>
    </div>
  );
}

function HealthBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="health-bar-row">
      <div><span>{label}</span><strong>{safeValue}%</strong></div>
      <div className="health-bar"><i className={tone} style={{ width: `${safeValue}%` }} /></div>
    </div>
  );
}

function MiniGraph({ notes }: { notes: Note[] }) {
  const points = useMemo(() => {
    return notes.slice(0, 24).map((note, index) => {
      const angle = index * 2.399;
      const radius = 12 + (index % 6) * 7;
      return {
        x: 50 + Math.cos(angle) * radius,
        y: 50 + Math.sin(angle) * radius * 0.72,
        color: GROUPS[getGroup(note.path)].color,
      };
    });
  }, [notes]);
  return (
    <div className="mini-graph" aria-hidden="true">
      {points.map((point, index) => (
        <Fragment key={index}>
          <i className="mini-edge" style={{ left: "50%", top: "50%", width: `${Math.hypot(point.x - 50, point.y - 50)}%`, transform: `rotate(${Math.atan2(point.y - 50, point.x - 50)}rad)` }} />
          <b style={{ left: `${point.x}%`, top: `${point.y}%`, background: point.color }} />
        </Fragment>
      ))}
      <strong>{notes.length}</strong>
    </div>
  );
}

function buildKnowledgeGraphScene(
  graph: KnowledgeGraph,
  mode: GraphViewMode,
  filter: GroupKey | "all",
  kind: GraphNodeKind | "all",
): {
  nodes: KnowledgeGraphSceneNode[];
  links: KnowledgeGraphSceneLink[];
} {
  const view = selectKnowledgeGraphView(graph, { mode, group: filter, kind });
  const degree = new Map<string, number>();
  const outbound = new Map<string, number>();
  view.edges.forEach((edge) => {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    outbound.set(edge.source, (outbound.get(edge.source) ?? 0) + 1);
  });

  return {
    nodes: view.nodes.map((node) => {
      const group = node.group as GroupKey;
      const entityColor = node.kind === "company"
        ? "#54b990"
        : node.kind === "skill"
          ? "#e48a58"
          : GROUPS[group].color;
      return {
        id: node.id,
        title: node.label,
        nodeKind: node.kind,
        group,
        groupLabel: GROUPS[group].label,
        color: entityColor,
        degree: degree.get(node.id) ?? 0,
        path: node.pathLabel,
        kindLabel: node.kind === "company"
          ? "公司实体"
          : node.kind === "skill"
            ? "技能实体"
            : typeLabel(node.noteType ?? "note"),
        updatedLabel: node.kind === "note" ? formatDate(node.updatedAt, true) : "实时派生",
        outbound: outbound.get(node.id) ?? 0,
        excerpt: node.excerpt,
        openable: node.openable,
      };
    }),
    links: view.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      relationLabel: GRAPH_RELATION_LABELS[edge.relation],
      directed: edge.directed,
    })),
  };
}

function GraphView({
  notes,
  filter,
  onFilter,
  onOpen,
}: {
  notes: Note[];
  filter: GroupKey | "all";
  onFilter: (filter: GroupKey | "all") => void;
  onOpen: (note: Note) => void;
}) {
  const [renderer, setRenderer] = useState<"space" | "map">("space");
  const [mode, setMode] = useState<GraphViewMode>("semantic");
  const [kind, setKind] = useState<GraphNodeKind | "all">("all");
  const graph = useMemo(() => buildKnowledgeGraph(notes), [notes]);
  const scene = useMemo(
    () => buildKnowledgeGraphScene(graph, mode, filter, kind),
    [filter, graph, kind, mode],
  );
  // 分区ボタンには「今のモードで何件出るか」を出す。0 のまま押せると
  // 「データが入っていない」と誤解する（日本語学習・系统が既定ビューで丸ごと消えていた）。
  const modeCounts = useMemo(() => {
    const counts = Object.fromEntries(
      (Object.keys(GROUPS) as GroupKey[]).map((group) => [group, 0]),
    ) as Record<GroupKey, number>;
    for (const node of selectKnowledgeGraphView(graph, { mode, group: "all", kind }).nodes) {
      counts[node.group as GroupKey] += 1;
    }
    return counts;
  }, [graph, kind, mode]);
  const emptyGroup = filter !== "all" && scene.nodes.length === 0;
  // 「全部关系」に切り替えれば実際に出るときだけ、そう案内する。
  // 空の原因が节点类型フィルタ側のときに「双链だから」と説明すると帰因を誤る。
  const recoverableInAllMode = useMemo(() => {
    if (!emptyGroup || mode !== "semantic") return false;
    return selectKnowledgeGraphView(graph, { mode: "all", group: filter, kind }).nodes.length > 0;
  }, [emptyGroup, filter, graph, kind, mode]);
  const noteByPath = useMemo(
    () => new Map(notes.map((note) => [note.path, note])),
    [notes],
  );
  const openSceneNode = useCallback((id: string) => {
    const note = noteByPath.get(id);
    if (note) onOpen(note);
  }, [noteByPath, onOpen]);
  const fallBackToMap = useCallback(() => setRenderer("map"), []);

  return (
    <section className="graph-view">
      <div className="module-control-row">
        <GroupFilters value={filter} onChange={onFilter} counts={modeCounts} />
        <div className="graph-control-cluster">
          <div className="graph-renderer-toggle" aria-label="关系范围">
            <button type="button" className={mode === "semantic" ? "active" : ""} onClick={() => setMode("semantic")} title="只看 frontmatter 声明的强类型关系（关于公司・派生自・要求技能…）">语义关系</button>
            <button type="button" className={mode === "all" ? "active" : ""} onClick={() => setMode("all")} title="语义关系＋正文里的普通双链，全部显示">全部关系</button>
          </div>
          <div className="graph-renderer-toggle" aria-label="节点类型">
            {(["all", "note", "company", "skill"] as const).map((value) => (
              <button key={value} type="button" className={kind === value ? "active" : ""} onClick={() => setKind(value)}>
                {{ all: "全部", note: "笔记", company: "公司", skill: "技能" }[value]}
              </button>
            ))}
          </div>
          <div className="graph-renderer-toggle" aria-label="关系图显示方式">
            <button type="button" className={renderer === "space" ? "active" : ""} onClick={() => setRenderer("space")}>3D 星图</button>
            <button type="button" className={renderer === "map" ? "active" : ""} onClick={() => setRenderer("map")}>简洁模式</button>
          </div>
        </div>
      </div>
      <div className="graph-layout" data-renderer={renderer}>
        {emptyGroup && (
          <div className="graph-empty-note" role="status">
            <strong>「{GROUPS[filter as GroupKey].label}」在当前视图下没有节点</strong>
            {recoverableInAllMode ? (
              <>
                <p>
                  这个分区的笔记之间只有正文里的普通双链，没有 frontmatter 声明的强类型关系，
                  所以「语义关系」视图不会显示它们。
                </p>
                <button type="button" onClick={() => setMode("all")}>切到「全部关系」查看</button>
              </>
            ) : (
              <p>换一个分区，或把「节点类型」切回「全部」再看。</p>
            )}
          </div>
        )}
        {renderer === "space" ? (
          <Suspense
            fallback={(
              <div className="space-graph-loading space-graph-loading-shell" role="status">
                <i />
                <span>正在载入星图引擎</span>
              </div>
            )}
          >
            <ThreeKnowledgeGraph
              nodes={scene.nodes}
              links={scene.links}
              onOpen={openSceneNode}
              onFallback={fallBackToMap}
            />
          </Suspense>
        ) : (
          <CanvasKnowledgeGraph nodes={scene.nodes} links={scene.links} onOpen={openSceneNode} />
        )}
        <aside className="graph-legend">
          <span>{renderer === "space" ? "星系图例" : "图例"}</span>
          {(Object.keys(GROUPS) as GroupKey[]).map((group) => (
            <button key={group} onClick={() => onFilter(group)}>
              <i style={{ background: GROUPS[group].color }} />
              <span>{GROUPS[group].label}</span>
              <strong>{scene.nodes.filter((node) => node.group === group).length}</strong>
            </button>
          ))}
          <div className="graph-relation-summary">
            <span>{mode === "semantic" ? "强类型关系" : "全部关系"}</span>
            <strong>{scene.links.length}</strong>
          </div>
          <div className="legend-rule"><span>小</span><i /><i /><i /><span>被引用多</span></div>
        </aside>
      </div>
    </section>
  );
}

function GroupFilters({ value, onChange, counts }: {
  value: GroupKey | "all";
  onChange: (value: GroupKey | "all") => void;
  counts?: Record<GroupKey, number>;
}) {
  return (
    <div className="group-filters" aria-label="按分区筛选">
      <button className={value === "all" ? "active" : ""} onClick={() => onChange("all")}>全部</button>
      {(Object.keys(GROUPS) as GroupKey[]).map((group) => {
        const count = counts?.[group];
        return (
          <button
            key={group}
            className={`${value === group ? "active" : ""}${count === 0 ? " empty" : ""}`}
            onClick={() => onChange(group)}
            title={count === 0 ? `当前视图下该分区没有节点` : undefined}
          >
            <i style={{ background: GROUPS[group].color }} />{GROUPS[group].label}
            {count !== undefined && <b>{count}</b>}
          </button>
        );
      })}
    </div>
  );
}

type GraphPoint = {
  node: KnowledgeGraphSceneNode;
  x: number;
  y: number;
  radius: number;
  group: GroupKey;
  degree: number;
};

function CanvasKnowledgeGraph({
  nodes,
  links,
  onOpen,
}: {
  nodes: KnowledgeGraphSceneNode[];
  links: KnowledgeGraphSceneLink[];
  onOpen: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<GraphPoint[]>([]);
  const [hovered, setHovered] = useState<GraphPoint | null>(null);
  const [size, setSize] = useState({ width: 900, height: 620 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const centers: Record<GroupKey, [number, number]> = {
      self: [0.26, 0.28], career: [0.7, 0.3], study: [0.28, 0.72], analysis: [0.7, 0.72], system: [0.5, 0.5],
    };
    const points: GraphPoint[] = nodes.map((node, index) => {
      const group = node.group as GroupKey;
      const [centerX, centerY] = centers[group];
      const angle = seeded(node.id) * Math.PI * 2;
      const ring = 38 + (index % 5) * 21 + seeded(`${node.id}-r`) * 18;
      return {
        node,
        group,
        x: centerX * size.width + Math.cos(angle) * ring,
        y: centerY * size.height + Math.sin(angle) * ring * 0.72,
        radius: 4.5 + Math.min(8, node.degree * 1.25),
        degree: node.degree,
      };
    });
    pointsRef.current = points;
    const pointByPath = new Map(points.map((point) => [point.node.id, point]));
    const labelLimit = nodes.length > 80 ? 4 : 12;
    const labelPaths = new Set(
      (Object.keys(GROUPS) as GroupKey[])
        .flatMap((group) =>
          points
            .filter((point) => point.group === group)
            .toSorted((left, right) => right.degree - left.degree)
            .slice(0, labelLimit)
            .map((point) => point.node.id),
        ),
    );

    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = "#18231e";
    context.fillRect(0, 0, size.width, size.height);
    context.fillStyle = "rgba(255,255,255,.055)";
    for (let x = 18; x < size.width; x += 24) {
      for (let y = 18; y < size.height; y += 24) {
        context.beginPath(); context.arc(x, y, 1, 0, Math.PI * 2); context.fill();
      }
    }

    context.lineWidth = 1;
    links.forEach((link) => {
      const source = pointByPath.get(link.source);
      const target = pointByPath.get(link.target);
      if (!source || !target) return;
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.strokeStyle = link.relation === "references"
        ? "rgba(208, 223, 213, .12)"
        : "rgba(208, 238, 220, .28)";
      context.stroke();
    });

    points.forEach((point) => {
      const active = hovered?.node.id === point.node.id;
      if (active) {
        context.beginPath(); context.arc(point.x, point.y, point.radius + 8, 0, Math.PI * 2);
        context.fillStyle = "rgba(255,255,255,.12)"; context.fill();
      }
      context.beginPath(); context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.fillStyle = point.node.color; context.fill();
      context.strokeStyle = active ? "#fff" : "rgba(255,255,255,.45)";
      context.lineWidth = active ? 2 : 1; context.stroke();
      if (labelPaths.has(point.node.id) || active) {
        context.font = `${active ? 600 : 500} ${active ? 13 : 11}px system-ui, sans-serif`;
        context.fillStyle = active ? "#ffffff" : "rgba(244,245,238,.78)";
        context.textAlign = "center";
        context.fillText(point.node.title.slice(0, 18), point.x, point.y + point.radius + 17);
      }
    });
  }, [hovered, links, nodes, size]);

  const findPoint = (event: {
    currentTarget: HTMLCanvasElement;
    clientX: number;
    clientY: number;
  }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return pointsRef.current.find((point) => Math.hypot(point.x - x, point.y - y) <= point.radius + 8) ?? null;
  };

  return (
    <div className="graph-canvas-wrap">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Obsidian 记忆关系图，共 ${nodes.length} 个节点、${links.length} 条关系`}
        onPointerMove={(event) => setHovered(findPoint(event))}
        onPointerLeave={() => setHovered(null)}
        onClick={(event) => {
          const point = findPoint(event);
          if (point?.node.openable) onOpen(point.node.id);
        }}
      />
      <div className="graph-caption"><span>移动鼠标探索节点</span><strong>{nodes.length} 个节点 · {links.length} 条关系</strong></div>
      {hovered && (
        <div className="graph-tooltip">
          <span style={{ color: hovered.node.color }}>{hovered.node.kindLabel} · {hovered.node.groupLabel}</span>
          <strong>{hovered.node.title}</strong>
          <small>{hovered.degree} 条关系{hovered.node.openable ? " · 点击查看" : " · 派生实体"}</small>
        </div>
      )}
    </div>
  );
}

function CalendarView({
  events,
  notes,
  onOpen,
  onPrepare,
}: {
  events: CalendarEvent[];
  notes: Note[];
  onOpen: (note: Note) => void;
  onPrepare: (company: string) => void;
}) {
  const [month, setMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const today = localDateKey();
  const monthLabel = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(month);
  const firstDayOffset = (month.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(month.getFullYear(), month.getMonth(), index - firstDayOffset + 1);
    return {
      date,
      key: localDateKey(date),
      inMonth: date.getMonth() === month.getMonth(),
    };
  });
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((event) => map.set(event.date, [...(map.get(event.date) ?? []), event]));
    return map;
  }, [events]);
  const horizon = (() => {
    const [year, monthNumber, day] = today.split("-").map(Number);
    return localDateKey(new Date(year, monthNumber - 1, day + 6));
  })();
  const upcomingAll = events.filter((event) => event.phase === "upcoming");
  const upcomingWeek = upcomingAll.filter((event) => event.date <= horizon);
  const upcomingLater = upcomingAll.filter((event) => event.date > horizon).slice(0, 5);
  const recent = events
    .filter((event) => event.phase === "past")
    .sort((left, right) => right.date.localeCompare(left.date) || right.time.localeCompare(left.time))
    .slice(0, 6);
  const prepCompanies = useMemo(
    () => new Set(findInterviewPrepDocs(notes).map((doc) => calendarCompanyIdentity(doc.company))),
    [notes],
  );
  const canPrepare = (event: CalendarEvent) =>
    event.phase === "upcoming" && prepCompanies.has(calendarCompanyIdentity(event.company));

  const moveMonth = (offset: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  return (
    <section className="calendar-view">
      <div className="calendar-layout">
        <div className="calendar-board">
          <div className="calendar-toolbar">
            <div>
              <span>MONTH VIEW</span>
              <h2>{monthLabel}</h2>
            </div>
            <div className="calendar-actions">
              <button onClick={() => moveMonth(-1)} aria-label="上一个月">←</button>
              <button
                onClick={() => {
                  const now = new Date();
                  setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                }}
              >
                今天
              </button>
              <button onClick={() => moveMonth(1)} aria-label="下一个月">→</button>
            </div>
          </div>
          <div className="calendar-grid-scroll">
            <div className="calendar-grid">
              {["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((weekday) => (
                <div className="calendar-weekday" key={weekday}>{weekday}</div>
              ))}
              {days.map((day) => {
                const dayEvents = eventsByDate.get(day.key) ?? [];
                return (
                  <div
                    className={`calendar-day ${day.inMonth ? "" : "outside"} ${day.key === today ? "today" : ""}`}
                    key={day.key}
                  >
                    <div className="calendar-day-number">
                      <time dateTime={day.key}>{day.date.getDate()}</time>
                      {day.key === today && <span>今天</span>}
                    </div>
                    <div className="calendar-day-events">
                      {dayEvents.slice(0, 3).map((event) => (
                        <button
                          className={`calendar-event ${event.phase}`}
                          data-semantic={event.phase === "upcoming" ? "action" : "fact"}
                          key={event.id}
                          onClick={() => onOpen(event.note)}
                          title={`${event.company} · ${event.label}`}
                        >
                          <span>{event.time || event.label}</span>
                          <strong>{event.company}</strong>
                        </button>
                      ))}
                      {dayEvents.length > 3 && <small>另有 {dayEvents.length - 3} 项</small>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="calendar-agenda">
          <AgendaGroup
            title="未来 7 天"
            empty="未来七天没有已确认的安排。"
            events={upcomingWeek}
            onOpen={onOpen}
            onPrepare={onPrepare}
            canPrepare={canPrepare}
          />
          {upcomingLater.length > 0 && (
            <AgendaGroup
              title="稍后安排"
              empty=""
              events={upcomingLater}
              onOpen={onOpen}
              onPrepare={onPrepare}
              canPrepare={canPrepare}
            />
          )}
          <details className="calendar-history">
            <summary>
              <span>最近的面试记录</span>
              <strong>{recent.length}</strong>
            </summary>
            <AgendaGroup
              title="历史事实"
              empty="还没有可识别的历史面试记录。"
              events={recent}
              onOpen={onOpen}
              onPrepare={onPrepare}
              canPrepare={canPrepare}
            />
          </details>
        </aside>
      </div>
    </section>
  );
}

function AgendaGroup({
  title,
  empty,
  events,
  onOpen,
  onPrepare,
  canPrepare,
}: {
  title: string;
  empty: string;
  events: CalendarEvent[];
  onOpen: (note: Note) => void;
  onPrepare: (company: string) => void;
  canPrepare: (event: CalendarEvent) => boolean;
}) {
  return (
    <section className="agenda-group">
      <div className="agenda-heading"><h2>{title}</h2><span>{events.length}</span></div>
      <div className="agenda-list">
        {events.map((event) => {
          const prepare = canPrepare(event);
          return (
          <button
            key={event.id}
            data-semantic={event.phase === "upcoming" ? "action" : "fact"}
            onClick={() => prepare ? onPrepare(event.company) : onOpen(event.note)}
          >
            <time dateTime={event.date}>
              <strong>{event.date.slice(8)}</strong>
              <span>{formatDate(event.date)}</span>
            </time>
            <span className="agenda-copy">
              <small>{event.time ? `${event.time} · ${event.label}` : event.label}</small>
              <strong>{event.company}</strong>
              <em>{prepare ? "下一步 · 打开面试准备" : event.phase === "upcoming" ? "下一步 · 查看安排原文" : "事实记录 · 查看原文"}</em>
            </span>
            <span className={`agenda-dot ${event.phase}`} />
          </button>
        );})}
        {events.length === 0 && <p className="agenda-empty">{empty}</p>}
      </div>
    </section>
  );
}

// 时间线视图：默认 3D「时之航道」，与关系图同一套「3D / 简洁」切换与降级路径。
// 场景数据在这里由 Note 映射为纯数据（与 buildKnowledgeGraphScene 同分工），
// 传给 lazy 的 ThreeTimeCorridor；WebGL 失败时退回原来的 2D 列表。
function TimelineView({
  items,
  events,
  onOpen,
}: {
  items: { note: Note; date: string }[];
  events: CalendarEvent[];
  onOpen: (note: Note) => void;
}) {
  const [renderer, setRenderer] = useState<"corridor" | "list">("corridor");
  const scene = useMemo(() => buildTimelineScene(
    items.map(({ note, date }): TimelineSceneNoteInput => {
      const group = getGroup(note.path);
      return {
        id: note.path,
        title: getTitle(note),
        group,
        groupLabel: GROUPS[group].label,
        color: GROUPS[group].color,
        path: note.path.replace(/\.md$/i, ""),
        kindLabel: typeLabel(getType(note)),
        updatedLabel: formatDate(note.stat.mtime, true),
        excerpt: stripMarkdown(stripFrontmatter(note.content))
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim(),
        date,
      };
    }),
    events.map((event): TimelineSceneEventInput => ({
      id: event.id,
      noteId: event.note.path,
      date: event.date,
      time: event.time,
      company: event.company,
      label: event.label,
      phase: event.phase,
    })),
  ), [events, items]);
  const noteByPath = useMemo(() => {
    const map = new Map<string, Note>();
    items.forEach(({ note }) => map.set(note.path, note));
    events.forEach((event) => map.set(event.note.path, event.note));
    return map;
  }, [events, items]);
  const openSceneNote = useCallback((id: string) => {
    const note = noteByPath.get(id);
    if (note) onOpen(note);
  }, [noteByPath, onOpen]);
  const fallBackToList = useCallback(() => setRenderer("list"), []);

  return (
    <section className="timeline-view">
      <div className="module-control-row">
        <div className="graph-renderer-toggle" aria-label="时间线显示方式">
          <button
            type="button"
            className={renderer === "corridor" ? "active" : ""}
            aria-pressed={renderer === "corridor"}
            onClick={() => setRenderer("corridor")}
          >
            3D 航道
          </button>
          <button
            type="button"
            className={renderer === "list" ? "active" : ""}
            aria-pressed={renderer === "list"}
            onClick={() => setRenderer("list")}
          >
            简洁模式
          </button>
        </div>
      </div>
      {renderer === "corridor" ? (
        <div className="time-corridor-layout">
          <Suspense
            fallback={(
              <div className="space-graph-loading space-graph-loading-shell" role="status">
                <i />
                <span>正在铺设时间航道</span>
              </div>
            )}
          >
            <ThreeTimeCorridor
              scene={scene}
              onOpen={openSceneNote}
              onFallback={fallBackToList}
            />
          </Suspense>
        </div>
      ) : (
        <TimelineListView items={items} onOpen={onOpen} />
      )}
    </section>
  );
}

function TimelineListView({ items, onOpen }: { items: { note: Note; date: string }[]; onOpen: (note: Note) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, { note: Note; date: string }[]>();
    items.forEach((item) => map.set(item.date, [...(map.get(item.date) ?? []), item]));
    return Array.from(map.entries());
  }, [items]);
  // 外层 section 由 TimelineView 壳负责，这里只渲染列表本体，DOM 结构与改造前一致。
  return (
    <div className="timeline">
        {groups.map(([date, dateItems]) => (
          <div className="timeline-day" key={date}>
            <div className="timeline-date"><strong>{formatDate(date)}</strong><span>{date}</span></div>
            <div className="timeline-line"><i /></div>
            <div className="timeline-items">
              {dateItems.map(({ note }) => (
                <button key={note.path} onClick={() => onOpen(note)}>
                  <span className="timeline-type" style={{ color: GROUPS[getGroup(note.path)].color }}>{typeLabel(getType(note))}</span>
                  <strong>{getTitle(note)}</strong>
                  <p>{stripMarkdown(note.content).slice(0, 150)}</p>
                  <span className="timeline-link">阅读原文 ↗</span>
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

type DecisionSemantic = "fact" | "analysis" | "action" | "waiting" | "risk";

const DECISION_SEMANTICS: Record<DecisionSemantic, { label: string; next: string }> = {
  fact: { label: "事实", next: "打开事实原文" },
  analysis: { label: "分析", next: "核对结论与来源" },
  action: { label: "本人行动", next: "继续执行" },
  waiting: { label: "外部等待", next: "查看跟进条件" },
  risk: { label: "风险", next: "立即确认" },
};

function decisionClip(value: string, limit: number) {
  const text = stripMarkdown(value).replace(/\s+/gu, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function noteDecisionMeta(note: Note) {
  const type = getType(note);
  const status = getString(note.frontmatter.status);
  const nextAction =
    getString(note.frontmatter.next_action) ||
    getString(note.frontmatter.action);
  const scheduled = getString(note.frontmatter.next_event_at);
  const scheduledDate = scheduled.match(/\b20\d{2}-\d{2}-\d{2}\b/u)?.[0] ?? "";
  const overdue = scheduledDate !== "" && scheduledDate < localDateKey() && status !== "完了";
  const waiting = /(?:待ち|待機|等待|返信|回复|結果待)/u.test(`${nextAction} ${status}`);
  const activeJob = getType(note) === "job-case" && careerStatus(status).tone === "active";
  let semantic: DecisionSemantic = "fact";
  if (overdue) semantic = "risk";
  else if (waiting) semantic = "waiting";
  else if (type === "todo" && todoAudience(note) === "user" && status !== "完了") semantic = "action";
  else if (activeJob || (type === "interview-prep" && scheduledDate >= localDateKey())) semantic = "action";
  else if (trustLayer(note).className === "trust-analysis") semantic = "analysis";

  const structuredWhy = [
    getString(note.frontmatter.reason),
    getString(note.frontmatter.summary),
    getString(note.frontmatter.caution),
    getString(note.frontmatter.result),
  ].find(Boolean);
  const importance = decisionClip(
    structuredWhy || notePreview(note) ||
      (semantic === "analysis"
        ? "这是基于现有材料形成的分析，需要结合来源再判断。"
        : "这是可以回查的事实与证据。"),
    118,
  );
  const when = scheduled ||
    getString(note.frontmatter.status_updated) ||
    getString(note.frontmatter.date) ||
    formatDate(note.stat.mtime);
  const next = decisionClip(nextAction || DECISION_SEMANTICS[semantic].next, 76);
  return { semantic, importance, when, next, label: DECISION_SEMANTICS[semantic].label };
}


function TodoView({ notes, onOpen }: { notes: Note[]; onOpen: (note: Note) => void }) {
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
          const decision = noteDecisionMeta(note);
          const why = jobSection(note, "なぜ必要か") || jobSection(note, "課題");
          const what = jobSection(note, "やること");
          return (
            <article
              className={`todo-card pri-${pri} ${st === "完了" ? "is-done" : ""}`}
              data-semantic={decision.semantic}
              key={note.path}
            >
              <header className="todo-head">
                <div className="todo-titles">
                  <span className={`todo-pri pri-${pri}`}>{TODO_PRIORITY[pri]?.label ?? pri}</span>
                  <h2>{todoAction(note)}</h2>
                </div>
                <span className={`todo-status st-${st}`}>{st}</span>
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

/** 見出しに付ける id。行番号ベースなので、目次側と本文側で必ず一致する。 */
function headingAnchor(lineIndex: number) {
  return `doc-h-${lineIndex}`;
}

/** 目次用の見出しだけを拾う。**強調** や [[リンク]] の記号は目次では邪魔なので落とす。 */
function headingPlainText(text: string) {
  return text
    .replace(/!?\[\[([^\]]+)\]\]/g, (_, body: string) => {
      const [targetWithHeading, alias] = String(body).split("|");
      return alias || targetWithHeading.split("#")[0];
    })
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/**
 * MarkdownDocument と同じ順序で本文を舐めて見出しを集める。
 * 走査規則（コードフェンス内は無視・冒頭 H1 はノート題名なので捨てる）を
 * 本文レンダラと揃えていないと、目次のリンク先がずれる。
 */
function scanHeadings(content: string) {
  const found: { id: string; level: number; text: string }[] = [];
  let inCode = false;
  let seenTitle = false;
  stripFrontmatter(content).split("\n").forEach((line, index) => {
    if (line.startsWith("```")) { inCode = !inCode; return; }
    if (inCode || line.startsWith(">")) return;
    const heading = line.match(/^(#{1,4})\s+(.+)/);
    if (!heading) return;
    const level = heading[1].length;
    if (level === 1 && !seenTitle) { seenTitle = true; return; }
    if (level > 3) return;
    found.push({ id: headingAnchor(index), level: level === 1 ? 2 : level, text: headingPlainText(heading[2]) });
  });
  return found;
}

function NoteDrawer({
  note,
  section,
  allNotes,
  onClose,
  onOpenWiki,
  onOpen,
}: {
  note: Note;
  section: string | null;
  allNotes: Note[];
  onClose: () => void;
  onOpenWiki: (target: string, section?: string) => void;
  onOpen: (note: Note) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const group = getGroup(note.path);
  const trust = trustLayer(note);
  const basename = noteBasename(note.path);
  const backlinks = allNotes.filter((candidate) => noteLinks(candidate).includes(basename));
  const frontmatterEntries = Object.entries(note.frontmatter);
  const headings = useMemo(() => scanHeadings(note.content), [note.content]);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // 全屏で読むので背面はスクロールさせない。閉じたときに元の位置へ戻す。
  useEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
    };
  }, []);

  useEffect(() => {
    if (!section) return;
    const timer = window.setTimeout(() => {
      const wanted = normalizeHeading(section);
      const target = [...(scrollRef.current?.querySelectorAll<HTMLElement>("[data-md-heading]") ?? [])]
        .find((heading) => {
          const actual = heading.dataset.mdHeading ?? "";
          return actual === wanted || actual.startsWith(wanted) || wanted.startsWith(actual);
        });
      target?.scrollIntoView({ block: "start" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [note.path, section]);

  // 読書位置：進捗バーと目次のハイライトは同じ1回の計測から作る。
  // 別々に scroll を購読すると、長文でフレームを2回食う。
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const travel = scroller.scrollHeight - scroller.clientHeight;
      setProgress(travel > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / travel)) : 0);
      const marks = [...scroller.querySelectorAll<HTMLElement>("[data-md-heading][id]")];
      // 見出しが画面上端の少し下を通過した時点で「その節を読んでいる」とみなす。
      const threshold = scroller.getBoundingClientRect().top + 140;
      let current = marks[0]?.id ?? null;
      for (const mark of marks) {
        if (mark.getBoundingClientRect().top > threshold) break;
        current = mark.id;
      }
      setActiveHeading(current);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [note.path]);

  const jumpToHeading = (id: string) => {
    scrollRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className="drawer-backdrop drawer-backdrop--full">
      <aside className="note-drawer note-drawer--full" aria-label="记忆详情" aria-modal="true" role="dialog">
        <header className="drawer-header">
          <div><span style={{ color: GROUPS[group].color }}>{GROUPS[group].label}</span><small>{note.path}</small></div>
          <span className="drawer-esc-hint"><kbd>Esc</kbd> 返回</span>
          <button onClick={onClose} aria-label="关闭详情">×</button>
          <i className="drawer-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden />
        </header>
        <div className="drawer-scroll" ref={scrollRef}>
          <div className="drawer-reading-shell">
          {headings.length > 2 && (
            <nav className="doc-toc" aria-label="本文目录">
              <span className="doc-toc-label">目录</span>
              <ol>
                {headings.map((heading) => (
                  <li key={heading.id} className={`doc-toc-item doc-toc-item--h${heading.level}${activeHeading === heading.id ? " is-active" : ""}`}>
                    <button onClick={() => jumpToHeading(heading.id)}>{heading.text}</button>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div className="drawer-reading">
            <div className="drawer-title-row">
              <span className={`trust-badge ${trust.className}`}>{trust.label}</span>
              <span>{typeLabel(getType(note))}</span>
            </div>
            <h1>{getTitle(note)}</h1>
            <div className="drawer-meta">
              <span>更新于 {formatDate(note.stat.mtime, true)}</span>
              <span>{Math.round(note.stat.size / 1024 * 10) / 10} KB</span>
              <span>{noteLinks(note).length} 条外链</span>
              <span>{backlinks.length} 条反链</span>
            </div>
            {frontmatterEntries.length > 0 && (
              // 指纹や schema_version は読む妨げにしかならないので、既定では畳む。
              <details className="frontmatter-fold" open={frontmatterEntries.length <= 4}>
                <summary>属性 {frontmatterEntries.length} 项</summary>
                <div className="frontmatter-grid">
                  {frontmatterEntries.map(([key, value]) => (
                    <div key={key}><span>{key}</span><strong>{Array.isArray(value) ? value.join(" · ") : getString(value) || "—"}</strong></div>
                  ))}
                </div>
              </details>
            )}
            <MarkdownDocument content={note.content} onWikiLink={onOpenWiki} />
            {backlinks.length > 0 && (
              <section className="backlinks">
                <span>BACKLINKS · 反向链接</span>
                {backlinks.map((backlink) => (
                  <button key={backlink.path} onClick={() => onOpen(backlink)}><strong>{getTitle(backlink)}</strong><small>{GROUPS[getGroup(backlink.path)].label} ↗</small></button>
                ))}
              </section>
            )}
          </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function renderInline(text: string, onWikiLink: (target: string, section?: string) => void): ReactNode[] {
  // 埋め込み記法 ![[…]] も同じリンクとして扱う。`!` を先に食わないと裸で残る。
  // [題](url) と <url> は取材メモの出典で多用するので、素の URL を晒さずリンクにする。
  const pieces = text
    .split(/(!?\[\[[^\]]+\]\]|\[[^\]]+\]\([^)\s]+\)|<https?:\/\/[^>\s]+>|\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean);
  return pieces.map((piece, index) => {
    const mdLink = piece.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (mdLink) {
      return (
        <a className="md-link" key={index} href={mdLink[2]} target="_blank" rel="noreferrer">
          {mdLink[1]}<i>↗</i>
        </a>
      );
    }
    if (/^<https?:\/\/[^>\s]+>$/.test(piece)) {
      const url = piece.slice(1, -1);
      return (
        <a className="md-link" key={index} href={url} target="_blank" rel="noreferrer">
          {url}<i>↗</i>
        </a>
      );
    }
    if (piece.startsWith("[[") || piece.startsWith("![[")) {
      const body = piece.replace(/^!?\[\[/, "").replace(/\]\]$/, "");
      const [targetWithHeading, alias] = body.split("|");
      const [target, section] = targetWithHeading.split("#");
      return (
        <button className="wiki-link" key={index} onClick={() => onWikiLink(target, section)}>
          {alias || section || target} ↗
        </button>
      );
    }
    if (piece.startsWith("**") && piece.endsWith("**")) return <strong key={index}>{piece.slice(2, -2)}</strong>;
    if (piece.startsWith("`") && piece.endsWith("`")) return <code key={index}>{piece.slice(1, -1)}</code>;
    return piece;
  });
}

/**
 * 引用の先頭に付いた記号で色を決める。vault 側は 🔴＝禁止・⚠️＝注意・⭐＝最重要…と
 * 記号で強弱を書き分けているのに、全部同じ灰色の箱で出すとその区別が消える。
 */
const CALLOUT_TONES: [string, string][] = [
  ["🔴", "danger"], ["❌", "danger"], ["⛔", "danger"],
  ["⚠️", "warn"], ["⚠", "warn"],
  ["🔑", "key"], ["⭐", "key"],
  ["📊", "data"], ["🔍", "data"],
  ["🎯", "aim"], ["✅", "aim"],
  ["💡", "idea"],
];

function calloutTone(firstLine: string) {
  const head = firstLine.trimStart();
  // ** で始まる強調や > の入れ子を剥いでから記号を見る
  const bare = head.replace(/^(\*\*|>|\s)+/, "");
  for (const [mark, tone] of CALLOUT_TONES) {
    if (bare.startsWith(mark)) return tone;
  }
  return null;
}

function MarkdownDocument({
  content,
  onWikiLink,
}: {
  content: string;
  onWikiLink: (target: string, section?: string) => void;
}) {
  const lines = stripFrontmatter(content).split("\n");
  const blocks: ReactNode[] = [];
  let codeLines: string[] = [];
  let inCode = false;
  // 連続する > 行は1つの引用にまとめる。1行ごとに箱を作ると、
  // 数行の注意書きが分断されて読めなくなる。
  let quoteLines: string[] = [];
  let quoteStart = 0;
  // 表も同じ理由でまとめる。行ごとに独立した箱だと、
  // ヘッダ行と本体行の区別も、枠線の一体感も出せない。
  let tableLines: string[] = [];
  let tableStart = 0;
  let seenTitle = false;
  const flushQuote = () => {
    if (!quoteLines.length) return;
    const buffered = quoteLines;
    quoteLines = [];
    const tone = calloutTone(buffered[0] ?? "");
    blocks.push(
      <blockquote key={`quote-${quoteStart}`} data-callout={tone ?? undefined}>
        {buffered.map((quoted, offset) => (
          <span key={offset}>{renderInline(quoted, onWikiLink)}</span>
        ))}
      </blockquote>,
    );
  };
  const flushTable = () => {
    if (!tableLines.length) return;
    const buffered = tableLines;
    tableLines = [];
    blocks.push(
      <div className="md-table" key={`table-${tableStart}`}>
        {buffered.map((row, rowIndex) => (
          <div className={`md-table-row${rowIndex === 0 ? " md-table-head" : ""}`} key={rowIndex}>
            {/* 前後のパイプだけ落として分割する。filter(Boolean) だと空セルが消えて列がずれる */}
            {row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell, cellIndex) => (
              <span key={cellIndex}>{renderInline(cell.trim(), onWikiLink)}</span>
            ))}
          </div>
        ))}
      </div>,
    );
  };
  lines.forEach((line, index) => {
    if (line.startsWith("```")) {
      flushQuote();
      flushTable();
      if (inCode) {
        blocks.push(<pre key={`code-${index}`}><code>{codeLines.join("\n")}</code></pre>);
        codeLines = [];
      }
      inCode = !inCode;
      return;
    }
    if (inCode) { codeLines.push(line); return; }
    if (line.startsWith(">")) {
      flushTable();
      if (!quoteLines.length) quoteStart = index;
      quoteLines.push(line.replace(/^>\s?/, ""));
      return;
    }
    if (line.startsWith("|")) {
      flushQuote();
      if (!tableLines.length) tableStart = index;
      // |---|---| の区切り行は表示しない
      if (!/^\|?\s*:?-+/.test(line)) tableLines.push(line);
      return;
    }
    flushQuote();
    flushTable();
    if (!line.trim()) return;
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={index} />);
      return;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)/);
    if (heading) {
      const level = heading[1].length;
      const data = { "data-md-heading": normalizeHeading(heading[2]), id: headingAnchor(index) };
      // 冒頭の H1 は Obsidian 慣例でノート題名＝drawer が既に大きく出しているので捨てる。
      // 2つ目以降の H1 は本文の見出しなので h2 として出す。
      if (level === 1) {
        if (!seenTitle) { seenTitle = true; return; }
        blocks.push(<h2 key={index} {...data}>{renderInline(heading[2], onWikiLink)}</h2>);
      }
      else if (level === 2) blocks.push(<h2 key={index} {...data}>{renderInline(heading[2], onWikiLink)}</h2>);
      else if (level === 3) blocks.push(<h3 key={index} {...data}>{renderInline(heading[2], onWikiLink)}</h3>);
      else blocks.push(<h4 key={index} {...data}>{renderInline(heading[2], onWikiLink)}</h4>);
      return;
    }
    const listItem = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/);
    if (listItem) {
      blocks.push(<div className="md-list-item" key={index}><i /> <span>{renderInline(listItem[1], onWikiLink)}</span></div>);
      return;
    }
    blocks.push(<p key={index}>{renderInline(line, onWikiLink)}</p>);
  });
  flushQuote();
  flushTable();
  return <article className="markdown-document">{blocks}</article>;
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-orbit"><i /><i /><i /><strong>回</strong></div>
      <h1>正在重建你的记忆关系…</h1>
      <p>读取笔记、双链、时间和事实层级</p>
    </div>
  );
}

function ConnectionError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="connection-error">
      <span className="error-code">LOCAL / OFFLINE</span>
      <h1>还差一步，才能读到记忆库。</h1>
      <p>网页本身已经就绪，但本地服务没有拿到 Obsidian 的访问凭证。确认 Obsidian 正在运行后，使用项目提供的本地启动脚本即可。</p>
      <code>{error}</code>
      <button onClick={onRetry}>重新连接 <span>↻</span></button>
    </div>
  );
}

export default MemoryAtlas;
