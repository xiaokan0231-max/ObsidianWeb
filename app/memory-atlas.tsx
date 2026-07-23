"use client";

import {
  Fragment,
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
import JapaneseTraining from "./japanese-training";
import JobsAnalytics from "./jobs-analytics";
import JobsView from "./jobs-view";
import { compareJobs, jobSection, normalizeJobStatus, toJobCard } from "@/lib/jobs";
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

export type { Note };

type VaultResponse = {
  connected: boolean;
  fetchedAt?: number;
  error?: string;
  notes: Note[];
};

type View = "overview" | "review" | "language" | "jobs" | "analytics" | "todo" | "graph" | "calendar" | "timeline" | "library";

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

// 顺序 = 求职推进的顺序：找岗位 → 排进度 → 备面试。关系图和记忆库是回查用的底层，放最后。
const NAVIGATION: { id: View; label: string; glyph: string }[] = [
  { id: "overview", label: "总览", glyph: "⌂" },
  { id: "jobs", label: "AI 推荐岗位", glyph: "★" },
  { id: "analytics", label: "求职分析", glyph: "◑" },
  { id: "todo", label: "待办事项", glyph: "✓" },
  { id: "calendar", label: "日历", glyph: "▦" },
  { id: "review", label: "面试复盘", glyph: "復" },
  { id: "language", label: "日语训练", glyph: "語" },
  { id: "timeline", label: "时间线", glyph: "◷" },
  { id: "graph", label: "关系图", glyph: "✣" },
  { id: "library", label: "记忆库", glyph: "▤" },
];

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
    study: "学习资料",
    "ai-report": "AI 观点",
    "interview-answer-review": "回答质量复盘",
    "interview-answer-practice": "回答重练队列",
    "interview-answer-feedback": "回答质量批注",
    policy: "规则",
    material: "素材",
    "training-profile": "训练画像",
    "training-lesson": "训练教材",
    "training-log": "训练记录",
    "practice-log": "教练练习",
    "exam-log": "考试记录",
    [JOB_CASE_TYPE]: "应募案件",
    todo: "待办",
    moc: "索引",
    note: "笔记",
  };
  return labels[type] ?? type;
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

function nextActionDate(note: Note) {
  return getString(note.frontmatter.next_action).match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? "9999-12-31";
}

function comparePriorityCases(left: Note, right: Note) {
  const leftAction = getString(left.frontmatter.next_action);
  const rightAction = getString(right.frontmatter.next_action);
  const star = Number(rightAction.startsWith("⭐")) - Number(leftAction.startsWith("⭐"));
  if (star) return star;
  const byActionDate = nextActionDate(left).localeCompare(nextActionDate(right));
  if (byActionDate) return byActionDate;
  const stageRank: Record<string, number> = { 面接中: 0, 書類通過: 1, 応募済: 2 };
  const leftStatus = normalizeJobStatus(getString(left.frontmatter.status)) ?? "";
  const rightStatus = normalizeJobStatus(getString(right.frontmatter.status)) ?? "";
  const byStage = (stageRank[leftStatus] ?? 9) - (stageRank[rightStatus] ?? 9);
  if (byStage) return byStage;
  return getString(right.frontmatter.status_updated).localeCompare(getString(left.frontmatter.status_updated));
}

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

    // 将来日程は状態正本である job-case の next_action だけから作る。
    // company 本文を再走査すると、同じ面接が証拠記述と案件で二重表示される。
    if (type !== JOB_CASE_TYPE) return;
    const sources = [
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
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState<GroupKey | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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
        setSearchOpen(false);
        setSelectedPath(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const notesByBasename = useMemo(() => {
    const index = new Map<string, Note>();
    notes.forEach((note) => index.set(noteBasename(note.path), note));
    return index;
  }, [notes]);

  const selectedNote = selectedPath
    ? notes.find((note) => note.path === selectedPath) ?? null
    : null;

  const openNote = useCallback((note: Note) => {
    setSelectedPath(note.path);
    setSearchOpen(false);
  }, []);

  const openWikiLink = useCallback(
    (target: string) => {
      const note = notesByBasename.get(target) ?? notes.find((item) => item.path.endsWith(`/${target}.md`));
      if (note) openNote(note);
    },
    [notes, notesByBasename, openNote],
  );

  const filteredNotes = useMemo(() => {
    return notes.filter((note) => {
      const groupMatch = groupFilter === "all" || getGroup(note.path) === groupFilter;
      return groupMatch && noteMatches(note, query);
    });
  }, [notes, query, groupFilter]);

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
    const actionableCases = cases.filter((note) => getString(note.frontmatter.next_action));
    const priority =
      actionableCases
        .filter((note) => ACTIVE_JOB_STATUSES.has(normalizeJobStatus(getString(note.frontmatter.status)) ?? ""))
        .sort(comparePriorityCases)[0] ??
      actionableCases.sort(comparePriorityCases)[0] ??
      null;
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
      priority,
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
              className={view === item.id ? "active" : ""}
              onClick={() => {
                if (item.id === "review") setReviewInitialKey(null);
                setView(item.id);
              }}
              aria-current={view === item.id ? "page" : undefined}
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
            {view === "language" && (
              <JapaneseTraining onVaultChanged={loadVault} />
            )}
            {view === "jobs" && (
              <JobsView notes={notes} onOpen={openNote} onVaultChanged={loadVault} />
            )}
            {view === "analytics" && <JobsAnalytics notes={notes} />}
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
              <TimelineView items={derived.timeline} onOpen={openNote} />
            )}
            {view === "library" && (
              <LibraryView
                notes={filteredNotes}
                total={notes.length}
                filter={groupFilter}
                query={query}
                onFilter={setGroupFilter}
                onQuery={setQuery}
                onOpen={openNote}
              />
            )}
          </div>
        )}
      </main>

      <nav className="mobile-nav" aria-label="移动端主导航">
        {NAVIGATION.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => {
              if (item.id === "review") setReviewInitialKey(null);
              setView(item.id);
            }}
          >
            <span aria-hidden="true">{item.glyph}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {selectedNote && (
        <NoteDrawer
          note={selectedNote}
          allNotes={notes}
          onClose={() => setSelectedPath(null)}
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
  priority: Note | null;
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
  const priorityAction = derived.priority
    ? getString(derived.priority.frontmatter.next_action).replace(/^⭐\s*/, "")
    : "暂无明确的下一步行动";

  const openJobs = jobs
    .filter((job) => job.status === "未応募")
    .sort((left, right) => compareJobs(left, right, "rating"));
  const topSalary = openJobs
    .map((job) => job.salary.max ?? 0)
    .filter((value) => value > 0)
    .sort((left, right) => right - left)[0];
  const openTodos = notes
    .filter((note) => getType(note) === "todo" && todoStatus(note) !== "完了")
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
      <section className="memory-hero">
        <div className="eyebrow"><span /> TODAY&apos;S BRIEF</div>
        <div className="hero-grid">
          <div className="hero-message">
            <h1>今天先推进<br />最重要的一步。</h1>
            <p>
              选考、面试与复盘都已汇总在这里；先处理有时限、会影响下一轮结果的行动。
            </p>
            <button
              className="primary-action"
              onClick={() => derived.priority && onOpen(derived.priority)}
              disabled={!derived.priority}
            >
              打开当前重点 <span>→</span>
            </button>
          </div>
          <div className="hero-focus">
            <div className="focus-number">01</div>
            <span className="focus-label">现在最重要</span>
            <h2>{priorityAction}</h2>
            <div className="focus-meta">
              <span>{currentCases.length} 个应募案件进行中</span>
              <span>{derived.reviews.filter((note) => getString(note.frontmatter.result) === "待ち").length} 个结果待回填</span>
            </div>
          </div>
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
            title="待办事项"
            action="全部待办"
            onAction={() => onView("todo")}
          />
          <div className="todo-preview-list">
            {openTodos.length === 0 ? (
              <p className="panel-empty">待办都清空了。</p>
            ) : (
              openTodos.slice(0, 5).map((note) => (
                <button key={note.path} onClick={() => onOpen(note)}>
                  <span className={`todo-pri pri-${todoPriority(note)}`}>
                    {TODO_PRIORITY[todoPriority(note)]?.label ?? todoPriority(note)}
                  </span>
                  <span className="todo-preview-body">
                    <strong>{getTitle(note)}</strong>
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
  return (
    <section className="graph-view">
      <div className="section-intro">
        <div><span className="eyebrow"><i /> KNOWLEDGE GRAPH</span><h1>记忆关系图</h1><p>节点大小代表被引用程度。点击任意节点，查看它的事实层级、原文和反向链接。</p></div>
        <GroupFilters value={filter} onChange={onFilter} />
      </div>
      <div className="graph-layout">
        <KnowledgeGraph notes={notes} filter={filter} onOpen={onOpen} />
        <aside className="graph-legend">
          <span>图例</span>
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

function KnowledgeGraph({ notes, filter, onOpen }: { notes: Note[]; filter: GroupKey | "all"; onOpen: (note: Note) => void }) {
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
      if (point.degree >= 2 || active) {
        context.font = `${active ? 600 : 500} ${active ? 13 : 11}px system-ui, sans-serif`;
        context.fillStyle = active ? "#ffffff" : "rgba(244,245,238,.78)";
        context.textAlign = "center";
        context.fillText(getTitle(point.note).slice(0, 18), point.x, point.y + point.radius + 17);
      }
    });
  }, [visibleNotes, notes, size, hovered]);

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
      <div className="section-intro calendar-intro">
        <div>
          <span className="eyebrow"><i /> INTERVIEW CALENDAR</span>
          <h1>求职日历</h1>
          <p>把未来面谈和历史面试放回同一条时间坐标，日程直接来自 Obsidian 中的明确日期记录。</p>
        </div>
        <div className="calendar-summary" aria-label="日程统计">
          <span><strong>{upcomingAll.length}</strong> 个未来安排</span>
          <span><strong>{events.filter((event) => event.phase === "past").length}</strong> 条历史记录</span>
        </div>
      </div>

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

function TimelineView({ items, onOpen }: { items: { note: Note; date: string }[]; onOpen: (note: Note) => void }) {
  const groups = useMemo(() => {
    const map = new Map<string, { note: Note; date: string }[]>();
    items.forEach((item) => map.set(item.date, [...(map.get(item.date) ?? []), item]));
    return Array.from(map.entries());
  }, [items]);
  return (
    <section className="timeline-view">
      <div className="section-intro"><div><span className="eyebrow"><i /> EVIDENCE TIMELINE</span><h1>记忆时间线</h1><p>按发生日期排列面试、复盘与 AI 分析。修改时间不会覆盖事件本身的时间。</p></div></div>
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
    </section>
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

function TodoView({ notes, onOpen }: { notes: Note[]; onOpen: (note: Note) => void }) {
  const [tab, setTab] = useState<string>("all");
  const todos = notes
    .filter((note) => getType(note) === "todo")
    .sort((a, b) => {
      const pa = TODO_PRIORITY[todoPriority(a)]?.rank ?? 9;
      const pb = TODO_PRIORITY[todoPriority(b)]?.rank ?? 9;
      if (pa !== pb) return pa - pb;
      return TODO_STATUS.indexOf(todoStatus(a)) - TODO_STATUS.indexOf(todoStatus(b));
    });

  const open = todos.filter((n) => todoStatus(n) !== "完了");
  const visible = tab === "all" ? todos : todos.filter((n) => todoStatus(n) === tab);
  const statuses = TODO_STATUS.filter((st) => todos.some((n) => todoStatus(n) === st));

  return (
    <section className="todo-view">
      <div className="section-intro">
        <div>
          <span className="eyebrow"><i /> NEXT ACTIONS</span>
          <h1>待办事项</h1>
          <p>求职推进中需要处理的事项。数据来自 Vault 的 <code>20_求職/_TODO/</code>，在 Obsidian 里改 frontmatter 的 status 即可更新状态。</p>
        </div>
        <div className="jobs-stat">
          <div><strong>{open.length}</strong><span>未完了</span></div>
          <div><strong>{todos.filter((n) => todoPriority(n) === "high" && todoStatus(n) !== "完了").length}</strong><span>高优先</span></div>
        </div>
      </div>

      <div className="jobs-controls">
        <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>全部 <small>{todos.length}</small></button>
        {statuses.map((st) => (
          <button key={st} className={tab === st ? "active" : ""} onClick={() => setTab(st)}>
            {st} <small>{todos.filter((n) => todoStatus(n) === st).length}</small>
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
                  <h2>{getTitle(note)}</h2>
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

      {todos.length === 0 && (
        <div className="jobs-empty">
          <p>待办事项还没有。</p>
          <small>在 Vault 的 <code>20_求職/_TODO/</code> 下新建 <code>type: todo</code> 的笔记即可显示。</small>
        </div>
      )}
      {todos.length > 0 && visible.length === 0 && <div className="jobs-empty"><p>该状态下没有事项。</p></div>}
    </section>
  );
}

function LibraryView({
  notes,
  total,
  filter,
  query,
  onFilter,
  onQuery,
  onOpen,
}: {
  notes: Note[];
  total: number;
  filter: GroupKey | "all";
  query: string;
  onFilter: (filter: GroupKey | "all") => void;
  onQuery: (query: string) => void;
  onOpen: (note: Note) => void;
}) {
  return (
    <section className="library-view">
      <div className="section-intro library-intro">
        <div><span className="eyebrow"><i /> MEMORY LIBRARY</span><h1>全部记忆</h1><p>用关键词或字段组合查询原始内容。结果直接来自本机 Obsidian，不建立第二份数据库。</p></div>
        <div className="library-count"><strong>{notes.length}</strong><span>/ {total} 篇</span></div>
      </div>
      <div className="library-controls">
        <GroupFilters value={filter} onChange={onFilter} />
        {(query || filter !== "all") && <button className="clear-filter" onClick={() => { onQuery(""); onFilter("all"); }}>清除筛选 ×</button>}
      </div>
      <div className="note-grid">
        {notes.map((note) => {
          const group = getGroup(note.path);
          const trust = trustLayer(note);
          return (
            <button className="note-card" key={note.path} onClick={() => onOpen(note)}>
              <div className="note-card-top">
                <span className="note-group" style={{ color: GROUPS[group].color }}>{GROUPS[group].label}</span>
                <span className={`trust-badge ${trust.className}`}>{trust.label}</span>
              </div>
              <h2>{getTitle(note)}</h2>
              <p>{stripMarkdown(note.content).slice(0, 165)}</p>
              <div className="note-card-foot">
                <span>{typeLabel(getType(note))}</span>
                <span>{extractLinks(note.content).length} 条关联</span>
                <span>{formatDate(note.stat.mtime)}</span>
              </div>
            </button>
          );
        })}
      </div>
      {notes.length === 0 && <div className="library-empty">没有符合当前条件的记忆。</div>}
    </section>
  );
}

function NoteDrawer({
  note,
  allNotes,
  onClose,
  onOpenWiki,
  onOpen,
}: {
  note: Note;
  allNotes: Note[];
  onClose: () => void;
  onOpenWiki: (target: string) => void;
  onOpen: (note: Note) => void;
}) {
  const group = getGroup(note.path);
  const trust = trustLayer(note);
  const basename = noteBasename(note.path);
  const backlinks = allNotes.filter((candidate) => extractLinks(candidate.content).includes(basename));
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="note-drawer" aria-label="记忆详情" aria-modal="true" role="dialog">
        <header className="drawer-header">
          <div><span style={{ color: GROUPS[group].color }}>{GROUPS[group].label}</span><small>{note.path}</small></div>
          <button onClick={onClose} aria-label="关闭详情">×</button>
        </header>
        <div className="drawer-scroll">
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

function renderInline(text: string, onWikiLink: (target: string) => void): ReactNode[] {
  const pieces = text.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return pieces.map((piece, index) => {
    if (piece.startsWith("[[") && piece.endsWith("]]")) {
      const body = piece.slice(2, -2);
      const [targetWithHeading, alias] = body.split("|");
      const target = targetWithHeading.split("#")[0];
      return <button className="wiki-link" key={index} onClick={() => onWikiLink(target)}>{alias || target} ↗</button>;
    }
    if (piece.startsWith("**") && piece.endsWith("**")) return <strong key={index}>{piece.slice(2, -2)}</strong>;
    if (piece.startsWith("`") && piece.endsWith("`")) return <code key={index}>{piece.slice(1, -1)}</code>;
    return piece;
  });
}

function MarkdownDocument({ content, onWikiLink }: { content: string; onWikiLink: (target: string) => void }) {
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
      if (level === 2) blocks.push(<h2 key={index}>{renderInline(heading[2], onWikiLink)}</h2>);
      else if (level === 3) blocks.push(<h3 key={index}>{renderInline(heading[2], onWikiLink)}</h3>);
      else blocks.push(<h4 key={index}>{renderInline(heading[2], onWikiLink)}</h4>);
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
