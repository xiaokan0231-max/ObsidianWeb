"use client";

import {
  Fragment,
  lazy,
  Suspense,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import type { AdvisoryEvidenceRef } from "@/lib/interview-advisory";
import InterviewSharedAsset from "./interview-shared-asset";
import { isTypingTarget } from "@/lib/keyboard";
import type { JobsInitialFilters } from "./jobs-view";
import CalendarView from "./calendar-view";
import CalendarInterviewState from "./calendar-interview-state";
import NoteDrawer from "./note-drawer";
import SceneNoteReader from "./scene-note-reader";
import SearchPalette, { type PaletteAction } from "./search-palette";
import {
  appViewFromPathname,
  appViewHref,
  calendarInterviewFromSearch,
  calendarInterviewSearch,
  companyOverviewSearch,
  reviewEvidenceSearch,
  type AppView,
} from "./app-route";
import {
  MOBILE_PRIMARY_NAV_IDS,
  getNavigation,
  getSecondaryNavigation,
  TOP_BAR_SECTION_IDS,
  type NavIconName,
} from "./navigation";
import { useUndoFlash, UndoFlashBar } from "./undo-flash";
import { notifyUrlChange, SHELL_URL_KEYS } from "./use-url-state";
import { describeConnectionError } from "@/lib/connection-error";
import { postJson } from "@/lib/client-api";
import { createVaultReader, type VaultReadOptions } from "@/lib/vault-reader";
import { createWikiNavigator, type WikiNavigationNotice } from "@/lib/wiki-navigation";
import ViewErrorBoundary from "./view-error-boundary";
import {
  isRoundSpecificAsset,
  type SharedAssetTarget,
} from "@/lib/interview-shared-assets";
import {
  getType,
  noteBasename,
  type Note,
} from "@/lib/notes";
import {
  buildCalendarEvents,
  buildDerivedData,
  calendarEventTime,
  countdownLabel,
  GROUPS,
  localDateKey,
  type Commitment,
  type GroupKey,
} from "@/lib/memory-atlas-data";
import { scopesToReloadAfterStats, vaultScopeForView } from "@/lib/vault-scope";
import { resolveCalendarInterview, type CalendarInterviewTarget } from "@/lib/calendar-interview";
import { tokyoParts } from "@/lib/dojo/utils";
import { APP_BRANDING } from "@/lib/ui-locale";
import { LanguageSwitch, useUiLocale } from "./ui-locale";
import { ThemeSwitch, useUiTheme } from "./ui-theme";
import { rememberRecentPath } from "@/lib/recent-notes";
import { SHELL_MESSAGES } from "./shell-messages";
import { buildNavBadges, quickDueBadgeCount, type NavBadge, type NavBadges } from "@/lib/nav-badges";
import type { QuickSummary } from "@/lib/language/quick-types";
import { useExitTransition } from "./use-exit-transition";
import SidebarFooter from "./sidebar-footer";
import { prefersReducedMotion as reducedMotionPreferred } from "@/lib/motion";
import {
  canStartViewTransition,
  createPreloadable,
  createViewTransitionNavigator,
  startViewTransition,
  type ViewTransitionCommitMode,
} from "@/lib/view-transition";

// 业务页首次进入时再加载；组件身份固定，笔记刷新和 URL 更新不能重建页面状态。
// 加载器与预取共用一份：侧栏悬停／聚焦时先拉 chunk，切换时 lazy 当场读到模块，转场的新快照里不是骨架。
const VIEW_MODULES = {
  review: createPreloadable(() => import("./interview-review")),
  insights: createPreloadable(() => import("./interview-insights")),
  practice: createPreloadable(() => import("./interview-practice")),
  prep: createPreloadable(() => import("./interview-prep")),
  session: createPreloadable(() => import("./interview-session")),
  language: createPreloadable(() => import("./japanese-training")),
  topics: createPreloadable(() => import("./language-expression-courses")),
  analytics: createPreloadable(() => import("./jobs-analytics")),
  jobs: createPreloadable(() => import("./jobs-view")),
  graph: createPreloadable(() => import("./graph-view")),
  library: createPreloadable(() => import("./library-view")),
  settings: createPreloadable(() => import("./settings-view")),
  timeline: createPreloadable(() => import("./timeline-view")),
};
const InterviewReview = lazy(VIEW_MODULES.review.load);
const InterviewInsights = lazy(VIEW_MODULES.insights.load);
const InterviewPractice = lazy(VIEW_MODULES.practice.load);
const InterviewPrep = lazy(VIEW_MODULES.prep.load);
const InterviewSession = lazy(VIEW_MODULES.session.load);
const JapaneseTraining = lazy(VIEW_MODULES.language.load);
const LanguageExpressionCourses = lazy(VIEW_MODULES.topics.load);
const JobsAnalytics = lazy(VIEW_MODULES.analytics.load);
const JobsView = lazy(VIEW_MODULES.jobs.load);
const GraphView = lazy(VIEW_MODULES.graph.load);
const LibraryView = lazy(VIEW_MODULES.library.load);
const SettingsView = lazy(VIEW_MODULES.settings.load);
const TimelineView = lazy(VIEW_MODULES.timeline.load);

/** 日历是外壳的静态依赖，不在表里；其余页面按需预取，失败留给页面自己的错误边界。 */
function viewModule(view: AppView) {
  return view === "calendar" ? null : VIEW_MODULES[view];
}

function preloadView(view: AppView) {
  void viewModule(view)?.preload();
}

/** 目标页已加载（或本来就是静态的）返回 null，否则返回预取的 Promise 供转场限时等待。 */
function viewReady(view: AppView) {
  const entry = viewModule(view);
  return !entry || entry.isLoaded() ? null : entry.preload();
}

// 设置中心的「总是减弱动效」写在 <html data-motion>，转场闸要和全站同一个判定。
function prefersReducedMotion() {
  return reducedMotionPreferred();
}

export type { Note };

type View = AppView;

function NavigationIcon({ name }: { name: NavIconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      {name === "actions" && <><rect x="4" y="5.5" width="16" height="15" rx="2" /><path d="M8 3.5v4M16 3.5v4M4 10.5h16M8 14h2M14 14h2M8 17h2" /></>}
      {name === "career" && <><path d="M4 8.5h16v10.8H4z" /><path d="M8.5 8.5V5.7h7v2.8M4 12.5c4.8 2 11.2 2 16 0M10.5 13.3h3" /></>}
      {name === "interview" && <><path d="M4 5.5h16v11H9l-5 3.2z" /><path d="M8 9.5h8M8 12.5h5" /></>}
      {name === "training" && <><path d="m3.5 7 8.5-3 8.5 3-8.5 3z" /><path d="M6.2 8.2v5.6c3.6 2.8 8 2.8 11.6 0V8.2M20.5 7v7" /></>}
      {name === "resources" && <><path d="M5 4.5h12a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z" /><path d="M7 4.5v15.5M10 8h6M10 11.5h6M10 15h4" /></>}
      {name === "settings" && <><path d="M4 7h9M18 7h2M4 12h3M11 12h9M4 17h11M19 17h1" /><circle cx="15.5" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="17" r="2" /></>}
    </svg>
  );
}


/** 写回后是否自动重算派生统计（vault:stats）。本机偏好，存在 localStorage。 */
const AUTO_STATS_KEY = "echo:auto-stats";
const AUTO_STATS_EVENT = "echo:autostatschange";
// 私密窗口等拿不到 localStorage 时，只在本次会话里记住。
let autoStatsFallback = true;

function readAutoStats() {
  try {
    const stored = window.localStorage.getItem(AUTO_STATS_KEY);
    return stored === null ? autoStatsFallback : stored !== "off";
  } catch {
    return autoStatsFallback;
  }
}

function writeAutoStats(next: boolean) {
  autoStatsFallback = next;
  try { window.localStorage.setItem(AUTO_STATS_KEY, next ? "on" : "off"); } catch { /* 见 autoStatsFallback */ }
  window.dispatchEvent(new Event(AUTO_STATS_EVENT));
}

function subscribeAutoStats(onChange: () => void) {
  window.addEventListener(AUTO_STATS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(AUTO_STATS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

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
  const { locale } = useUiLocale();
  const ui = SHELL_MESSAGES[locale];
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
      aria-label={collapsed ? ui.expandRail : ui.collapseRail}
    >
      <i aria-hidden="true">‹</i>
      <span>{ui.collapse}</span>
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
  const { locale } = useUiLocale();
  const ui = SHELL_MESSAGES[locale];
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
          {ui.sessionBack}
        </button>
        <div>
          <small>{eyebrow}</small>
          <strong id={titleId}>{title}</strong>
        </div>
        <span><kbd>Esc</kbd> {ui.escapeBack}</span>
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
  const { locale } = useUiLocale();
  return (
    <InterviewOverlay
      className="prep-card-overlay"
      contentClassName="prep-card-overlay-content"
      titleId="prep-card-overlay-title"
      eyebrow="STANDARD ANSWER LIBRARY"
      title={`${SHELL_MESSAGES[locale].answerLibrary} · ${cardId}`}
      origin={origin}
      onClose={onClose}
    >
      <ViewErrorBoundary label="prep-card">
        <Suspense fallback={<LoadingState view="prep" />}>
          <InterviewPrep key={cardId} notes={notes} onOpen={onOpen} initialCardId={cardId} />
        </Suspense>
      </ViewErrorBoundary>
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

/*
 * 只认外壳的键（哪一场、哪份稿）。视图自己放进 URL 的筛选・模式（filter / pattern / prepMode …）
 * 走 replaceState，不经过这里；把它们算进来的话，关掉原笔记 drawer 回退时键就对不上，
 * 整页重挂，正在写的批注草稿随之丢失。
 */
const INTERVIEW_ENTRY_KEYS: ReadonlySet<string> = new Set(
  SHELL_URL_KEYS.filter((key) => key !== "note" && key !== "section"),
);

function interviewNavigationKey(view: AppView, search: string) {
  const params = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) {
    if (INTERVIEW_ENTRY_KEYS.has(key)) params.append(key, value);
  }
  return appViewHref(view, params);
}


type DerivedState = "fresh" | "stale" | "rebuilding";
/** これらを書き換えると台帳・数据字典・面接傾向の generated 区块が古くなる（vault:stats の入力）。 */
const DERIVED_SOURCE_TYPES = new Set(["job-case", "job-queue", "interview-answer-review", "transcript-study", "study-annotation"]);

function historyEntryId(state: unknown): string | null {
  const id = state && typeof state === "object" ? (state as { __echoEntry?: unknown }).__echoEntry : undefined;
  return typeof id === "string" ? id : null;
}

let historyEntrySequence = 0;
/** 历史条目 id。只要在本标签页内唯一：时间戳防刷新后重号，序号防同一毫秒内连点。 */
function newHistoryEntryId() {
  historyEntrySequence += 1;
  return `${Date.now().toString(36)}-${historyEntrySequence}`;
}

/**
 * 训练中心角标「待复习 n」：首次载入完成后取一次快练汇总（失败静默）；在训练页时由训练页交来最新汇总，不重复请求。
 * 单独成 hook：写在外壳组件体里会让 React Compiler 放弃整个外壳的记忆化。
 */
function useQuickDueBadge(loaded: boolean, viewRef: { readonly current: string }) {
  const [quickDue, setQuickDue] = useState<number | null>(null);
  const requested = useRef(false);
  const onQuickSummary = useCallback((summary: QuickSummary) => setQuickDue(quickDueBadgeCount(summary)), []);
  useEffect(() => {
    if (!loaded || requested.current || viewRef.current === "language") return;
    // 标记放进计时器里：开发模式下 effect 会先清理再重跑，先标记会让这一次请求永远发不出去。
    const timer = window.setTimeout(() => {
      requested.current = true;
      fetch("/api/language/v2/quick/summary", { cache: "no-store", signal: AbortSignal.timeout(20_000) })
        .then((response) => response.ok ? response.json() as Promise<QuickSummary | { summary?: QuickSummary }> : null)
        .then((body) => {
          const summary = body && "summary" in body && body.summary ? body.summary : body as QuickSummary | null;
          setQuickDue((current) => current ?? quickDueBadgeCount(summary));
        })
        .catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loaded, viewRef]);
  return { quickDue, onQuickSummary };
}

function MemoryAtlas({ initialView = "calendar" }: { initialView?: AppView }) {
  const { locale, setLocale } = useUiLocale();
  const { theme, setTheme } = useUiTheme();
  const ui = SHELL_MESSAGES[locale];
  const branding = APP_BRANDING[locale];
  const navigation = getNavigation(locale);
  const secondaryMenus = getSecondaryNavigation(locale);
  const [vaultReader] = useState(() => createVaultReader());
  const vaultState = useSyncExternalStore(vaultReader.subscribe, vaultReader.getState, vaultReader.getState);
  const notes = vaultState.notes;
  const [view, setView] = useState<View>(initialView);
  // 这一页是不是由页面转场带进来的。转场的新快照已经有淡入上移，容器自己的 view-enter 再播一遍就是双重入场；
  // 挂在随 view 重挂的 .view-container 上，转场结束后也不会因为属性被移除而重播。
  const [viewEnter, setViewEnter] = useState<ViewTransitionCommitMode>("instant");
  const [viewNavigator] = useState(() => createViewTransitionNavigator({
    canTransition: () => canStartViewTransition(document, prefersReducedMotion),
    start: (update) => startViewTransition(document, update, document.documentElement),
    scheduler: { wait: (ms) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)) },
  }));
  const [interviewRouteSearch, setInterviewRouteSearch] = useState(() =>
    typeof window === "undefined" ? "" : window.location.search,
  );
  const [interviewRouteVersion, setInterviewRouteVersion] = useState(0);
  const interviewNavigation = useRef("");
  // 本场面试を残したまま、その上に全幅で開く回答库カード
  const [prepOverlayCard, setPrepOverlayCard] = useState<string | null>(null);
  const [prepOverlayOrigin, setPrepOverlayOrigin] = useState({ x: 0, y: 0 });
  const [sharedAssetOverlay, setSharedAssetOverlay] = useState<SharedAssetTarget | null>(null);
  const [sharedAssetOrigin, setSharedAssetOrigin] = useState({ x: 0, y: 0 });
  // 求職分析から「進行中 N 件をすべて見る」で飛んできた時だけ、求人一覧に状態フィルタを引き継ぐ。
  const [jobsInitialFilters, setJobsInitialFilters] = useState<JobsInitialFilters | null>(null);
  // 派生統計（台帳・数据字典・面接傾向の generated 区块）が手元の事実に追いついているか。
  // 書込ルートは stale を返すだけで再計算できない（workerd）ので、殻が本機 bridge に頼む。
  const [derivedState, setDerivedState] = useState<DerivedState>("fresh");
  const [statsError, setStatsError] = useState("");
  // 服务端与首帧一律按「自动」渲染，挂载后再读本机偏好——在 useState 初始化里直接读 localStorage，
  // 本机设成手动时首帧文字与服务端不一致，React 会丢掉整棵服务端 HTML 重画。
  const autoStats = useSyncExternalStore(subscribeAutoStats, readAutoStats, () => true);
  const statsTimer = useRef<number | null>(null);
  // 写回后的「已改为 X · 撤销」全壳只有一条；各页拿到的是稳定的 show。
  const [selectedPath, setSelectedPath] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("note"),
  );
  const [selectedSection, setSelectedSection] = useState<string | null>(() =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("section"),
  );
  // 详情・场景阅读层先播退场再走原来的关闭逻辑；退场途中换了篇就取消（见 lib/exit-transition.ts）。
  const { exiting: noteExiting, exit: exitNote } = useExitTransition(selectedPath);
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
  // ダッシュボードは開きっぱなしで使う。「今日」は殻が state で持ち、視圖へは props で渡す
  // ——視圖は memo で包んであるので、中で new Date() を呼ぶだけだと日付を跨いでも
  // props が変わらず再レンダーされず、昨日の日付が凍りつく（総覧の見出し・日历の「今天」）。
  const [today, setToday] = useState(() => localDateKey());
  const [calendarToday, setCalendarToday] = useState(() => tokyoParts().date);
  const loading = vaultState.loading || vaultState.readyScopes.size === 0 && vaultState.errors.size === 0;
  const activeScope = vaultScopeForView(view);
  const error = vaultState.errors.get(activeScope) ?? vaultState.errors.get("all") ?? "";
  const [writeError, setWriteError] = useState("");
  // 撤销失败而它的提示已被新的一次写入顶掉时，理由落到全局的写入错误横幅上（见 useUndoFlash）。
  const reportStaleUndoFailure = useCallback((message: string) => setWriteError(`撤销没有完成：${message}`), []);
  const undoFlash = useUndoFlash({ onStaleFailure: reportStaleUndoFailure });
  const { show: showFlash } = undoFlash;
  const fetchedAt = vaultState.checkedAt.get(activeScope) ?? vaultState.checkedAt.get("all") ?? null;
  // どの scope が手元に揃ったか。視図はこれで「まだ来ていない」と「本当に無い」を分ける（假空态の根）。
  const readyScopes = vaultState.readyScopes;
  const interviewScopeReady = readyScopes.has("all") || readyScopes.has("interview");
  const scopeReady = readyScopes.has("all") || readyScopes.has(vaultScopeForView(view));

  // 浏览器后退／前进回到某一页时要回到的纵向位置。
  const pendingScrollRestore = useRef<number | null>(null);
  const currentView = useRef<View>(initialView);
  // 每条历史条目一个 id（history.state.__echoEntry），滚动时持续记下「这一条目当前滚到哪」。
  // 只在点导航离开时盖章是不够的：用后退／前进离开的那一页从没盖过章，回来时要么回到顶部，要么回到更早的旧位置。
  const scrollByEntry = useRef(new Map<string, number>());
  // 正在显示的那一条目。popstate 触发时 history.state 已经换成目的地，要靠它知道「刚离开的是谁」。
  const currentEntry = useRef<string | null>(null);

  useEffect(() => {
    if (!historyEntryId(window.history.state)) {
      window.history.replaceState({ ...(window.history.state ?? {}), __echoEntry: newHistoryEntryId() }, "");
    }
    currentEntry.current = historyEntryId(window.history.state);
    const record = () => {
      const id = historyEntryId(window.history.state);
      if (id) scrollByEntry.current.set(id, window.scrollY);
    };
    window.addEventListener("scroll", record, { passive: true });
    return () => window.removeEventListener("scroll", record);
  }, []);

  // 往前走（点导航）时新页面从顶部开始，否则会从标题或工具栏中段开始；
  // 用后退回到刚才那页时则回到离开时的位置——看完一条案件想回列表接着往下看，不该每次从头翻。
  useEffect(() => {
    currentView.current = view;
    const restoreY = pendingScrollRestore.current;
    pendingScrollRestore.current = null;
    if (restoreY === null) {
      window.scrollTo({ left: 0, top: 0 });
      return;
    }
    const restore = () => window.scrollTo({ left: 0, top: restoreY });
    // rAF 在后台／隐藏的面板里不跑。先立刻定一次，等列表按新 view 排完版（数据已在手）再补一次。
    restore();
    const early = window.setTimeout(restore, 0);
    const late = window.setTimeout(restore, 150);
    return () => {
      window.clearTimeout(early);
      window.clearTimeout(late);
    };
  }, [view]);

  // 次の深夜0時ちょうどに一度だけ起こす（常駐タイマーを置かないため）。
  // タブが背面にいる間に日付が変わっていることもあるので、復帰時にも合わせる。
  useEffect(() => {
    let timer = 0;
    const sync = () => {
      setCalendarToday(tokyoParts().date);
      setToday((current: string) => {
        const now = localDateKey();
        return now === current ? current : now;
      });
      schedule();
    };
    const schedule = () => {
      window.clearTimeout(timer);
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const jstMidnight = Date.parse(`${tokyoParts(now).date}T00:00:00+09:00`) + 86400000;
      timer = window.setTimeout(sync, Math.max(1000, Math.min(midnight.getTime(), jstMidnight) - now.getTime()));
    };
    schedule();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  // 请求次序、scope 快照和写回保护由独立协调器管理，页面只订阅接受后的状态。
  const loadVault = useCallback(async (options?: VaultReadOptions): Promise<void> => {
    await vaultReader.request(options);
  }, [vaultReader]);

  const [wikiNotice, setWikiNotice] = useState<WikiNavigationNotice>(null);
  const [wikiNavigator] = useState(() => createWikiNavigator({
    getNotes: () => vaultReader.getState().notes,
    isComplete: () => vaultReader.getState().readyScopes.has("all"),
    ensureAll: async () => {
      // R 可替代在途请求；等它的最新结果，不能拿点击前闭包里的旧 notes 解析。
      let result = await vaultReader.request({ scope: "all" });
      while (result.status === "superseded" && vaultReader.getState().loadingScopes.has("all")) {
        result = await vaultReader.request({ scope: "all" });
      }
      return result.status === "accepted" ? vaultReader.getState().notes : null;
    },
    onNotice: setWikiNotice,
    onOpen: ({ path, section }) => {
      const params = new URLSearchParams(window.location.search);
      params.set("note", path);
      if (section) params.set("section", section);
      else params.delete("section");
      window.history.pushState(
        { ...(window.history.state ?? {}), __echoNote: path }, "",
        `${window.location.pathname}?${params.toString()}`,
      );
      setSelectedPath(path);
      setSelectedSection(section);
      setSearchOpen(false);
    },
  }));

  useEffect(() => {
    return () => {
      wikiNavigator.cancel();
      vaultReader.dispose();
    };
  }, [vaultReader, wikiNavigator]);

  // Obsidian で編集して戻ってきた時だけ軽量キャッシュ照合を行う。常時 poll はせず、
  // 直前の取得から60秒未満なら何もしないので、Cmd+Tab のたびに画面を揺らさない。
  useEffect(() => {
    const refreshOnFocus = () => {
      if (document.visibilityState !== "visible" || loading) return;
      if (fetchedAt && Date.now() - fetchedAt < 60_000) return;
      void loadVault({ scope: vaultScopeForView(view) });
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [fetchedAt, loadVault, loading, view]);

  /**
   * 写路由已经把更新后的那条 note 放在响应里，这里只做单条替换。
   * 以前每次写入都 loadVault() 整库重拉（服务端 300 个 GET + 6MB JSON），
   * spinner 还要按住整条链路——为了换一条已经在手里的数据。
   */
  const rebuildStats = useCallback(async () => {
    if (statsTimer.current) { window.clearTimeout(statsTimer.current); statsTimer.current = null; }
    setDerivedState("rebuilding");
    setStatsError("");
    try {
      // vault:stats は数秒かかる（bridge 側の上限 90 秒）。
      await postJson("/api/vault/stats", {}, { timeoutMs: 100_000 });
      setDerivedState("fresh");
      // generated 区块は複数の scope に散っている（台帳・応募日台帳は jobs、面接傾向は interview、数据字典は all だけ）。
      // 手元に載っている scope を全部取り直す——変わっていない scope は ETag で 304 になるので安い。
      await Promise.all(scopesToReloadAfterStats(vaultReader.getState().readyScopes).map((scope) => loadVault({ scope })));
    } catch (rebuildError) {
      setDerivedState("stale");
      setStatsError(rebuildError instanceof Error ? rebuildError.message : "重算派生统计失败");
    }
  }, [loadVault, vaultReader]);

  // 事実を書いた直後に呼ぶ。自動なら 3 秒待って（連打をまとめて）再計算、手動なら「待重算」の印だけ出す。
  const markDerivedStale = useCallback(() => {
    setDerivedState((current) => (current === "rebuilding" ? current : "stale"));
    if (!autoStats) return;
    if (statsTimer.current) window.clearTimeout(statsTimer.current);
    statsTimer.current = window.setTimeout(() => void rebuildStats(), 3_000);
  }, [autoStats, rebuildStats]);

  const toggleAutoStats = useCallback(() => writeAutoStats(!readAutoStats()), []);

  const patchNote = useCallback((note: Note) => {
    vaultReader.patchNote(note);
    if (DERIVED_SOURCE_TYPES.has(getType(note))) markDerivedStale();
  }, [markDerivedStale, vaultReader]);

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
      const params = new URLSearchParams(window.location.search);
      setInterviewRouteSearch(window.location.search);
      const interviewKey = interviewNavigationKey(routedView, window.location.search);
      // 只在场次入口改变时重置阅读状态；关闭原始笔记不能丢掉当前的批注草稿。
      if (interviewNavigation.current !== interviewKey) setInterviewRouteVersion((version) => version + 1);
      interviewNavigation.current = interviewKey;
      setSelectedPath(params.get("note"));
      setSelectedSection(params.get("section"));
    };
    const onPopState = (event: PopStateEvent) => {
      wikiNavigator.cancel();
      // 只认浏览器真正的后退／前进（isTrusted）：日历补齐场次时自己派发的 popstate 不是「回来」。
      // 同一页内的回退（关 drawer・关回答库浮层）由各自的逻辑复位，这里不插手。
      const routedView = appViewFromPathname(window.location.pathname);
      // 先取「这一条目最后滚到的位置」；刷新过页面（内存里的表空了）才退回离开时盖的章。
      const entryId = historyEntryId(event.state);
      const stamped = event.state && typeof event.state === "object"
        ? (event.state as { __echoScrollY?: unknown }).__echoScrollY
        : undefined;
      // 滚动事件按帧派发：刚滚完就后退时，最后那次滚动可能还没记进表里。离开的这一刻再补记一次。
      if (currentEntry.current) scrollByEntry.current.set(currentEntry.current, window.scrollY);
      currentEntry.current = entryId;
      const scrollY = (entryId ? scrollByEntry.current.get(entryId) : undefined) ?? stamped;
      const changesView = event.isTrusted && routedView !== null && routedView !== currentView.current;
      const commit = (mode: ViewTransitionCommitMode) => {
        // 只在真的换页（容器随 key 重挂）时改 data-enter：同一页内的回退（关抽屉）若把它从 transition 摘掉，
        // 容器的 animation 从 none 变回 view-enter，整页会再播一遍入场。合成的 popstate 也可能换页，单独判断。
        const entersNewView = routedView !== null && routedView !== currentView.current;
        syncOverlays(event.state);
        // 滚动目标在提交时才交给 [view] effect：等转场期间若被新的点击导航顶掉，不能让它把新页面滚到旧位置。
        if (changesView && typeof scrollY === "number") pendingScrollRestore.current = scrollY;
        // 看板的「带筛选跳转」种子只属于那一次点击；从历史回到 /jobs 时以地址栏为准，不再套旧种子。
        setJobsInitialFilters(null);
        syncRoute();
        if (entersNewView) setViewEnter(mode);
      };
      if (!event.isTrusted) {
        commit("instant");
        return;
      }
      // 浏览器已经换了地址：还在等 chunk 或等转场回调的点击导航必须作废，否则它会迟到地 pushState。
      // 换页的后退／前进也走转场；目标页 chunk 没到（刷新后第一次后退）不值得等，直接切。
      const transition = changesView && viewReady(routedView) === null;
      if (transition) {
        // 同文档的后退／前进会在派发 popstate 的同一任务里按 auto 恢复滚动，而这时 DOM 还是旧页面：
        // 旧快照会先跳到目标条目的位置再淡出。截快照前的那一帧把旧页面放回离开时的位置。
        // 不改全局 scrollRestoration：章节、岗位抽屉等同页条目的后退还靠浏览器自动恢复。
        const leaveY = window.scrollY;
        window.requestAnimationFrame(() => window.scrollTo({ left: 0, top: leaveY, behavior: "instant" }));
      }
      viewNavigator.navigate({
        transition,
        commit: (mode) => mode === "transition" ? flushSync(() => commit(mode)) : commit(mode),
      });
    };
    syncOverlays(window.history.state);
    syncRoute();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [viewNavigator, wikiNavigator]);

  useEffect(() => {
    // rAF は非アクティブなタブでは発火しないため timer で初回ロードする。
    const timer = window.setTimeout(() => void loadVault({ scope: vaultScopeForView(initialView) }), 0);
    return () => window.clearTimeout(timer);
  }, [initialView, loadVault]);

  const { quickDue, onQuickSummary } = useQuickDueBadge(Boolean(fetchedAt), currentView);

  useEffect(() => {
    const scope = vaultScopeForView(view);
    if (vaultReader.getState().readyScopes.has("all") || vaultReader.getState().readyScopes.has(scope)) return;
    void loadVault({ scope });
  }, [loadVault, view, vaultReader]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // 面板挂载后自己聚焦输入框，这里不需要再持有 ref。再按一次就关，和其它命令面板的习惯一致。
        setSearchOpen((open) => !open);
      }
      // R = 重读 vault。顶栏不再有按钮，所以这条必须挡住输入场景，否则打字就会触发。
      if (
        event.key.toLowerCase() === "r" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        // 3D 舞台の R（視点リセット）が先に preventDefault している時は全庫再読込を重ねない。
        !event.defaultPrevented &&
        !isTypingTarget(event.target)
      ) {
        event.preventDefault();
        void loadVault({ fresh: true });
      }
      if (event.key === "Escape") {
        // ⌘K 面板永远在最上层：先关它，不连带关掉它底下的抽屉或浮层。
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        // 回答库の上に原笔记 drawer を開いている時は、一段ずつ閉じる。
        if (selectedPath) {
          wikiNavigator.cancel();
          // 与 × 同一条退场：退场中再按 Esc 由 exitNote 吞掉，不会连退两层。
          exitNote(() => {
            if (window.history.state?.__echoNote) window.history.back();
            else {
              const params = new URLSearchParams(window.location.search);
              params.delete("note");
              params.delete("section");
              const query = params.toString();
              window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
              setSelectedPath(null);
              setSelectedSection(null);
            }
          });
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
        wikiNavigator.cancel();
        setSearchOpen(false);
        setSelectedPath(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    closePrepCard,
    closeSharedAsset,
    exitNote,
    loadVault,
    prepOverlayCard,
    searchOpen,
    selectedPath,
    sharedAssetOverlay,
    wikiNavigator,
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
    wikiNavigator.cancel();
    const params = new URLSearchParams(window.location.search);
    params.set("note", note.path);
    params.delete("section");
    window.history.pushState(
      { ...(window.history.state ?? {}), __echoNote: note.path },
      "",
      `${window.location.pathname}?${params.toString()}`,
    );
    setSelectedPath(note.path);
    setSelectedSection(null);
    setSearchOpen(false);
  }, [setSearchOpen, wikiNavigator]);

  // 先播退场（lib/exit-transition.ts），播完再走下面原来的关闭逻辑。
  const closeNote = useCallback(() => {
    wikiNavigator.cancel();
    exitNote(() => {
      if (window.history.state?.__echoNote) {
        window.history.back();
        return;
      }
      const params = new URLSearchParams(window.location.search);
      params.delete("note");
      params.delete("section");
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      setSelectedPath(null);
      setSelectedSection(null);
    });
  }, [exitNote, wikiNavigator]);

  const openWikiLink = useCallback((target: string, section?: string) => {
    void wikiNavigator.open(target, section);
  }, [wikiNavigator]);

  const closeSceneNote = useCallback(() => {
    wikiNavigator.cancel();
    exitNote(() => {
      // 关联笔记可能已经翻了多篇，关闭全文必须直接回到场景，而不是逐篇退出。
      const params = new URLSearchParams(window.location.search);
      params.delete("note");
      params.delete("section");
      const query = params.toString();
      window.history.replaceState(
        { ...(window.history.state ?? {}), __echoNote: null }, "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      );
      setSelectedPath(null);
      setSelectedSection(null);
    });
  }, [exitNote, wikiNavigator]);

  // today を依存に入れるのは、日历事件の upcoming/past が「今日」で決まるため。
  // 入れないと、日付を跨いだ時に見出しの日付だけ進んで、昨日の面接が「未来の予定」の
  // まま残る——頂栏は実時間で「1 日前」と出すので、同じ画面の中で矛盾する。
  const derived = useMemo(
    () => buildDerivedData(notes, new Date(`${today}T00:00:00`)),
    [notes, today],
  );
  // 日历统一使用 JST 日界；其它视图仍保留各自的本机日期口径。
  const calendarEvents = useMemo(
    () => buildCalendarEvents(notes, new Date(`${calendarToday}T00:00:00`)),
    [notes, calendarToday],
  );
  const calendarInterviewTargets = useMemo(() => {
    const targets = new Map<string, CalendarInterviewTarget>();
    for (const event of calendarEvents) {
      const target = resolveCalendarInterview(event, notes);
      if (target) targets.set(event.id, target);
    }
    return targets;
  }, [calendarEvents, notes]);
  // 侧栏角标与日历同一份场次表、同一个 JST「今天」；scope 未到手时不出数（lib/nav-badges.ts）。
  const navBadges: NavBadges = useMemo(() => buildNavBadges({
    events: calendarEvents, notes, today: calendarToday, readyScopes,
    interviewTargets: calendarInterviewTargets, locale, quickDue,
  }), [calendarEvents, notes, calendarToday, readyScopes, calendarInterviewTargets, locale, quickDue]);

  const calendarInterview = useMemo(() => {
    const requested = calendarInterviewFromSearch(view, interviewRouteSearch);
    if (!requested) return null;
    const source = notes.find((note) => note.path === requested.sourcePath);
    if (!source) return { ...requested, path: null };
    const event = calendarEvents.find((item) =>
      item.date === requested.date && item.note.path === requested.sourcePath,
    );
    // 日历只加载行动资料；到面试页加载完整资料后重新匹配，不能把先前的空结果冻结。
    const resolved = resolveCalendarInterview({
      id: event?.id ?? requested.sourcePath,
      note: source,
      kind: "event",
      company: requested.company,
      date: requested.date,
      time: requested.time || event?.time || "",
      label: requested.label,
      phase: requested.date < calendarToday ? "past" : "upcoming",
      caseId: requested.caseId,
      prepPath: "",
    }, notes);
    return resolved ?? { ...requested, path: null };
  }, [view, interviewRouteSearch, notes, calendarEvents, calendarToday]);
  const interviewParams = new URLSearchParams(interviewRouteSearch);
  const reviewInitialKey = calendarInterview?.path ?? interviewParams.get("review");
  const prepInitialPath = calendarInterview ? calendarInterview.path ?? "" : interviewParams.get("prep") ?? "";
  const companyContextPath = calendarInterview?.sourcePath ?? interviewParams.get("context") ?? "";
  const calendarCompanyContext = calendarInterview?.view === "session" && notes.some((note) =>
    note.path === calendarInterview.sourcePath &&
    ["job-case", "todo"].includes(String(note.frontmatter.type)) && Boolean(note.frontmatter.company),
  );

  // 最近安排只表示实际约定；行动期限和外部跟进留在待办与等待区。
  const nextEvent = useMemo(
    () =>
      calendarEvents
        .filter((event) => event.phase === "upcoming")
        .toSorted((left, right) =>
          `${left.date} ${left.time}`.localeCompare(`${right.date} ${right.time}`),
        )[0] ?? null,
    [calendarEvents],
  );

  // ?note= が指すノートが今の scope に無い（他ページのリンクや共有 URL）：黙って開かないのではなく、全量を一度取りに行く。
  useEffect(() => {
    if (!selectedPath || selectedNote || vaultReader.getState().readyScopes.has("all") || vaultReader.getState().loadingScopes.has("all")) return;
    void loadVault({ scope: "all" });
  }, [selectedPath, selectedNote, loadVault, vaultReader]);

  // ⌘K 搜的是「全库」：没去过资料库时只载了当前视图的 scope，打开面板时把 all 补齐，
  // 面板在补齐前会说明「正在载入全部资料」，不把部分结果当成全库。
  useEffect(() => {
    if (!searchOpen || vaultReader.getState().readyScopes.has("all") || vaultReader.getState().loadingScopes.has("all")) return;
    void loadVault({ scope: "all" });
  }, [searchOpen, loadVault, vaultReader]);

  // 「最近打开」记在本机：不论从哪一页、哪种方式打开笔记，都在这里统一记一笔。
  useEffect(() => {
    if (selectedPath) rememberRecentPath(selectedPath);
  }, [selectedPath]);

  const sourceLabel = error ? (locale === "ja" ? "接続中断" : "连接中断") : loading ? ui.loading : ui.connected;
  const syncedAt = fetchedAt
    ? `${new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(fetchedAt)} ${locale === "ja" ? "同期" : "同步"}`
    : locale === "ja" ? "ローカルデータ" : "本地数据源";
  // 相对时间只在这里算：每分钟、以及回到页面时刷新一次时钟，不常驻秒级计时器。
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fetchedAt]);
  const syncedMinutes = fetchedAt && clock ? Math.max(0, Math.floor((clock - fetchedAt) / 60_000)) : null;
  // 一小时以内说「N 分钟前」更好判断新不新；再久就回到具体时刻。超过 10 分钟状态点转警示色。
  const syncedLabel = syncedMinutes === null || syncedMinutes >= 60
    ? syncedAt
    : syncedMinutes < 1 ? ui.syncedJustNow : ui.syncedMinutesAgo.replace("{n}", String(syncedMinutes));
  const syncAged = syncedMinutes !== null && syncedMinutes >= 10 && !error;
  const sourceDetail = derivedState === "rebuilding" ? ui.rebuilding : derivedState === "stale" ? (locale === "ja" ? "集計の更新待ち" : "统计待重算") : syncedLabel;

  /**
   * 切到另一页。alongside 里放「跟着这次导航一起生效」的 state（保存的查询词、看板筛选种子）：
   * 走转场时整段提交要等旧快照截完，提前 set 的 state 会先落在旧页面上（旧条目被改写、旧页被重挂）。
   */
  const navigateToView = useCallback((
    nextView: View,
    search?: URLSearchParams | string,
    preserveJobsInitialFilters = false,
    alongside?: () => void,
  ) => {
    wikiNavigator.cancel();
    // 整段原子提交：只把 setView 放进转场回调的话，其余 state 会先提交，旧页面带着新参数重挂一次才被截图。
    const commit = (mode: ViewTransitionCommitMode) => {
      // 同 popstate：同一页上再点一次导航不重挂容器，data-enter 不能动，否则整页重播入场。
      const entersNewView = nextView !== currentView.current;
      alongside?.();
      setInterviewRouteSearch(typeof search === "string" ? search : search?.toString() ?? "");
      interviewNavigation.current = interviewNavigationKey(nextView, search?.toString() ?? "");
      setInterviewRouteVersion((version) => version + 1);
      // ナビから直接来た時は分析画面由来のフィルタを持ち越さない。
      if (nextView === "jobs" && !preserveJobsInitialFilters) setJobsInitialFilters(null);
      setSelectedPath(null);
      setSelectedSection(null);
      setMobileMoreOpen(false);
      // 离开前把当前位置也盖在这一条历史上：刷新后内存里的表没了，还能靠它回到大致位置。
      window.history.replaceState({ ...(window.history.state ?? {}), __echoScrollY: window.scrollY }, "");
      if (currentEntry.current) scrollByEntry.current.set(currentEntry.current, window.scrollY);
      const entry = newHistoryEntryId();
      window.history.pushState({ __echoAppView: nextView, __echoEntry: entry }, "", appViewHref(nextView, search));
      currentEntry.current = entry;
      setView(nextView);
      if (entersNewView) setViewEnter(mode);
      // 同一页上再点一次导航时，页内放进 URL 的状态要跟着新地址回到默认（pushState 不触发 popstate）。
      notifyUrlChange();
    };
    // 转场回调里用 flushSync 同步提交：新快照要截到已经换好、已滚回顶部的新页。
    // 同一页上再点（重置页内筛选、资料库换查询词）不是「换页」：照原来同步提交，不截快照、不整页上移。
    viewNavigator.navigate({
      transition: nextView !== currentView.current,
      ready: () => viewReady(nextView),
      commit: (mode) => mode === "transition" ? flushSync(() => commit(mode)) : commit(mode),
    });
  }, [viewNavigator, wikiNavigator]);

  // 以下の遷移系コールバックは全部 useCallback：視圖側は React.memo で包んであり、
  // ここが毎レンダー新しい関数だと memo が一度も命中しない。
  const runSavedQuery = useCallback((savedQuery: string) => {
    const params = new URLSearchParams();
    params.set("q", savedQuery);
    // 查询词跟导航同一次提交：先 set 的话，正停在资料库时会被写进旧的历史条目。
    navigateToView("library", params, false, () => setLibraryQuery(savedQuery));
    setSearchOpen(false);
  }, [navigateToView, setSearchOpen]);

  const openReview = useCallback((key?: string) => {
    const params = new URLSearchParams();
    if (key) params.set("review", key);
    navigateToView("review", params);
  }, [navigateToView]);

  const openReviewEvidence = useCallback((ref: AdvisoryEvidenceRef) => {
    navigateToView("review", reviewEvidenceSearch(ref));
  }, [navigateToView]);

  const openInterviewInsights = useCallback(() => navigateToView("insights"), [navigateToView]);

  // 分析页直接打开看板案件抽屉，跟进操作仍使用案件本身的表单。
  const openCase = useCallback((note: Note) => {
    navigateToView("jobs", new URLSearchParams({ status: "all", case: note.path }), true, () => setJobsInitialFilters(null));
  }, [navigateToView]);

  // 筛选种子跟导航同一次提交（见 navigateToView 的 alongside），不先落在还没离开的页面上。
  const viewJobsWithFilters = useCallback((filters?: JobsInitialFilters) => {
    const params = new URLSearchParams();
    if (filters?.statuses?.length) params.set("status", filters.statuses.join(","));
    if (filters?.ratings?.length) params.set("rating", filters.ratings.join(","));
    if (filters?.touch?.length) params.set("touch", filters.touch.join(","));
    if (filters?.waiting) params.set("waiting", "1");
    navigateToView("jobs", params, true, () => setJobsInitialFilters(filters ?? null));
  }, [navigateToView]);

  const openCalendarInterview = useCallback((commitment: Commitment) => {
    const target = calendarInterviewTargets.get(commitment.id);
    if (target) navigateToView(target.view, calendarInterviewSearch(target));
    else openNote(commitment.note);
  }, [calendarInterviewTargets, navigateToView, openNote]);

  // 顶栏「最近安排」直达那场面试的准备页；认不出对应面试的日程才退回日历。
  const openNextEvent = useCallback(() => {
    const target = nextEvent ? calendarInterviewTargets.get(nextEvent.id) : undefined;
    if (target) navigateToView(target.view, calendarInterviewSearch(target));
    else navigateToView("calendar");
  }, [calendarInterviewTargets, navigateToView, nextEvent]);

  const openAnswerLibrary = useCallback(() => navigateToView("prep"), [navigateToView]);

  // 复盘页「准备稿 ↗」：按这场面试的公司・日期・轮次去本场面试页，由那边按同一套规则找到对应准备稿。
  const openReviewSession = useCallback((target: { company: string; date: string; round: string; notePath: string }) => {
    navigateToView("session", calendarInterviewSearch({
      view: "session",
      path: null,
      company: target.company,
      date: target.date,
      label: target.round,
      sourcePath: target.notePath,
      caseId: "",
    }));
  }, [navigateToView]);

  // ⌘K 里的动作：和页面命令同列，但单独一张表（页面命令每个视图恰好一条，由导航表派生）。
  const paletteActions = useMemo<PaletteAction[]>(() => {
    const ja = locale === "ja";
    return [
      { id: "reload", label: ja ? "資料を再読み込み" : "重读资料", description: ja ? "Obsidian から最新の状態を取り直す（R）" : "从 Obsidian 重新读取最新内容（R）", keywords: "重读 刷新 reload refresh 再読み込み 更新", run: () => void loadVault({ fresh: true }) },
      { id: "stats", label: ja ? "統計を再計算" : "重算统计", description: ja ? "台帳と集計の generated 区画を作り直す" : "重新生成台帐与汇总的生成区块", keywords: "统计 重算 汇总 stats rebuild 統計 集計", run: () => void rebuildStats() },
      { id: "theme", label: theme === "dark" ? (ja ? "ライトテーマに切替" : "切换到浅色主题") : (ja ? "ダークテーマに切替" : "切换到暗色主题"), description: ja ? "表示テーマを切り替える" : "切换界面主题", keywords: "主题 暗色 浅色 夜间 dark light theme テーマ ダーク ライト", run: () => setTheme(theme === "dark" ? "light" : "dark") },
      { id: "locale", label: ja ? "中文に切替" : "切换到日本語", description: ja ? "表示言語を切り替える" : "切换界面语言", keywords: "语言 中文 日本語 日语 language 言語", run: () => setLocale(ja ? "zh-CN" : "ja") },
      ...(nextEvent ? [{ id: "next", label: ja ? "次の予定を開く" : "打开下一场", description: `${nextEvent.date} ${nextEvent.company}`, keywords: "下一场 面试 安排 next 次 予定 面接", run: () => openNextEvent() }] : []),
    ];
  }, [locale, theme, setTheme, setLocale, loadVault, rebuildStats, nextEvent, openNextEvent]);

  const syncInterviewSelection = useCallback((company: string, prepPath: string) => {
    const params = new URLSearchParams();
    if (company) params.set("company", company);
    if (prepPath) params.set("prep", prepPath);
    window.history.replaceState(
      { ...(window.history.state ?? {}), __echoAppView: "session" },
      "",
      appViewHref("session", params),
    );
    setInterviewRouteSearch(params.toString());
    interviewNavigation.current = interviewNavigationKey("session", params.toString());
  }, []);

  const syncCompanyContext = useCallback((company: string, contextPath: string, prepPath: string) => {
    const params = companyOverviewSearch(company, contextPath, prepPath);
    window.history.replaceState(
      { ...(window.history.state ?? {}), __echoAppView: "session" }, "", appViewHref("session", params),
    );
    setInterviewRouteSearch(params.toString());
    interviewNavigation.current = interviewNavigationKey("session", params.toString());
  }, []);

  const syncReviewSelection = useCallback((key: string | null) => {
    // 复盘页自己的筛选（filter / pattern）原样留着，外壳只重写自己的键。
    // 换了一场（或回到一览）时，panel / block / sentence 指的是上一场里的位置；
    // 日历带来的 event / date / round 也不再成立，留着会让「回到一览」被当成那场的入口而显示等待页。
    const params = new URLSearchParams(window.location.search);
    for (const owned of SHELL_URL_KEYS) params.delete(owned);
    if (key) params.set("review", key);
    window.history.replaceState(
      { ...(window.history.state ?? {}), __echoAppView: "review" }, "", appViewHref("review", params),
    );
    setInterviewRouteSearch(params.toString());
    interviewNavigation.current = interviewNavigationKey("review", params.toString());
  }, []);

  useEffect(() => {
    if (!calendarInterview || !interviewScopeReady || calendarInterview.view === view) return;
    // 当天的新整理稿可能只在进入面试页后才加载；补齐完成证据后更新同一个历史入口。
    const params = calendarInterviewSearch(calendarInterview);
    window.history.replaceState(
      { ...(window.history.state ?? {}), __echoAppView: calendarInterview.view }, "",
      appViewHref(calendarInterview.view, params),
    );
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  }, [calendarInterview, interviewScopeReady, view]);

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
    navigation.find((item) => item.views.includes(view)) ?? navigation[0];
  const secondaryNavigation =
    secondaryMenus[activeNavigation.id] ?? [];
  const secondaryPlacement = TOP_BAR_SECTION_IDS.has(activeNavigation.id)
    ? "bar"
    : "rail";
  const activeSecondaryLabel =
    secondaryNavigation.find((item) => item.id === view)?.label ?? "";
  useEffect(() => {
    document.title = `${activeSecondaryLabel || activeNavigation.label} · ${branding.name}`;
  }, [activeNavigation.label, activeSecondaryLabel, branding.name]);
  // 左栏只展开当前分区的子项，顶层始终只有 7 个目标。
  const railSecondary = secondaryPlacement === "rail" ? secondaryNavigation : [];
  const mobilePrimaryNavigation = navigation.filter((item) =>
    MOBILE_PRIMARY_NAV_IDS.has(item.id),
  );
  const mobileMoreNavigation = navigation.filter(
    (item) => !MOBILE_PRIMARY_NAV_IDS.has(item.id),
  );
  const mobileMoreActive = mobileMoreNavigation.some((item) =>
    item.views.includes(view),
  );

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label={ui.primaryNav}>
        <a
          className="brand"
          href={appViewHref("calendar")}
          onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigateToView("calendar"); } }}
          aria-label={ui.calendarBack}
        >
          <span className="brand-mark" aria-hidden="true">職</span>
          <span className="brand-copy">
            <strong>{branding.name}</strong>
            <small>CAREER WAR ROOM</small>
          </span>
        </a>

        <nav className="side-nav">
          {navigation.filter((item) => item.placement !== "footer").map((item) => {
            const isActiveSection = item.views.includes(view);
            const subItems = isActiveSection ? railSecondary : [];
            const badge: NavBadge | undefined = navBadges[item.id as keyof NavBadges];
            const badgedLabel = badge ? `${item.label} · ${badge.label}` : undefined;
            return (
              <Fragment key={item.id}>
                <a
                  className={isActiveSection ? "active" : ""}
                  href={appViewHref(item.target)}
                  onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigateToView(item.target); } }}
                  // 指针移上来或 Tab 聚焦时先拉目标页的 chunk：点下去时多半已就绪，转场不必等。
                  onPointerEnter={() => preloadView(item.target)}
                  onFocus={() => preloadView(item.target)}
                  // 有二级项时当前页是子项（左栏或顶部带子里那个），父项不该也自称 page。
                  aria-current={
                    isActiveSection && secondaryNavigation.length === 0 ? "page" : undefined
                  }
                  // 角标本身对读屏隐藏，完整说法并进链接名；折叠态的提示气泡同样带上数字。
                  aria-label={badgedLabel}
                  // 折叠态把文字视觉隐藏，靠这个属性画出 hover 提示气泡。
                  data-label={badgedLabel ?? item.label}
                >
                  <span className="nav-glyph" aria-hidden="true"><NavigationIcon name={item.glyph} /></span>
                  {/* 放在文字前：base.css 的 `span:last-child` 指的是文字。视觉上由 CSS order 排到最右；
                      key 跟着数字走，数字一变就重挂、重播 pop-in。 */}
                  {badge && (
                    <b key={badge.count} className="nav-badge" data-kind={badge.kind} title={badge.label} aria-hidden="true">
                      {badge.count}
                    </b>
                  )}
                  <span>{item.label}</span>
                </a>
                {subItems.length > 0 && (
                  <div
                    className="side-subnav"
                    role="group"
                    aria-label={`${item.label} · ${ui.subNav}`}
                  >
                    {subItems.map((sub) => (
                      <a
                        key={sub.id}
                        className={view === sub.id ? "active" : ""}
                        href={appViewHref(sub.id)}
                        onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigateToView(sub.id); } }}
                        onPointerEnter={() => preloadView(sub.id)}
                        onFocus={() => preloadView(sub.id)}
                        aria-current={view === sub.id ? "page" : undefined}
                        data-label={sub.label}
                      >
                        <span className="nav-glyph" aria-hidden="true">{sub.glyph}</span>
                        <span>{sub.label}</span>
                      </a>
                    ))}
                  </div>
                )}
              </Fragment>
            );
          })}
        </nav>

        <SidebarFooter
          items={navigation.filter((item) => item.placement === "footer")}
          view={view}
          onNavigate={navigateToView}
          onPreload={preloadView}
          renderIcon={(name) => <NavigationIcon name={name} />}
        />

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
            <span className="brand-mark" aria-hidden="true">職</span>
            <strong>{branding.name}</strong>
          </div>

          <div className="topbar-where">
            <span aria-hidden="true"><NavigationIcon name={activeNavigation.glyph} /></span>
            <strong>{activeNavigation.label}</strong>
            {activeSecondaryLabel && <small>{activeSecondaryLabel}</small>}
          </div>

          {/* 当前面试页已经有“本场”倒计时；再放全局下一场会让两家公司同时争夺上下文。 */}
          {/* 日历首页自己有下一场的大卡，顶栏不再重复一条。 */}
          {nextEvent && view !== "session" && view !== "calendar" && (
            <button
              className="topbar-next"
              onClick={openNextEvent}
              title={`${nextEvent.date}${nextEvent.time ? ` ${calendarEventTime(nextEvent)}` : ""} JST ${nextEvent.label}`}
            >
              <small>{ui.nextEvent}</small>
              <em>{countdownLabel(nextEvent.date, new Date(`${calendarToday}T00:00:00`))}{nextEvent.time ? ` ${calendarEventTime(nextEvent)}` : ""} JST</em>
              <strong>{nextEvent.company}</strong>
              <i aria-hidden="true">→</i>
            </button>
          )}

          <button
            className={`topbar-source${syncAged ? " aged" : ""}`}
            onClick={() => void loadVault({ fresh: true })}
            disabled={loading}
            title={`${sourceLabel} · ${sourceDetail}（${ui.reloadHint}）`}
          >
            <span className={`status-dot ${error ? "error" : loading ? "loading" : ""}`} />
            <span className="topbar-source-copy">
              <strong>{sourceLabel}</strong>
              <small>{sourceDetail}</small>
            </span>
          </button>
          {/* 派生統計の再計算：自動（既定）／手動。手動で待重算のときは押せば今すぐ再計算。 */}
          <button
            className={`topbar-stats state-${derivedState}`}
            onClick={derivedState === "stale" ? () => void rebuildStats() : toggleAutoStats}
            disabled={derivedState === "rebuilding"}
            title={statsError || (derivedState === "stale" ? ui.rebuildHint : autoStats ? ui.autoStatsHint : ui.manualStatsHint)}
          >
            {derivedState === "stale" ? ui.rebuild : derivedState === "rebuilding" ? ui.rebuilding : autoStats ? ui.statsAuto : ui.statsManual}
          </button>

          <div className="topbar-keys">
            <button onClick={() => setSearchOpen(true)} aria-label={ui.searchCommands}><kbd>⌘K</kbd>{ui.search}</button>
            <button onClick={() => void loadVault({ fresh: true })} disabled={loading} title={ui.reloadHint}><kbd>R</kbd>{ui.reload}</button>
          </div>
          <ThemeSwitch />
          <LanguageSwitch />
        </header>

        {error && notes.length === 0 && view !== "settings" ? (
          <ConnectionError error={error} onRetry={() => void loadVault()} />
        ) : loading && notes.length === 0 && view !== "settings" ? (
          <LoadingState view={view} />
        ) : (
          <ViewErrorBoundary key={view} label={view}>
            {error && notes.length > 0 && (
              <div className="stale-data-banner" role="status">
                <span>{ui.stalePrefix} {sourceDetail} {ui.staleSuffix}</span>
                <button onClick={() => void loadVault()}>{ui.retry}</button>
              </div>
            )}
            {writeError && (
              <div className="global-write-banner" role="alert">
                <span>{writeError}</span>
                <button onClick={() => setWriteError("")} aria-label={ui.closeNotice}>×</button>
              </div>
            )}
            {secondaryNavigation.length > 0 && (
              <nav
                className="section-nav"
                data-placement={secondaryPlacement}
                aria-label={`${activeNavigation.label} · ${ui.subNav}`}
              >
                {/* 分区名现在由顶栏的位置指示器说，这条带子只负责章节标签本身。 */}
                <div className="section-nav-tabs">
                  {secondaryNavigation.map((item) => (
                    <a
                      key={item.id}
                      className={view === item.id ? "active" : ""}
                      href={appViewHref(item.id)}
                      onClick={(event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigateToView(item.id); } }}
                      onPointerEnter={() => preloadView(item.id)}
                      onFocus={() => preloadView(item.id)}
                      aria-current={view === item.id ? "page" : undefined}
                    >
                      <i aria-hidden="true">{item.glyph}</i>
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.caption}</small>
                      </span>
                    </a>
                  ))}
                </div>
              </nav>
            )}
            <div className="view-container" data-enter={viewEnter === "transition" ? "transition" : undefined}>
              <Suspense fallback={<LoadingState view={view} />}>
              {calendarInterview && (!interviewScopeReady || calendarInterview.view !== view || (!calendarInterview.path && !calendarCompanyContext)) && (
                <CalendarInterviewState
                  target={calendarInterview}
                  loading={(!interviewScopeReady && !error) || calendarInterview.view !== view}
                  onOpenSource={notes.some((note) => note.path === calendarInterview.sourcePath)
                    ? () => openNote(notes.find((note) => note.path === calendarInterview.sourcePath)!)
                    : undefined}
                  onShowAll={() => navigateToView(calendarInterview.view)}
                />
              )}
              {view === "review" && (!calendarInterview || (interviewScopeReady && calendarInterview.view === view && calendarInterview.path)) && (
                <InterviewReview
                  loading={!scopeReady}
                  key={interviewRouteVersion}
                  notes={notes}
                  onVaultChanged={loadVault}
                  onNoteWritten={patchNote}
                  initialSelectedKey={reviewInitialKey}
                  initialPanel={interviewParams.get("panel") === "source" ? "source" : interviewParams.get("panel") === "quality" ? "quality" : "advisory"}
                  initialBlockId={interviewParams.get("block")}
                  initialSentenceId={interviewParams.get("sentence")}
                  onOpenEvidence={openReviewEvidence}
                  onOpenInsights={openInterviewInsights}
                  onSelectionChange={syncReviewSelection}
                  onOpenNote={openNote}
                  onOpenSession={openReviewSession}
                />
              )}
              {view === "insights" && <InterviewInsights notes={notes} onOpenEvidence={openReviewEvidence} onOpenReview={openReview}
                onVaultChanged={loadVault} onNoteWritten={patchNote} />}
              {view === "practice" && (
                <InterviewPractice
                  loading={!scopeReady && !error}
                  notes={notes}
                  today={today}
                  onNoteWritten={patchNote}
                  onOpenEvidence={openReviewEvidence}
                />
              )}
              {view === "session" && (!calendarInterview || (interviewScopeReady && calendarInterview.view === view && (calendarInterview.path || calendarCompanyContext))) && (
                <InterviewSession
                  key={`${interviewRouteVersion}:${interviewScopeReady}`}
                  notes={notes}
                  today={today}
                  onOpen={openNote}
                  onOpenWiki={openWikiLink}
                  onOpenCard={openPrepCard}
                  onOpenAsset={openSharedAsset}
                  onOpenLibrary={openAnswerLibrary}
                  initialCompany={interviewParams.get("company") ?? ""}
                  initialPath={prepInitialPath}
                  initialContextPath={companyContextPath}
                  forceOverviewOnly={Boolean(calendarInterview && !calendarInterview.path && calendarCompanyContext)}
                  onSelectionChange={syncInterviewSelection}
                  onContextChange={syncCompanyContext}
                  onOpenInsights={openInterviewInsights}
                />
              )}
              {view === "prep" && (
                <InterviewPrep
                  loading={!scopeReady}
                  notes={notes}
                  onOpen={openNote}
                  syncUrl
                />
              )}
              {view === "language" && (
                <JapaneseTraining onVaultChanged={loadVault} onQuickSummary={onQuickSummary} />
              )}
              {view === "topics" && (
                <LanguageExpressionCourses
                  loading={!scopeReady}
                  notes={notes}
                  onOpen={openNote}
                  onOpenWiki={openWikiLink}
                  onVaultChanged={loadVault}
                  onNoteWritten={patchNote}
                />
              )}
              {view === "jobs" && (
                <JobsView
                  loading={!scopeReady && !error}
                  notes={notes}
                  today={today}
                  onOpen={openNote}
                  onVaultChanged={loadVault}
                  onNoteWritten={patchNote}
                  initialFilters={jobsInitialFilters}
                  onFlash={showFlash}
                />
              )}
              {view === "analytics" && (
                <JobsAnalytics
                  loading={!scopeReady}
                  notes={notes}
                  onOpen={openNote}
                  onOpenCase={openCase}
                  onViewJobs={viewJobsWithFilters}
                  derivedState={derivedState}
                  statsError={statsError}
                  onRebuildStats={rebuildStats}
                />
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
                  events={calendarEvents}
                  notes={notes}
                  today={calendarToday}
                  loading={!scopeReady}
                  onOpen={openNote}
                  interviewTargets={calendarInterviewTargets}
                  onInterview={openCalendarInterview}
                />
              )}
              {view === "timeline" && (
                <TimelineView
                  today={today}
                  items={derived.timeline}
                  events={derived.calendarEvents}
                  onOpen={openNote}
                />
              )}
              {view === "library" && (
                <LibraryView
                  loading={!scopeReady}
                  notes={notes}
                  filter={groupFilter}
                  query={libraryQuery}
                  onFilter={setGroupFilter}
                  onQuery={setLibraryQuery}
                  onOpen={openNote}
                />
              )}
              {view === "settings" && (
                <SettingsView
                  connection={{ ok: !error, loading, fetchedAt, error }}
                  autoStats={autoStats}
                  onToggleAutoStats={toggleAutoStats}
                  derivedState={derivedState}
                  statsError={statsError}
                  onRebuildStats={() => void rebuildStats()}
                  onReload={() => void loadVault({ fresh: true })}
                />
              )}
              </Suspense>
            </div>
          </ViewErrorBoundary>
        )}
      </main>

      <nav className="mobile-nav" aria-label={ui.mobileNav}>
        {mobilePrimaryNavigation.map((item) => (
          <button
            key={item.id}
            className={item.views.includes(view) ? "active" : ""}
            onClick={() => navigateToView(item.target)}
            aria-current={item.views.includes(view) ? "page" : undefined}
          >
            <span aria-hidden="true"><NavigationIcon name={item.glyph} /></span>
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
          {ui.more}
        </button>
      </nav>

      {mobileMoreOpen && (
        <nav id="mobile-more-menu" className="mobile-more-menu" aria-label={ui.mobileMore}>
          <small>{ui.moreFeatures}</small>
          {mobileMoreNavigation.map((item) => (
            <button
              key={item.id}
              className={item.views.includes(view) ? "active" : ""}
              onClick={() => navigateToView(item.target)}
            >
              <span aria-hidden="true"><NavigationIcon name={item.glyph} /></span>
              {item.label}
            </button>
          ))}
        </nav>
      )}

      <UndoFlashBar state={undoFlash} />
      {wikiNotice && (
        <div className="wiki-navigation-notice" role="status" aria-live="polite">
          <span>{locale === "ja"
            ? wikiNotice.kind === "loading" ? "ノートを探しています…" : wikiNotice.kind === "ambiguous" ? "同名のノートが複数あります。完全なパスで指定してください。" : "該当するノートが見つかりません。"
            : wikiNotice.kind === "loading" ? "正在查找笔记…" : wikiNotice.kind === "ambiguous" ? "同名笔记有多篇，请使用完整路径。" : "找不到这篇笔记。"}</span>
          <button type="button" onClick={() => wikiNavigator.cancel()} aria-label={ui.closeNotice}>×</button>
        </div>
      )}

      {searchOpen && (
        <SearchPalette
          notes={notes}
          onOpen={openNote}
          onQuery={runSavedQuery}
          onClose={() => setSearchOpen(false)}
          onNavigate={(target) => navigateToView(target)}
          allReady={readyScopes.has("all")}
          actions={paletteActions}
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

      {selectedNote && (view === "graph" || view === "timeline" ? (
        <SceneNoteReader
          note={selectedNote}
          section={selectedSection}
          allNotes={notes}
          wikiIndexComplete={readyScopes.has("all")}
          scene={view}
          closing={noteExiting}
          onClose={closeSceneNote}
          onOpenWiki={openWikiLink}
          onOpen={openNote}
        />
      ) : (
        <NoteDrawer
          note={selectedNote}
          section={selectedSection}
          allNotes={notes}
          wikiIndexComplete={readyScopes.has("all")}
          closing={noteExiting}
          onClose={closeNote}
          onOpenWiki={openWikiLink}
          onOpen={openNote}
        />
      ))}
    </div>
  );
}


/** 首屏骨架按将要打开的页面画：日历是月格，岗位・分析是卡片，其余是阅读两栏。 */
function loadingShape(view: View) {
  if (view === "calendar") return "calendar";
  if (view === "jobs" || view === "analytics" || view === "library") return "cards";
  return "columns";
}

function LoadingState({ view }: { view: View }) {
  const { locale } = useUiLocale();
  const ui = SHELL_MESSAGES[locale];
  const shape = loadingShape(view);
  const count = shape === "calendar" ? 35 : shape === "cards" ? 6 : 8;
  return (
    <div className="loading-state">
      <div className="loading-orbit"><i /><i /><i /><strong>職</strong></div>
      <h1>{ui.loadingTitle}</h1>
      <p>{ui.loadingDetail}</p>
      <div className="loading-skeleton" data-shape={shape} aria-hidden="true">
        {Array.from({ length: count }, (_, index) => <i key={index} className="skeleton" />)}
      </div>
    </div>
  );
}

/** 连不上时按 3→6→12→24→30 秒退避自动重连；凭证错误重试也没用，只给手动按钮。 */
const RECONNECT_DELAYS = [3, 6, 12, 24, 30];

function ConnectionError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { locale } = useUiLocale();
  const ui = SHELL_MESSAGES[locale];
  const detail = describeConnectionError(error);
  const autoRetry = detail.kind === "unreachable";
  const [attempt, setAttempt] = useState(0);
  const [remaining, setRemaining] = useState(RECONNECT_DELAYS[0]);
  // 外壳每次重渲染都会传一个新的 onRetry；倒计时只认最新的那个，不因此重新开始。
  const retryRef = useRef(onRetry);
  useEffect(() => {
    retryRef.current = onRetry;
  });
  useEffect(() => {
    if (!autoRetry) return;
    const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
    let left = delay;
    const reset = window.setTimeout(() => setRemaining(delay), 0);
    const timer = window.setInterval(() => {
      left -= 1;
      setRemaining(left);
      if (left <= 0) {
        window.clearInterval(timer);
        setAttempt((current) => current + 1);
        retryRef.current();
      }
    }, 1000);
    return () => {
      window.clearTimeout(reset);
      window.clearInterval(timer);
    };
  }, [attempt, autoRetry]);
  return (
    <div className="connection-error" data-kind={detail.kind}>
      <span className="error-code">LOCAL / OFFLINE</span>
      <h1>{detail.title}</h1>
      <p>{detail.hint}</p>
      <ol className="connection-steps">
        {ui.connectionSteps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <code>{error}</code>
      <button onClick={onRetry}>
        {ui.reconnect} <span>↻</span>
        {autoRetry && <small>{ui.retryIn.replace("{n}", String(Math.max(0, remaining)))}</small>}
      </button>
    </div>
  );
}

export default MemoryAtlas;
