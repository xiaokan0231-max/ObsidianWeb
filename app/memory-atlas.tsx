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
import JapaneseTraining from "./japanese-training";
import LanguageExpressionCourses from "./language-expression-courses";
import JobsAnalytics from "./jobs-analytics";
import JobsView from "./jobs-view";
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
  parseAnnotations,
  parseSeirikou,
  reviewDecisionTasks,
  uniqueAnnotations,
} from "@/lib/review";
import {
  parseInterviewAnswerReview,
  REVIEW_DIMENSION_META,
  type InterviewAnswerReview,
  type ReviewDimensionKey,
} from "@/lib/review-deep";
import { JOB_CASE_TYPE } from "@/lib/vault-boundary.mjs";
import type { SharedAssetTarget } from "@/lib/interview-shared-assets";
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

const ThreeKnowledgeGraph = lazy(() => import("./knowledge-graph-three"));
const ThreeTimeCorridor = lazy(() => import("./timeline-three"));

export type { Note };

type VaultResponse = {
  connected: boolean;
  fetchedAt?: number;
  error?: string;
  notes: Note[];
};

type View = "overview" | "session" | "prep" | "review" | "language" | "topics" | "jobs" | "analytics" | "todo" | "graph" | "calendar" | "timeline" | "library";
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
};

type CalendarEvent = {
  id: string;
  note: Note;
  date: string;
  time: string;
  company: string;
  label: string;
  phase: "upcoming" | "past";
};

type ReviewPreviewDoc = {
  key: string;
  company: string;
  date: string;
  round: string;
  decisionTotal: number;
  pendingDecisions: number;
  deepReview?: InterviewAnswerReview;
};

type ReviewPreview = {
  docs: ReviewPreviewDoc[];
  reviewedCount: number;
  pendingDecisions: number;
  readyCount: number;
  scoreDoc: ReviewPreviewDoc | null;
  actionDoc: ReviewPreviewDoc | null;
};

const GROUPS = {
  self: {
    label: "关于我",
    short: "我",
    color: "#e66d45",
    tint: "#f9ddd0",
  },
  career: {
    label: "求职",
    short: "职",
    color: "#2f6b59",
    tint: "#d8e9df",
  },
  study: {
    label: "日语学习",
    short: "学",
    color: "#7466a9",
    tint: "#e3def2",
  },
  analysis: {
    label: "AI 分析",
    short: "析",
    color: "#b5842f",
    tint: "#f3e6c8",
  },
  system: {
    label: "系统",
    short: "规",
    color: "#66706c",
    tint: "#e5e7e4",
  },
} as const;

type GroupKey = keyof typeof GROUPS;
type LibraryScope = "all" | "evidence" | "action" | "interview" | "language" | "analysis";
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
    { id: "session", label: "当前面试" },
    { id: "prep", label: "通用准备" },
    { id: "review", label: "面试复盘" },
  ],
  training: [
    { id: "language", label: "日语训练" },
    { id: "topics", label: "专项训练" },
  ],
  resources: [
    { id: "library", label: "全部资料" },
    { id: "timeline", label: "时间线" },
    { id: "graph", label: "关系图" },
  ],
};

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
    <section
      className="prep-card-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prep-card-overlay-title"
    >
      <header className="prep-card-overlay-bar">
        <button ref={backRef} type="button" onClick={onClose}>
          <span aria-hidden="true">←</span>
          返回本场面试
        </button>
        <div>
          <small>STANDARD ANSWER LIBRARY</small>
          <strong id="prep-card-overlay-title">回答库 · {cardId}</strong>
        </div>
        <span><kbd>Esc</kbd> 也可返回</span>
      </header>
      <div className="prep-card-overlay-content">
        <InterviewPrep
          key={cardId}
          notes={notes}
          onOpen={onOpen}
          initialCardId={cardId}
        />
      </div>
    </section>
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
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
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
      restore();
      window.setTimeout(restore, 0);
      window.setTimeout(() => {
        restore();
        window.history.scrollRestoration = scrollRestoration;
      }, 80);
    };
  }, [origin.x, origin.y]);

  return (
    <section
      className="prep-card-overlay shared-asset-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shared-asset-overlay-title"
    >
      <header className="prep-card-overlay-bar">
        <button ref={backRef} type="button" onClick={onClose}>
          <span aria-hidden="true">←</span>
          返回本场面试
        </button>
        <div>
          <small>
            {target.scope === "company"
              ? "THIS INTERVIEW · COMPANY MOTIVATION"
              : "COMMON INTERVIEW ASSET"}
          </small>
          <strong id="shared-asset-overlay-title">{target.label}</strong>
        </div>
        <span><kbd>Esc</kbd> 也可返回</span>
      </header>
      <div className="prep-card-overlay-content shared-asset-overlay-content">
        <InterviewSharedAsset
          key={`${target.note}#${target.section ?? ""}#${target.defaultSection ?? ""}`}
          note={note}
          target={target}
          onOpenCard={onOpenCard}
          onOpenWiki={onOpenWiki}
        />
      </div>
    </section>
  );
}

function getGroup(path: string): GroupKey {
  if (path.startsWith("10_")) return "self";
  if (path.startsWith("20_")) return "career";
  if (path.startsWith("30_")) return "study";
  if (path.startsWith("80_")) return "analysis";
  return "system";
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    self: "人工确认",
    company: "公司卷宗",
    review: "复盘证据",
    transcript: "逐字稿",
    "transcript-study": "逐字稿研究",
    "study-annotation": "逐字稿批注",
    study: "学习资料",
    "ai-report": "AI 观点",
    "ai_review_request": "AI 审查请求",
    "ai_review_result": "AI 审查结果",
    analysis: "综合分析",
    "deep-thought-evidence": "深度思考证据",
    "deep-thought-opinion": "独立分析观点",
    "interview-answer-review": "回答质量复盘",
    "interview-answer-practice": "回答重练队列",
    "interview-answer-feedback": "回答质量批注",
    "interview-prep-library": "面试标准回答库",
    "interview-prep": "面试轮次准备",
    policy: "规则",
    "policy-change": "规则变更",
    material: "素材",
    "training-profile": "训练画像",
    "training-lesson": "训练教材",
    "training-log": "训练记录",
    "language-curriculum": "训练课程",
    "language-bank": "语言素材库",
    "language-session-log": "训练会话",
    "language-coach-log": "教练记录",
    "language-batch-log": "训练批次",
    "language-expression-course-progress": "专项训练进度",
    "practice-log": "教练练习",
    "exam-log": "考试记录",
    [JOB_CASE_TYPE]: "应募案件",
    "excluded-job": "已排除岗位",
    "job-audit": "案件审计",
    "job-queue": "岗位队列",
    job_platform_sync: "平台同步",
    application_log: "应募记录",
    "outbound-draft": "联络草稿",
    application_documents: "应募材料",
    application_documents_review: "材料审查",
    application_documents_changelog: "材料变更记录",
    application_document_strategy: "材料策略",
    mail: "邮件证据",
    "review-request": "复盘请求",
    ledger: "台账",
    todo: "待办",
    moc: "索引",
    note: "笔记",
  };
  return labels[type] ?? type.replace(/[-_]+/g, " ");
}

function trustLayer(note: Note) {
  const type = getType(note);
  if (type === "self") {
    return { label: "权威事实", className: "trust-authority" };
  }
  if (["review", "transcript", "company", JOB_CASE_TYPE, "policy"].includes(type)) {
    return { label: "证据层", className: "trust-evidence" };
  }
  if (["ai-report", "interview-answer-review"].includes(type)) {
    return { label: "分析 / 假设", className: "trust-analysis" };
  }
  return { label: "导航 / 素材", className: "trust-reference" };
}

function libraryScopeMatches(note: Note, scope: LibraryScope) {
  const type = getType(note);
  if (scope === "all") return true;
  if (scope === "evidence") {
    return ["trust-authority", "trust-evidence"].includes(trustLayer(note).className);
  }
  if (scope === "action") {
    return [
      JOB_CASE_TYPE,
      "todo",
      "job-queue",
      "job-audit",
      "application_log",
      "outbound-draft",
    ].includes(type);
  }
  if (scope === "interview") {
    return [
      "review",
      "transcript",
      "transcript-study",
      "study-annotation",
      "interview-prep",
      "interview-prep-library",
      "interview-answer-review",
      "interview-answer-practice",
      "interview-answer-feedback",
    ].includes(type);
  }
  if (scope === "language") {
    return getGroup(note.path) === "study" || type.startsWith("language-") || type.startsWith("training-");
  }
  return getGroup(note.path) === "analysis" || [
    "ai-report",
    "analysis",
    "deep-thought-evidence",
    "deep-thought-opinion",
    "ai_review_request",
    "ai_review_result",
  ].includes(type);
}

function notePreview(note: Note) {
  const text = stripMarkdown(note.content).replace(/\s+/g, " ").trim();
  const title = stripMarkdown(getTitle(note)).replace(/\s+/g, " ").trim();
  const withoutRepeatedTitle = text.startsWith(title) ? text.slice(title.length).trim() : text;
  return withoutRepeatedTitle || "这篇记忆暂时没有可预览的正文。";
}

function noteFolder(path: string) {
  const folders = path.split("/").slice(0, -1);
  return folders.length ? folders.join(" / ") : "Vault 根目录";
}

function extractLinks(content: string) {
  return Array.from(content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g))
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function getNoteDate(note: Note) {
  const frontmatterDate = getString(note.frontmatter.date);
  const filenameDate = note.path.match(/(20\d{2}-\d{2}-\d{2})/)?.[1];
  return frontmatterDate || filenameDate || "";
}

function getLatestNoteDate(note: Note) {
  const contentDates = Array.from(
    note.content.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g),
    (match) => match[1],
  );
  const candidates = [
    getString(note.frontmatter.updated),
    getString(note.frontmatter.date),
    ...contentDates,
  ].filter((value) => /^20\d{2}-\d{2}-\d{2}$/.test(value));

  if (candidates.length > 0) {
    return candidates.sort((left, right) => right.localeCompare(left))[0];
  }

  return new Date(note.stat.mtime).toISOString().slice(0, 10);
}

function careerStatus(status: string) {
  if (["応募済", "書類通過", "面接中"].includes(status)) {
    return { label: status, tone: "active" };
  }
  if (status.includes("不採用")) return { label: "不採用", tone: "rejected" };
  if (status.includes("未応募")) return { label: "未応募", tone: "idle" };
  if (status.includes("辞退")) return { label: "辞退", tone: "idle" };
  return { label: status || "未分類", tone: "idle" };
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const ACTIVE_JOB_STATUSES = new Set(["応募済", "書類通過", "面接中"]);

function buildReviewPreview(notes: Note[]): ReviewPreview {
  const studies = notes.filter((note) => getType(note) === "transcript-study");
  const annotationNotes = notes.filter((note) => getType(note) === "study-annotation");
  const deepReviewNotes = notes.filter((note) => getType(note) === "interview-answer-review");
  const docs = studies
    .map((note): ReviewPreviewDoc => {
      const company = getString(note.frontmatter.company);
      const date = getString(note.frontmatter.date);
      const round = getString(note.frontmatter.round);
      const annotationNote = annotationNotes.find(
        (candidate) =>
          getString(candidate.frontmatter.company) === company &&
          getString(candidate.frontmatter.date) === date,
      );
      const deepReviewNote = deepReviewNotes.find(
        (candidate) =>
          getString(candidate.frontmatter.company) === company &&
          getString(candidate.frontmatter.date) === date &&
          getString(candidate.frontmatter.round) === round,
      );
      const parsed = parseSeirikou(note.content);
      const annotations = annotationNote
        ? uniqueAnnotations(parseAnnotations(annotationNote.content))
        : [];
      const decisions = reviewDecisionTasks(parsed.sentences, annotations);
      return {
        key: note.path,
        company,
        date,
        round,
        decisionTotal: decisions.length,
        pendingDecisions: decisions.filter((item) => !item.resolvedBy).length,
        deepReview: deepReviewNote
          ? parseInterviewAnswerReview(deepReviewNote.content) ?? undefined
          : undefined,
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date));
  const reviewedCount = docs.filter((doc) => doc.deepReview).length;
  const pendingDecisions = docs.reduce((total, doc) => total + doc.pendingDecisions, 0);
  const readyCount = docs.filter((doc) => doc.pendingDecisions === 0 && !doc.deepReview).length;
  const scoreDoc = docs.find((doc) => doc.deepReview) ?? null;
  const actionDoc =
    docs.find((doc) => doc.pendingDecisions > 0) ??
    docs.find((doc) => !doc.deepReview) ??
    scoreDoc ??
    docs[0] ??
    null;
  return { docs, reviewedCount, pendingDecisions, readyCount, scoreDoc, actionDoc };
}

function calendarEventLabel(text: string) {
  if (/エージェント面談|猎头面谈/.test(text)) return "猎头面谈";
  if (/カジュアル面談|轻松面谈/.test(text)) return "轻松面谈";
  if (/最終面接|最终面试/.test(text)) return "最终面试";
  if (/一次面接|一面/.test(text)) return "第一次面试";
  if (/二次面接|二面/.test(text)) return "第二次面试";
  if (/セミナー|说明会/.test(text)) return "招聘说明会";
  if (/面接|面试/.test(text)) return "面试";
  return "面谈";
}

function buildCalendarEvents(notes: Note[]): CalendarEvent[] {
  const today = localDateKey();
  const events = new Map<string, CalendarEvent>();

  const addEvent = (note: Note, date: string, source: string, priority: number) => {
    const company = getString(note.frontmatter.company) || getTitle(note);
    const label = calendarEventLabel(source || getTitle(note));
    const time = source.match(/(?:^|\D)((?:[01]?\d|2[0-3]):[0-5]\d)(?:\D|$)/)?.[1] ?? "";
    const key = `${company.toLowerCase()}|${date}`;
    const candidate: CalendarEvent & { priority: number } = {
      id: `${key}|${note.path}`,
      note,
      date,
      time,
      company,
      label,
      phase: date >= today ? "upcoming" : "past",
      priority,
    };
    const current = events.get(key) as (CalendarEvent & { priority?: number }) | undefined;
    if (!current || (current.priority ?? 0) < priority) events.set(key, candidate);
  };

  notes.forEach((note) => {
    const type = getType(note);
    const frontmatterDate = getString(note.frontmatter.date);
    if (["review", "transcript"].includes(type) && /^20\d{2}-\d{2}-\d{2}$/.test(frontmatterDate)) {
      addEvent(note, frontmatterDate, getTitle(note), type === "review" ? 4 : 3);
    }

    // エージェント面談・説明会など単一案件に紐づかない予定は todo の next_event_at が正本。
    // 旧 next_action は移行中の互換入力としてだけ残す。
    //（2026-07-24 ワークポート面談が job-case 側に存在せず日历から漏れた実証）。
    // todo 本文は経緯メモが多く誤検出するので frontmatter しか読まない。完了済みは予定ではない。
    if (type === "todo" && todoStatus(note) !== "完了") {
      const line =
        getString(note.frontmatter.next_event_at) ||
        getString(note.frontmatter.next_action);
      const date = line.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
      if (date) addEvent(note, date, line, 3);
      return;
    }

    // 確定日程は next_event_at を正本にする。自由文 next_action の日付を正本扱いすると、
    // 「7/29 に返信済み」のような履歴日を未来の締切・面接日に誤認するため。
    // company 本文を再走査すると、同じ面接が証拠記述と案件で二重表示される。
    if (type !== JOB_CASE_TYPE) return;
    const sources = [
      { line: getString(note.frontmatter.next_event_at), priority: 4, trusted: true },
      { line: getString(note.frontmatter.next_action), priority: 3, trusted: true },
      ...stripFrontmatter(note.content)
        .split("\n")
        .map((line) => ({ line, priority: 2, trusted: false })),
    ];
    sources.forEach(({ line, priority, trusted }) => {
      if (!/(?:面接|面談|面试|面谈|カジュアル|セミナー|说明会)/.test(line)) return;
      if (!trusted && /(?:通知|リマインド|案内|お礼|準備|証拠|応募|スカウト|不採用|結果)/.test(line)) return;
      const date = line.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
      if (date) addEvent(note, date, line, priority);
    });
  });

  return Array.from(events.values()).sort((left, right) => {
    const byDate = left.date.localeCompare(right.date);
    if (byDate) return byDate;
    return left.time.localeCompare(right.time);
  });
}

function noteMatches(note: Note, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  const haystack = `${note.path}\n${note.content}\n${JSON.stringify(note.frontmatter)}`.toLowerCase();
  return query.split(/\s+/).every((token) => {
    const [prefix, ...rest] = token.split(":");
    const value = rest.join(":");
    if (!value) return haystack.includes(token);
    if (prefix === "type") return getType(note).toLowerCase().includes(value);
    if (prefix === "status") {
      return getString(note.frontmatter.status).toLowerCase().includes(value);
    }
    if (prefix === "folder") return note.path.toLowerCase().includes(value);
    return haystack.includes(token);
  });
}

function countMatches(content: string, expression: RegExp) {
  return Array.from(content.matchAll(expression)).length;
}

function MemoryAtlas() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [view, setView] = useState<View>("overview");
  const [reviewInitialKey, setReviewInitialKey] = useState<string | null>(null);
  // 本场面试を残したまま、その上に全幅で開く回答库カード
  const [prepOverlayCard, setPrepOverlayCard] = useState<string | null>(null);
  const [prepOverlayOrigin, setPrepOverlayOrigin] = useState({ x: 0, y: 0 });
  const [sharedAssetOverlay, setSharedAssetOverlay] = useState<SharedAssetTarget | null>(null);
  const [sharedAssetOrigin, setSharedAssetOrigin] = useState({ x: 0, y: 0 });
  // 求職分析から「進行中 N 件をすべて見る」で飛んできた時だけ、求人一覧に状態フィルタを引き継ぐ。
  const [jobsInitialStatuses, setJobsInitialStatuses] = useState<string[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState<GroupKey | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 模块间切换不继承上一页的滚动位置，否则新页面会从标题或工具栏中段开始。
  useEffect(() => {
    window.scrollTo({ left: 0, top: 0 });
  }, [view]);

  const loadVault = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/vault", { cache: "no-store" });
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
          ...("scope" in asset && (asset.scope === "shared" || asset.scope === "company")
            ? { scope: asset.scope }
            : {}),
        });
      } else {
        setSharedAssetOverlay(null);
      }
    };
    const onPopState = (event: PopStateEvent) => syncOverlays(event.state);
    syncOverlays(window.history.state);
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
        setSearchOpen(true);
        searchRef.current?.focus();
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

  const searchResults = useMemo(
    () => notes.filter((note) => noteMatches(note, query)).slice(0, 8),
    [notes, query],
  );

  const derived = useMemo(() => {
    const links = notes.flatMap((note) => extractLinks(note.content));
    const linkedNames = new Set(links);
    const orphanCount = notes.filter(
      (note) =>
        extractLinks(note.content).length === 0 &&
        !linkedNames.has(noteBasename(note.path)) &&
        getType(note) !== "moc",
    ).length;
    const cases = notes
      .filter((note) => getType(note) === JOB_CASE_TYPE)
      .sort((left, right) => {
        const byDate = getString(right.frontmatter.status_updated).localeCompare(
          getString(left.frontmatter.status_updated),
        );
        return byDate || right.stat.mtime - left.stat.mtime;
      });
    const reviews = notes.filter((note) => getType(note) === "review" && !note.path.includes("/模板/"));
    const timeline = notes
      .map((note) => ({ note, date: getNoteDate(note) }))
      .filter((item) => item.date)
      .sort((left, right) => right.date.localeCompare(left.date));
    const calendarEvents = buildCalendarEvents(notes);
    const errorDictionary = notes.find((note) => noteBasename(note.path) === "誤用辞典");
    const promotedCorrections = notes.find(
      (note) => noteBasename(note.path) === "日本語矯正_精選",
    );
    const highPriorityErrors = errorDictionary
      ? countMatches(errorDictionary.content, /重要度:高/g)
      : 0;
    const totalErrors = errorDictionary
      ? countMatches(errorDictionary.content, /^###\s+❌/gm)
      : 0;
    const promoted = promotedCorrections
      ? countMatches(promotedCorrections.content, /^###\s+/gm)
      : 0;
    const selfNotes = notes.filter((note) => getType(note) === "self");
    const incompleteSelf = selfNotes.filter((note) =>
      /迁移时|ここに|人工晋升|^-[^\n:]+:\s*$/m.test(note.content),
    ).length;
    const evidenceNotes = notes.filter(
      (note) =>
        ["review", "transcript", "company"].includes(getType(note)) &&
        !note.path.includes("/模板/"),
    );
    const completeEvidence = evidenceNotes.filter((note) => {
      const type = getType(note);
      if (type === "company") {
        return Boolean(getString(note.frontmatter.company));
      }
      if (type === "review") {
        return Boolean(getString(note.frontmatter.company) && getString(note.frontmatter.date) && getString(note.frontmatter.result));
      }
      return Boolean(getString(note.frontmatter.company) && getString(note.frontmatter.date) && typeof note.frontmatter.reviewed === "boolean");
    }).length;

    return {
      links: links.length,
      orphanCount,
      cases,
      reviews,
      timeline,
      calendarEvents,
      totalErrors,
      highPriorityErrors,
      promoted,
      incompleteSelf,
      selfNotes: selfNotes.length,
      analysisCount: notes.filter((note) => getType(note) === "ai-report").length,
      evidenceCount: evidenceNotes.length,
      evidenceCompleteness: evidenceNotes.length ? (completeEvidence / evidenceNotes.length) * 100 : 0,
    };
  }, [notes]);

  const runSavedQuery = (savedQuery: string) => {
    setQuery(savedQuery);
    setView("library");
    setSearchOpen(false);
  };

  const navigateToView = (nextView: View) => {
    if (nextView === "review") setReviewInitialKey(null);
    // ナビから直接来た時は分析画面由来のフィルタを持ち越さない。
    if (nextView === "jobs") setJobsInitialStatuses(null);
    setMobileMoreOpen(false);
    setView(nextView);
  };

  const activeNavigation =
    NAVIGATION.find((item) => item.views.includes(view)) ?? NAVIGATION[0];
  const secondaryNavigation =
    SECONDARY_NAVIGATION[activeNavigation.id] ?? [];
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
        <button className="brand" onClick={() => setView("overview")} aria-label="返回总览">
          <span className="brand-mark">回</span>
          <span className="brand-copy">
            <strong>回声</strong>
            <small>CAREER WAR ROOM</small>
          </span>
        </button>

        <nav className="side-nav">
          {NAVIGATION.map((item) => (
            <button
              key={item.id}
              className={item.views.includes(view) ? "active" : ""}
              onClick={() => navigateToView(item.target)}
              aria-current={item.views.includes(view) ? "page" : undefined}
              // 折叠态把文字视觉隐藏，靠这个属性画出 hover 提示气泡。
              data-label={item.label}
            >
              <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div
          className="source-status"
          title={`${error ? "连接中断" : loading ? "正在读取" : "Obsidian 已连接"} · ${fetchedAt ? `${formatDate(fetchedAt)} 同步` : "本地数据源"}`}
        >
          <span className={`status-dot ${error ? "error" : loading ? "loading" : ""}`} />
          <div>
            <strong>{error ? "连接中断" : loading ? "正在读取" : "Obsidian 已连接"}</strong>
            <small>{fetchedAt ? `${formatDate(fetchedAt)} 同步` : "本地数据源"}</small>
          </div>
        </div>

        <RailToggle />
      </aside>

      <main className="main-stage">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark">回</span>
            <strong>回声</strong>
          </div>
          <div className="search-wrap">
            <span className="search-icon" aria-hidden="true">⌕</span>
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter" && searchResults[0]) {
                  openNote(searchResults[0]);
                }
              }}
              placeholder="搜索记忆、公司、日语错误…"
              aria-label="搜索记忆库"
            />
            <kbd>⌘ K</kbd>
            {searchOpen && (
              <SearchPanel
                query={query}
                notes={searchResults}
                onOpen={openNote}
                onQuery={runSavedQuery}
                onClose={() => setSearchOpen(false)}
              />
            )}
          </div>
          <button className="sync-button" onClick={() => void loadVault()} disabled={loading}>
            <span aria-hidden="true">↻</span>
            {loading ? "读取中" : "刷新记忆"}
          </button>
        </header>

        {error ? (
          <ConnectionError error={error} onRetry={() => void loadVault()} />
        ) : loading && notes.length === 0 ? (
          <LoadingState />
        ) : (
          <>
            {secondaryNavigation.length > 0 && (
              <nav className="section-nav" aria-label={`${activeNavigation.label}二级导航`}>
                <span>{activeNavigation.label}</span>
                <div>
                  {secondaryNavigation.map((item) => (
                    <button
                      key={item.id}
                      className={view === item.id ? "active" : ""}
                      onClick={() => navigateToView(item.id)}
                      aria-current={view === item.id ? "page" : undefined}
                    >
                      {item.label}
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
                  onView={setView}
                  onQuery={runSavedQuery}
                  onOpenReview={(key) => {
                    setReviewInitialKey(key ?? null);
                    setView("review");
                  }}
                />
              )}
              {view === "review" && (
                <InterviewReview
                  notes={notes}
                  onVaultChanged={loadVault}
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
                />
              )}
              {view === "jobs" && (
                <JobsView
                  notes={notes}
                  onOpen={openNote}
                  onVaultChanged={loadVault}
                  initialStatuses={jobsInitialStatuses}
                />
              )}
              {view === "analytics" && (
                <JobsAnalytics
                  notes={notes}
                  onOpen={openNote}
                  onViewJobs={(statuses) => {
                    setJobsInitialStatuses(statuses ?? null);
                    setView("jobs");
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
                <CalendarView events={derived.calendarEvents} onOpen={openNote} />
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
                  query={query}
                  onFilter={setGroupFilter}
                  onQuery={setQuery}
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

function SearchPanel({
  query,
  notes,
  onOpen,
  onQuery,
  onClose,
}: {
  query: string;
  notes: Note[];
  onOpen: (note: Note) => void;
  onQuery: (query: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="search-panel">
      <div className="search-panel-head">
        <span>{query ? `“${query}” 的结果` : "快捷查询"}</span>
        <button onClick={onClose} aria-label="关闭搜索">×</button>
      </div>
      {!query && (
        <div className="saved-queries">
          <button onClick={() => onQuery("status:選考中")}>进行中的选考</button>
          <button onClick={() => onQuery("重要度:高")}>高优先日语错误</button>
          <button onClick={() => onQuery("type:ai-report")}>AI 分析</button>
          <button onClick={() => onQuery("待ち")}>等待结果</button>
        </div>
      )}
      <div className="search-results">
        {notes.map((note) => (
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
        {query && notes.length === 0 && (
          <div className="empty-search">没有匹配的记忆，试试更短的关键词。</div>
        )}
      </div>
      <div className="search-help">支持 <code>type:</code>、<code>status:</code>、<code>folder:</code> 组合查询</div>
    </div>
  );
}

type DerivedData = {
  links: number;
  orphanCount: number;
  cases: Note[];
  reviews: Note[];
  timeline: { note: Note; date: string }[];
  calendarEvents: CalendarEvent[];
  totalErrors: number;
  highPriorityErrors: number;
  promoted: number;
  incompleteSelf: number;
  selfNotes: number;
  analysisCount: number;
  evidenceCount: number;
  evidenceCompleteness: number;
};

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
  return <div className="stat"><strong>{value.toString().padStart(2, "0")}</strong><span>{label}</span></div>;
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
  notes: Note[],
  filter: GroupKey | "all",
): {
  nodes: KnowledgeGraphSceneNode[];
  links: KnowledgeGraphSceneLink[];
} {
  const visibleNotes = notes.filter(
    (note) => filter === "all" || getGroup(note.path) === filter,
  );
  const visiblePaths = new Set(visibleNotes.map((note) => note.path));
  const titleIndex = new Map<string, Note>();
  notes.forEach((note) => {
    const basename = noteBasename(note.path);
    titleIndex.set(basename, note);
    titleIndex.set(note.path.replace(/\.md$/i, ""), note);
  });

  const links: KnowledgeGraphSceneLink[] = [];
  const linkKeys = new Set<string>();
  const degree = new Map<string, number>();
  visibleNotes.forEach((source) => {
    extractLinks(source.content).forEach((rawTarget) => {
      const target = titleIndex.get(rawTarget) ?? titleIndex.get(noteBasename(rawTarget));
      if (!target || target.path === source.path || !visiblePaths.has(target.path)) return;
      // 双链的往返引用在视觉上是一条边。去重后，节点大小也不会被同一事实重复放大。
      const key = [source.path, target.path].sort().join("\u0000");
      if (linkKeys.has(key)) return;
      linkKeys.add(key);
      links.push({ source: source.path, target: target.path });
      degree.set(source.path, (degree.get(source.path) ?? 0) + 1);
      degree.set(target.path, (degree.get(target.path) ?? 0) + 1);
    });
  });

  return {
    nodes: visibleNotes.map((note) => {
      const group = getGroup(note.path);
      const excerpt = stripMarkdown(stripFrontmatter(note.content))
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return {
        id: note.path,
        title: getTitle(note),
        group,
        groupLabel: GROUPS[group].label,
        color: GROUPS[group].color,
        degree: degree.get(note.path) ?? 0,
        path: note.path.replace(/\.md$/i, ""),
        kindLabel: typeLabel(getType(note)),
        updatedLabel: formatDate(note.stat.mtime, true),
        outbound: extractLinks(note.content).length,
        excerpt,
      };
    }),
    links,
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
  const scene = useMemo(
    () => buildKnowledgeGraphScene(notes, filter),
    [notes, filter],
  );
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
        <GroupFilters value={filter} onChange={onFilter} />
        <div className="graph-renderer-toggle" aria-label="关系图显示方式">
          <button
            type="button"
            className={renderer === "space" ? "active" : ""}
            aria-pressed={renderer === "space"}
            onClick={() => setRenderer("space")}
          >
            3D 星图
          </button>
          <button
            type="button"
            className={renderer === "map" ? "active" : ""}
            aria-pressed={renderer === "map"}
            onClick={() => setRenderer("map")}
          >
            简洁模式
          </button>
        </div>
      </div>
      <div className="graph-layout" data-renderer={renderer}>
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
          <CanvasKnowledgeGraph notes={notes} filter={filter} onOpen={onOpen} />
        )}
        <aside className="graph-legend">
          <span>{renderer === "space" ? "星系图例" : "图例"}</span>
          {(Object.keys(GROUPS) as GroupKey[]).map((group) => (
            <button key={group} onClick={() => onFilter(group)}>
              <i style={{ background: GROUPS[group].color }} />
              <span>{GROUPS[group].label}</span>
              <strong>{notes.filter((note) => getGroup(note.path) === group).length}</strong>
            </button>
          ))}
          <div className="legend-rule"><span>小</span><i /><i /><i /><span>被引用多</span></div>
        </aside>
      </div>
    </section>
  );
}

function GroupFilters({ value, onChange }: { value: GroupKey | "all"; onChange: (value: GroupKey | "all") => void }) {
  return (
    <div className="group-filters" aria-label="按分区筛选">
      <button className={value === "all" ? "active" : ""} onClick={() => onChange("all")}>全部</button>
      {(Object.keys(GROUPS) as GroupKey[]).map((group) => (
        <button key={group} className={value === group ? "active" : ""} onClick={() => onChange(group)}>
          <i style={{ background: GROUPS[group].color }} />{GROUPS[group].label}
        </button>
      ))}
    </div>
  );
}

type GraphPoint = {
  note: Note;
  x: number;
  y: number;
  radius: number;
  group: GroupKey;
  degree: number;
};

function seeded(path: string) {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function CanvasKnowledgeGraph({ notes, filter, onOpen }: { notes: Note[]; filter: GroupKey | "all"; onOpen: (note: Note) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<GraphPoint[]>([]);
  const [hovered, setHovered] = useState<GraphPoint | null>(null);
  const [size, setSize] = useState({ width: 900, height: 620 });

  const visibleNotes = useMemo(
    () => notes.filter((note) => filter === "all" || getGroup(note.path) === filter),
    [notes, filter],
  );

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
    if (!canvas || visibleNotes.length === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * ratio);
    canvas.height = Math.round(size.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const centers: Record<GroupKey, [number, number]> = {
      self: [0.26, 0.28], career: [0.7, 0.3], study: [0.28, 0.72], analysis: [0.7, 0.72], system: [0.5, 0.5],
    };
    const titleIndex = new Map<string, Note>();
    notes.forEach((note) => titleIndex.set(noteBasename(note.path), note));
    const incoming = new Map<string, number>();
    notes.forEach((note) => extractLinks(note.content).forEach((link) => incoming.set(link, (incoming.get(link) ?? 0) + 1)));

    const points: GraphPoint[] = visibleNotes.map((note, index) => {
      const group = getGroup(note.path);
      const [centerX, centerY] = centers[group];
      const angle = seeded(note.path) * Math.PI * 2;
      const ring = 38 + (index % 5) * 21 + seeded(`${note.path}-r`) * 18;
      const degree = (incoming.get(noteBasename(note.path)) ?? 0) + extractLinks(note.content).length;
      return {
        note,
        group,
        x: centerX * size.width + Math.cos(angle) * ring,
        y: centerY * size.height + Math.sin(angle) * ring * 0.72,
        radius: 4.5 + Math.min(8, degree * 1.25),
        degree,
      };
    });
    pointsRef.current = points;
    const pointByPath = new Map(points.map((point) => [point.note.path, point]));
    const labelLimit = filter === "all" ? 3 : 12;
    const labelPaths = new Set(
      (filter === "all" ? (Object.keys(GROUPS) as GroupKey[]) : [filter])
        .flatMap((group) =>
          points
            .filter((point) => point.group === group)
            .toSorted((left, right) => right.degree - left.degree)
            .slice(0, labelLimit)
            .map((point) => point.note.path),
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
    points.forEach((source) => {
      extractLinks(source.note.content).forEach((link) => {
        const targetNote = titleIndex.get(link);
        const target = targetNote ? pointByPath.get(targetNote.path) : undefined;
        if (!target) return;
        context.beginPath();
        context.moveTo(source.x, source.y);
        context.lineTo(target.x, target.y);
        context.strokeStyle = "rgba(208, 223, 213, .17)";
        context.stroke();
      });
    });

    points.forEach((point) => {
      const active = hovered?.note.path === point.note.path;
      if (active) {
        context.beginPath(); context.arc(point.x, point.y, point.radius + 8, 0, Math.PI * 2);
        context.fillStyle = "rgba(255,255,255,.12)"; context.fill();
      }
      context.beginPath(); context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.fillStyle = GROUPS[point.group].color; context.fill();
      context.strokeStyle = active ? "#fff" : "rgba(255,255,255,.45)";
      context.lineWidth = active ? 2 : 1; context.stroke();
      if (labelPaths.has(point.note.path) || active) {
        context.font = `${active ? 600 : 500} ${active ? 13 : 11}px system-ui, sans-serif`;
        context.fillStyle = active ? "#ffffff" : "rgba(244,245,238,.78)";
        context.textAlign = "center";
        context.fillText(getTitle(point.note).slice(0, 18), point.x, point.y + point.radius + 17);
      }
    });
  }, [visibleNotes, notes, size, hovered, filter]);

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
        aria-label={`Obsidian 记忆关系图，共 ${visibleNotes.length} 个节点`}
        onPointerMove={(event) => setHovered(findPoint(event))}
        onPointerLeave={() => setHovered(null)}
        onClick={(event) => {
          const point = findPoint(event);
          if (point) onOpen(point.note);
        }}
      />
      <div className="graph-caption"><span>移动鼠标探索节点</span><strong>{visibleNotes.length} 个节点</strong></div>
      {hovered && (
        <div className="graph-tooltip">
          <span style={{ color: GROUPS[hovered.group].color }}>{GROUPS[hovered.group].label}</span>
          <strong>{getTitle(hovered.note)}</strong>
          <small>{hovered.degree} 条关系 · 点击查看</small>
        </div>
      )}
    </div>
  );
}

function CalendarView({ events, onOpen }: { events: CalendarEvent[]; onOpen: (note: Note) => void }) {
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
  const upcomingAll = events.filter((event) => event.phase === "upcoming");
  const upcoming = upcomingAll.slice(0, 6);
  const recent = events
    .filter((event) => event.phase === "past")
    .sort((left, right) => right.date.localeCompare(left.date) || right.time.localeCompare(left.time))
    .slice(0, 6);

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
          <AgendaGroup title="接下来的安排" empty="目前没有已记录的未来面谈。" events={upcoming} onOpen={onOpen} />
          <AgendaGroup title="最近的面试记录" empty="还没有可识别的历史面试记录。" events={recent} onOpen={onOpen} />
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
}: {
  title: string;
  empty: string;
  events: CalendarEvent[];
  onOpen: (note: Note) => void;
}) {
  return (
    <section className="agenda-group">
      <div className="agenda-heading"><h2>{title}</h2><span>{events.length}</span></div>
      <div className="agenda-list">
        {events.map((event) => (
          <button key={event.id} onClick={() => onOpen(event.note)}>
            <time dateTime={event.date}>
              <strong>{event.date.slice(8)}</strong>
              <span>{formatDate(event.date)}</span>
            </time>
            <span className="agenda-copy">
              <small>{event.time ? `${event.time} · ${event.label}` : event.label}</small>
              <strong>{event.company}</strong>
            </span>
            <span className={`agenda-dot ${event.phase}`} />
          </button>
        ))}
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


const TODO_STATUS = ["未着手", "進行中", "保留", "完了"];
const TODO_PRIORITY: Record<string, { label: string; rank: number }> = {
  high: { label: "高", rank: 0 },
  medium: { label: "中", rank: 1 },
  low: { label: "低", rank: 2 },
};

function todoPriority(note: Note) {
  return getString(note.frontmatter.priority).toLowerCase() || "medium";
}
function todoStatus(note: Note) {
  return getString(note.frontmatter.status) || "未着手";
}
function todoAudience(note: Note) {
  return getString(note.frontmatter.audience) === "system" ? "system" : "user";
}
function todoAction(note: Note) {
  return getString(note.frontmatter.action) || getTitle(note);
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
          const why = jobSection(note, "なぜ必要か") || jobSection(note, "課題");
          const what = jobSection(note, "やること");
          return (
            <article className={`todo-card pri-${pri} ${st === "完了" ? "is-done" : ""}`} key={note.path}>
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
        return extractLinks(right.content).length - extractLinks(left.content).length ||
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
            <p>顶部搜索框支持 <code>type:</code>、<code>status:</code> 和 <code>folder:</code>。</p>
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
              const links = extractLinks(note.content).length;
              return (
                <button
                  className="note-card"
                  key={note.path}
                  onClick={() => onOpen(note)}
                  style={{ "--note-accent": GROUPS[group].color } as CSSProperties}
                >
                  <div className="note-card-top">
                    <span className="note-group"><i />{GROUPS[group].label}</span>
                    <span className={`trust-badge ${trust.className}`}>{trust.label}</span>
                  </div>
                  <h2>{getTitle(note)}</h2>
                  <p>{notePreview(note).slice(0, 190)}</p>
                  <div className="note-card-source">{noteFolder(note.path)}</div>
                  <div className="note-card-foot">
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
  const backlinks = allNotes.filter((candidate) => extractLinks(candidate.content).includes(basename));

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

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="note-drawer" aria-label="记忆详情" aria-modal="true" role="dialog">
        <header className="drawer-header">
          <div><span style={{ color: GROUPS[group].color }}>{GROUPS[group].label}</span><small>{note.path}</small></div>
          <button onClick={onClose} aria-label="关闭详情">×</button>
        </header>
        <div className="drawer-scroll" ref={scrollRef}>
          <div className="drawer-title-row">
            <span className={`trust-badge ${trust.className}`}>{trust.label}</span>
            <span>{typeLabel(getType(note))}</span>
          </div>
          <h1>{getTitle(note)}</h1>
          <div className="drawer-meta">
            <span>更新于 {formatDate(note.stat.mtime, true)}</span>
            <span>{Math.round(note.stat.size / 1024 * 10) / 10} KB</span>
            <span>{extractLinks(note.content).length} 条外链</span>
            <span>{backlinks.length} 条反链</span>
          </div>
          {Object.keys(note.frontmatter).length > 0 && (
            <div className="frontmatter-grid">
              {Object.entries(note.frontmatter).map(([key, value]) => (
                <div key={key}><span>{key}</span><strong>{Array.isArray(value) ? value.join(" · ") : getString(value) || "—"}</strong></div>
              ))}
            </div>
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
      </aside>
    </div>
  );
}

function normalizeHeading(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\*\*/g, "")
    .replace(/\[\[([^#|\]]+)(?:#[^|\]]+)?(?:\|([^\]]+))?\]\]/g, "$2$1")
    .replace(/\s+/g, " ")
    .trim();
}

function renderInline(text: string, onWikiLink: (target: string, section?: string) => void): ReactNode[] {
  const pieces = text.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return pieces.map((piece, index) => {
    if (piece.startsWith("[[") && piece.endsWith("]]")) {
      const body = piece.slice(2, -2);
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
  lines.forEach((line, index) => {
    if (line.startsWith("```")) {
      if (inCode) {
        blocks.push(<pre key={`code-${index}`}><code>{codeLines.join("\n")}</code></pre>);
        codeLines = [];
      }
      inCode = !inCode;
      return;
    }
    if (inCode) { codeLines.push(line); return; }
    if (!line.trim()) return;
    const heading = line.match(/^(#{2,4})\s+(.+)/);
    if (heading) {
      const level = heading[1].length;
      const data = { "data-md-heading": normalizeHeading(heading[2]) };
      if (level === 2) blocks.push(<h2 key={index} {...data}>{renderInline(heading[2], onWikiLink)}</h2>);
      else if (level === 3) blocks.push(<h3 key={index} {...data}>{renderInline(heading[2], onWikiLink)}</h3>);
      else blocks.push(<h4 key={index} {...data}>{renderInline(heading[2], onWikiLink)}</h4>);
      return;
    }
    if (line.startsWith(">")) {
      blocks.push(<blockquote key={index}>{renderInline(line.replace(/^>\s?/, ""), onWikiLink)}</blockquote>);
      return;
    }
    const listItem = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/);
    if (listItem) {
      blocks.push(<div className="md-list-item" key={index}><i /> <span>{renderInline(listItem[1], onWikiLink)}</span></div>);
      return;
    }
    if (line.startsWith("|")) {
      if (/^\|?\s*:?-+/.test(line)) return;
      blocks.push(<div className="md-table-row" key={index}>{line.split("|").filter(Boolean).map((cell, cellIndex) => <span key={cellIndex}>{renderInline(cell.trim(), onWikiLink)}</span>)}</div>);
      return;
    }
    blocks.push(<p key={index}>{renderInline(line, onWikiLink)}</p>);
  });
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
