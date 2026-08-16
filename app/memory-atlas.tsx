"use client";

import {
  Fragment,
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
import CalendarView from "./calendar-view";
import GraphView from "./graph-view";
import LibraryView from "./library-view";
import NoteDrawer from "./note-drawer";
import Overview from "./overview-view";
import SearchPalette from "./search-palette";
import TimelineView from "./timeline-view";
import TodoView from "./todo-view";
import {
  appViewFromPathname,
  appViewHref,
  type AppView,
} from "./app-route";
import type {
} from "./knowledge-graph-three";
import {
} from "@/lib/timeline-scene";
import {
} from "@/lib/review-deep";
import {
  isRoundSpecificAsset,
  type SharedAssetTarget,
} from "@/lib/interview-shared-assets";
import {
  formatDate,
  noteBasename,
  type Note,
} from "@/lib/notes";
import {
} from "@/lib/knowledge-graph";
import {
  buildDerivedData,
  countdownLabel,
  GROUPS,
  type GroupKey,
} from "@/lib/memory-atlas-data";


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

  // 以下の遷移系コールバックは全部 useCallback：視圖側は React.memo で包んであり、
  // ここが毎レンダー新しい関数だと memo が一度も命中しない。
  const runSavedQuery = useCallback((savedQuery: string) => {
    const params = new URLSearchParams();
    params.set("q", savedQuery);
    setLibraryQuery(savedQuery);
    navigateToView("library", params);
    setSearchOpen(false);
  }, [navigateToView]);

  const openReview = useCallback((key?: string) => {
    setReviewInitialKey(key ?? null);
    navigateToView("review");
  }, [navigateToView]);

  const viewJobsWithFilters = useCallback((filters?: JobsInitialFilters) => {
    setJobsInitialFilters(filters ?? null);
    const params = new URLSearchParams();
    if (filters?.statuses?.length) params.set("status", filters.statuses.join(","));
    if (filters?.ratings?.length) params.set("rating", filters.ratings.join(","));
    navigateToView("jobs", params, true);
  }, [navigateToView]);

  const prepareInterview = useCallback((company: string) => {
    const params = new URLSearchParams();
    params.set("company", company);
    navigateToView("session", params);
  }, [navigateToView]);

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
                  onOpenReview={openReview}
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
                  onViewJobs={viewJobsWithFilters}
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
                  onPrepare={prepareInterview}
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
