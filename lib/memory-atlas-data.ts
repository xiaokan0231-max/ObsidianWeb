// 記憶星図の「ノート配列 → 画面が読む数字と一覧」層。React にも three にも依存しない。
// 这里集中日历、资料库等视图的派生数据，独立于组件，便于校验投影规则。

import { graphGroup, type GraphGroup } from "./knowledge-graph.ts";
import { WAITING_FOR_LABEL, normalizeJobStatus, statusTone } from "./jobs.ts";
import { TODO_PRIORITY_META, TODO_STATUSES } from "./todo-status.mjs";
import {
  companyIdentity,
  getString,
  getTitle,
  getType,
  noteBasename,
  stripMarkdown,
  stripNonLinkRegions,
  type Note,
} from "./notes.ts";
import { JOB_CASE_TYPE } from "./vault-boundary.mjs";
import type { SnippetPart } from "./search-snippet.ts";
import type { UiLocale } from "./ui-locale.ts";
import { interviewContext, interviewNoteTime, matchingInterviewPrep, matchingInterviewContext, resolveCalendarRoundBadge } from "./calendar-interview.ts";
import { calendarRoundBadge, interviewRound } from "./interview-round.ts";

export type GroupKey = GraphGroup;
export type LibraryScope = "all" | "evidence" | "action" | "interview" | "language" | "analysis";

export type CalendarEvent = {
  id: string;
  note: Note;
  kind: "event";
  date: string;
  time: string;
  endTime?: string;
  company: string;
  label: string;
  phase: "upcoming" | "past";
  caseId: string;
  prepPath: string;
};

export type Commitment = CalendarEvent | {
  id: string;
  note: Note;
  kind: "action" | "follow-up";
  date: string;
  time: string;
  company: string;
  label: string;
  phase: "upcoming" | "past";
  caseId: string;
  prepPath: string;
  waitingFor?: string;
};

export type DerivedData = {
  links: number;
  orphanCount: number;
  cases: Note[];
  reviews: Note[];
  timeline: { note: Note; date: string }[];
  calendarEvents: CalendarEvent[];
  commitments: Commitment[];
  totalErrors: number;
  highPriorityErrors: number;
  promoted: number;
  incompleteSelf: number;
  selfNotes: number;
  analysisCount: number;
  evidenceCount: number;
  evidenceCompleteness: number;
};

// GraphGroup をキーに固定してあるので、分区が増えた時に色を書き忘れると型で落ちる。
// color 给 3D 舞台、关系图 canvas 和它们的图例用：舞台不随皮肤换色，图例必须和节点同色。
// cssVar 给页面里的分区标签用，皮肤会换掉 --group-*；回落值写成同一个 hex，
// 这样 token 缺席时标签仍是现在的颜色。
export const GROUPS: Record<GroupKey, {
  label: string;
  short: string;
  color: string;
  cssVar: string;
  tint: string;
}> = {
  self: { label: "关于我", short: "我", color: "#e66d45", cssVar: "var(--group-self, #e66d45)", tint: "#f9ddd0" },
  career: { label: "求职", short: "职", color: "#2f6b59", cssVar: "var(--group-career, #2f6b59)", tint: "#d8e9df" },
  study: { label: "日语学习", short: "学", color: "#7466a9", cssVar: "var(--group-study, #7466a9)", tint: "#e3def2" },
  analysis: { label: "AI 分析", short: "析", color: "#b5842f", cssVar: "var(--group-analysis, #b5842f)", tint: "#f3e6c8" },
  system: { label: "系统", short: "规", color: "#66706c", cssVar: "var(--group-system, #66706c)", tint: "#e5e7e4" },
};

// TODO の状態・優先度契約は lib/todo-status.mjs が正本（vault-check と同じ配列）。
export const TODO_STATUS: readonly string[] = TODO_STATUSES;
export const TODO_PRIORITY: Record<string, { label: string; rank: number }> = TODO_PRIORITY_META;

export const getGroup = graphGroup;

export function typeLabel(type: string) {
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
    "language-quick-log": "快练记录",
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

export function trustLayer(note: Note) {
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

/*
 * 阅读层等界面按界面语言显示的标签。typeLabel / trustLayer 保持原样只出中文：
 * 搜索、资料库与统计都按那份中文口径比对，改它们的返回值会波及无关视图。
 * 这里中文分支直接回落到原函数，逐字不变；日文只补译，未收录的类型仍按原函数的写法显示。
 */
const TYPE_LABELS_JA: Record<string, string> = {
  self: "本人確認済み",
  company: "企業ファイル",
  review: "振り返りの証拠",
  transcript: "文字起こし",
  "transcript-study": "文字起こしの学習",
  "study-annotation": "文字起こしの注釈",
  study: "学習資料",
  "ai-report": "AI の見解",
  "ai_review_request": "AI レビュー依頼",
  "ai_review_result": "AI レビュー結果",
  analysis: "総合分析",
  "deep-thought-evidence": "深掘りの証拠",
  "deep-thought-opinion": "独立した分析",
  "interview-answer-review": "回答の振り返り",
  "interview-answer-practice": "回答の練習キュー",
  "interview-answer-feedback": "回答への注釈",
  "interview-prep-library": "面接標準回答集",
  "interview-prep": "面接回の準備",
  policy: "ルール",
  "policy-change": "ルール変更",
  material: "素材",
  "training-profile": "トレーニング像",
  "training-lesson": "トレーニング教材",
  "training-log": "トレーニング記録",
  "language-curriculum": "トレーニング課程",
  "language-bank": "言語素材集",
  "language-session-log": "トレーニングセッション",
  "language-coach-log": "コーチ記録",
  "language-batch-log": "トレーニングバッチ",
  "language-quick-log": "クイック練習の記録",
  "language-expression-course-progress": "表現トレーニングの進捗",
  "practice-log": "コーチ練習",
  "exam-log": "試験記録",
  [JOB_CASE_TYPE]: "応募案件",
  "excluded-job": "除外した求人",
  "job-audit": "案件の監査",
  "job-queue": "求人キュー",
  job_platform_sync: "媒体同期",
  application_log: "応募記録",
  "outbound-draft": "連絡の下書き",
  application_documents: "応募書類",
  application_documents_review: "書類レビュー",
  application_documents_changelog: "書類の変更履歴",
  application_document_strategy: "書類の方針",
  mail: "メールの証拠",
  "review-request": "振り返り依頼",
  ledger: "台帳",
  todo: "TODO",
  moc: "索引",
  note: "ノート",
};

/** 与资料库、双链预览同一套日文信任层译名（library-view / wiki-preview 的 trust 表）。 */
const TRUST_LABELS_JA: Record<string, string> = {
  "trust-authority": "確定情報",
  "trust-evidence": "証拠",
  "trust-analysis": "分析 / 仮説",
  "trust-reference": "案内 / 素材",
};

/** 与资料库、双链预览同一套日文分区名。 */
const GROUP_LABELS_JA: Record<GroupKey, string> = {
  self: "自己紹介",
  career: "就職活動",
  study: "日本語学習",
  analysis: "AI 分析",
  system: "システム",
};

export function localizedGroupLabel(group: GroupKey, locale: UiLocale) {
  return locale === "ja" ? GROUP_LABELS_JA[group] : GROUPS[group].label;
}

export function localizedTypeLabel(type: string, locale: UiLocale) {
  if (locale !== "ja") return typeLabel(type);
  return TYPE_LABELS_JA[type] ?? typeLabel(type);
}

export function localizedTrustLabel(note: Note, locale: UiLocale) {
  const trust = trustLayer(note);
  return locale === "ja" ? TRUST_LABELS_JA[trust.className] ?? trust.label : trust.label;
}

export function libraryScopeMatches(note: Note, scope: LibraryScope) {
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

/** 状态文字与颜色遵循看板的统一规则，避免不同视图对同一状态显示不一致。 */
export function careerStatus(status: string) {
  const base = normalizeJobStatus(status) ?? status.trim();
  return { label: base || "未分類", tone: statusTone(base) };
}

export function notePreview(note: Note) {
  const text = stripMarkdown(note.content).replace(/\s+/g, " ").trim();
  const title = stripMarkdown(getTitle(note)).replace(/\s+/g, " ").trim();
  const withoutRepeatedTitle = text.startsWith(title) ? text.slice(title.length).trim() : text;
  return withoutRepeatedTitle || "这篇记忆暂时没有可预览的正文。";
}

export function noteFolder(path: string) {
  const folders = path.split("/").slice(0, -1);
  return folders.length ? folders.join(" / ") : "Vault 根目录";
}

const WIKILINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;

export function extractLinks(content: string) {
  // 本文からは「リンクと見なさない領域」（コードフェンス・HTML コメント・行内コード）を落とす
  // ——例示コードの [[…]] は知識関係ではない。知識図譜の extractWikiLinks と同じ剥ぎ方。
  //
  // frontmatter は落とさず**別に**拾う。source_note / annotation_note / target_note のような
  // 構造化された関係はれっきとしたリンクで、図譜側も専用ルールで辺を張っている
  // （knowledge-graph.ts）。本文と一緒に剥ぐと、進捗ノートや批注ノートのように
  // frontmatter からしか繋がっていないノートが首页では「孤立」、図譜では「連結」に割れる。
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const body = stripNonLinkRegions(content);
  return [
    ...Array.from(frontmatter.matchAll(WIKILINK)),
    ...Array.from(body.matchAll(WIKILINK)),
  ]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

// 同一批 notes 会被反复问「这篇有哪些链接」（派生统计、资料库排序、反链、卡片角标）。
// 内容不变时答案不变，所以按 note 对象缓存。notes 数组整体替换、单条 patch 都会
// 产生新对象，WeakMap 自然失效，不需要手动清理。
const noteLinksCache = new WeakMap<Note, string[]>();

export function noteLinks(note: Note): string[] {
  const cached = noteLinksCache.get(note);
  if (cached) return cached;
  const links = extractLinks(note.content);
  noteLinksCache.set(note, links);
  return links;
}

export function countMatches(content: string, expression: RegExp) {
  return Array.from(content.matchAll(expression)).length;
}

// 搜索的干草堆按 note 缓存。以前每敲一个字都对全库 300 篇重建小写 haystack
// （含 JSON.stringify frontmatter，约 5.5MB 字符串分配/键击）。
const haystackCache = new WeakMap<Note, string>();

function noteHaystack(note: Note) {
  const cached = haystackCache.get(note);
  if (cached) return cached;
  const haystack = `${note.path}\n${note.content}\n${JSON.stringify(note.frontmatter)}`.toLowerCase();
  haystackCache.set(note, haystack);
  return haystack;
}

export function noteMatches(note: Note, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  const haystack = noteHaystack(note);
  // 空白分隔的多个 token 是 AND；单个 token 的值里用 | 分隔是 OR。
  // 「進行中の選考」这种跨多个枚举值的条件，没有 OR 就一条都写不出来。
  return query.split(/\s+/).every((token) => {
    const [prefix, ...rest] = token.split(":");
    const value = rest.join(":");
    if (!value) return haystack.includes(token);
    const alternatives = value.split("|").filter(Boolean);
    if (!alternatives.length) return haystack.includes(token);
    if (prefix === "type") {
      const type = getType(note).toLowerCase();
      return alternatives.some((item) => type.includes(item));
    }
    if (prefix === "status") {
      const status = getString(note.frontmatter.status).toLowerCase();
      return alternatives.some((item) => status.includes(item));
    }
    if (prefix === "folder") {
      const path = note.path.toLowerCase();
      return alternatives.some((item) => path.includes(item));
    }
    // 未知前缀退回全文子串：此时 token 原样匹配（`重要度:高` 这类写法靠这条生效）。
    return haystack.includes(token);
  });
}

export function normalizeHeading(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\*\*/g, "")
    .replace(/\[\[([^#|\]]+)(?:#[^|\]]+)?(?:\|([^\]]+))?\]\]/g, "$2$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 按 ?section= 找章节：全等优先，其次前缀互含（链接里的章节名常被截短，或标题后来补了括注）。
 * 抽屉与阅读层以前各写了一份，判定细节一改就两边不一致，所以只留这一份。
 */
export function findHeadingBySection<T extends { id: string; text: string }>(headings: readonly T[], section: string | null | undefined): T | undefined {
  if (!section) return undefined;
  const wanted = normalizeHeading(section);
  if (!wanted) return undefined;
  const normalized = headings.map((heading) => normalizeHeading(heading.text));
  const exact = normalized.findIndex((actual) => actual === wanted);
  if (exact >= 0) return headings[exact];
  const loose = normalized.findIndex((actual) => actual && (actual.startsWith(wanted) || wanted.startsWith(actual)));
  return loose >= 0 ? headings[loose] : undefined;
}

// 反链的口径与 noteLinks 一致：链接目标文字与文件名（不含 .md）全等才算。
// 抽屉、场景阅读层、阅读层文末都要问「谁提到了这篇」，每次全库走一遍是 O(n)；
// 一批 notes 只建一次索引，notes 数组整体替换时 WeakMap 自然失效。
const backlinkIndexCache = new WeakMap<readonly Note[], Map<string, Note[]>>();

function backlinkIndex(notes: readonly Note[]) {
  const cached = backlinkIndexCache.get(notes);
  if (cached) return cached;
  const index = new Map<string, Note[]>();
  for (const candidate of notes) {
    for (const target of new Set(noteLinks(candidate))) {
      const list = index.get(target);
      if (list) list.push(candidate);
      else index.set(target, [candidate]);
    }
  }
  backlinkIndexCache.set(notes, index);
  return index;
}

export function noteBacklinks(notes: readonly Note[], note: Note): Note[] {
  const basename = noteBasename(note.path);
  return (backlinkIndex(notes).get(basename) ?? []).filter((candidate) => candidate.path !== note.path);
}

const basenameIndexCache = new WeakMap<readonly Note[], Map<string, Note | null>>();

/** 本文链接到的笔记。同名多篇无法判定指向哪一篇，宁可不列也不猜（与 resolveNoteLink 同一原则）。 */
export function noteOutlinks(notes: readonly Note[], note: Note): Note[] {
  let index = basenameIndexCache.get(notes);
  if (!index) {
    index = new Map();
    for (const candidate of notes) {
      const name = noteBasename(candidate.path);
      index.set(name, index.has(name) ? null : candidate);
    }
    basenameIndexCache.set(notes, index);
  }
  const seen = new Set<string>();
  const result: Note[] = [];
  for (const target of noteLinks(note)) {
    const linked = index.get(target);
    if (!linked || linked.path === note.path || seen.has(linked.path)) continue;
    seen.add(linked.path);
    result.push(linked);
  }
  return result;
}

const LINE_WIKILINK = /!?\[\[([^\]|#]+)(#[^\]|]+)?(?:\\?\|([^\]]+))?\]\]/g;
const backlinkContextCache = new WeakMap<Note, Map<string, SnippetPart[] | null>>();

/**
 * 把一行 Markdown 变成可读的一句：链接换成显示名，去掉行首记号与强调符，空白折叠成一个。
 * 同时返回目标链接在结果里的位置——边拼边记，事后再去找会撞上同名的普通文字。
 */
function readableLine(line: string, basename: string) {
  const body = line.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)+/u, "");
  const clean = (value: string) => value.replace(/\*\*|__|`|==|~~/g, "").replace(/\s+/g, " ");
  let text = "";
  let hit: [number, number] | null = null;
  let cursor = 0;
  for (const match of body.matchAll(LINE_WIKILINK)) {
    const at = match.index ?? 0;
    text += clean(body.slice(cursor, at));
    // 表格里的别名链接写成 [[目标\|别名]]，目标末尾会带一个转义用的反斜杠。
    const target = match[1].trim().replace(/\\$/u, "");
    const display = clean((match[3] ?? target).trim());
    if (!hit && target === basename) hit = [text.length, text.length + display.length];
    text += display;
    cursor = at + match[0].length;
  }
  text += clean(body.slice(cursor));
  return { text, hit };
}

/**
 * 反链的引用上下文：source 里提到 basename 的那一行，链接前后各约 radius 字，链接本身标为命中。
 * 只提到在 frontmatter 里（source_note: [[…]] 这类结构化关系）时取那一行属性。找不到返回 null。
 * 按 source 对象缓存：抽屉的反链栏每次重渲染都会问一遍。
 */
export function backlinkContext(source: Note, basename: string, radius = 60): SnippetPart[] | null {
  let perNote = backlinkContextCache.get(source);
  if (!perNote) {
    perNote = new Map();
    backlinkContextCache.set(source, perNote);
  }
  if (perNote.has(basename)) return perNote.get(basename) ?? null;
  const frontmatter = source.content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const lines = [...stripNonLinkRegions(source.content).split("\n"), ...frontmatter.split("\n")];
  let result: SnippetPart[] | null = null;
  for (const line of lines) {
    if (!line.includes("[[")) continue;
    const { text, hit } = readableLine(line, basename);
    if (!hit) continue;
    const [from, to] = hit;
    const start = Math.max(0, from - radius);
    const end = Math.min(text.length, to + radius);
    const before = text.slice(start, from).trimStart();
    const after = text.slice(to, end).trimEnd();
    result = [
      { text: `${start > 0 ? "…" : ""}${before}`, hit: false },
      { text: text.slice(from, to), hit: true },
      { text: `${after}${end < text.length ? "…" : ""}`, hit: false },
    ].filter((part) => part.text);
    break;
  }
  perNote.set(basename, result);
  return result;
}

export function seeded(path: string) {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

export function getNoteDate(note: Note) {
  const frontmatterDate = getString(note.frontmatter.date);
  const filenameDate = note.path.match(/(20\d{2}-\d{2}-\d{2})/)?.[1];
  return frontmatterDate || filenameDate || "";
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 今日から見て何日か。日付として読めなければ null（0日先と区別する）。 */
export function daysFromToday(date: string, now = new Date()) {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(`${localDateKey(now)}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/**
 * 「3 天后」「今天」のような相対表記。
 *
 * 過去を必ず「N 天前」に落とすのが要点。以前は頂栏側が負の日数を
 * そのまま `${days} 天后` に流していて、期限を過ぎた予定が「-2 天后」と出ていた。
 * 表示だけの分岐に見えるが、遅れているものが遅れて見えないという実害がある。
 */
export function countdownLabel(date: string, now = new Date()) {
  const days = daysFromToday(date, now);
  if (days === null) return "日期未定";
  if (days === 0) return "今天";
  if (days === 1) return "明天";
  if (days > 1) return `${days} 天后`;
  return `${-days} 天前`;
}

export function todoPriority(note: Note) {
  return getString(note.frontmatter.priority).toLowerCase() || "medium";
}
export function todoStatus(note: Note) {
  return getString(note.frontmatter.status) || "未着手";
}
export function todoAudience(note: Note) {
  return getString(note.frontmatter.audience) === "system" ? "system" : "user";
}
export function todoAction(note: Note) {
  return getString(note.frontmatter.action) || getTitle(note);
}

/**
 * 種別語が無ければ null を返す。「判定できなかった」と「面谈と判定した」を
 * 呼び出し側で区別するために要る——両者を潰すと、日時だけの構造化フィールドが
 * 常に「面谈」に化けて、しかもそれが正しい判定に見えてしまう。
 */
function detectEventLabel(text: string): string | null {
  const normalized = text.normalize("NFKC");
  // 日文「説明会」・繁体「說明會」・英文 seminar も同じ種別。漏れると既定の「面谈」に化けて、
  // 面试扱い（日历の準備稿入口）になる（isInterviewEvent の除外表と揃える）。
  if (/セミナー|说明会|説明会|說明會|seminar/i.test(normalized)) return "招聘说明会";
  if (interviewRound(normalized) === "agent") return "猎头面谈";
  const round = calendarRoundBadge(normalized);
  if (round) return round.label;
  if (/面接|面试|面試|\binterview\b/i.test(normalized)) return "面试";
  if (/面談|面谈|面談|\bmeeting\b/i.test(normalized)) return "面谈";
  return null;
}

export function calendarEventLabel(text: string) {
  return detectEventLabel(text) ?? "面谈";
}

export function calendarEventTime(event: Pick<CalendarEvent, "time" | "endTime">) {
  return event.time && event.endTime ? `${event.time}–${event.endTime}` : event.time;
}

function scheduledEndTime(note: Note) {
  const dateTime = /^(20\d{2}-\d{2}-\d{2})[ T]((?:[01]\d|2[0-3]):[0-5]\d)$/u;
  const start = getString(note.frontmatter.next_event_at).match(dateTime);
  const end = getString(note.frontmatter.next_event_end_at).match(dateTime);
  // 只认同一已确认场次的结束时刻，不从正文时长推算，也不转换本地时区。
  return start && end && start[1] === end[1] && end[2] > start[2] ? end[2] : undefined;
}

/**
 * 日历の重複判定に使う会社 identity。
 * 表示名は出所ごとに `株式会社Nova Systems` / `Nova_Systems` のように
 * 揺れるが、人間には同じ会社である。法人格・空白・区切りだけを落とし、語そのものは
 * 残すことで、見た目の揺れだけを吸収する。
 */
export function calendarCompanyIdentity(company: string) {
  // 実体は notes.ts の companyIdentity（review-join と共用）。名前だけ日历の文脈で残す。
  return companyIdentity(company);
}

function calendarCompanyDisplayScore(company: string) {
  const normalized = company.normalize("NFKC");
  return (/(?:株式会社|有限会社|合同会社)/u.test(normalized) ? 6 : 0) +
    (!/_/.test(normalized) ? 2 : 0) +
    (!/[\\/]/.test(normalized) ? 1 : 0) +
    Math.min(normalized.length, 40) / 100;
}

function validCalendarDate(date: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return false;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}

export function buildCalendarEvents(notes: Note[], now = new Date()): CalendarEvent[] {
  const today = localDateKey(now);
  const contexts = new Map(notes.map((note) => [note.path, interviewContext(note, notes, true)]));
  const eligiblePrep = (note: Note) => getType(note) === "interview-prep" &&
    !contexts.get(note.path)?.invalid &&
    ["", "scheduled", "completed"].includes(getString(note.frontmatter.session_status ?? note.frontmatter.schedule_status));
  const matchingNotes = notes.filter((note) => getType(note) !== "interview-prep" || eligiblePrep(note));
  type Candidate = CalendarEvent & { priority: number; identity: string };
  const candidates: Candidate[] = [];

  const addEvent = (note: Note, date: string, time: string, label: string, priority: number, endTime?: string) => {
    if (!validCalendarDate(date) || contexts.get(note.path)?.invalid) return;
    const company = getString(note.frontmatter.company) || getTitle(note);
    const context = contexts.get(note.path);
    const candidate: Candidate = {
      id: "", note, kind: "event", date, time, company, label,
      ...(endTime ? { endTime } : {}),
      phase: date >= today ? "upcoming" : "past",
      caseId: context?.caseId ?? "", prepPath: "", priority, identity: "",
    };
    // 旧稿只能由唯一匹配的场次补足关联；不同职位或独立面谈不能按公司名称混在一起。
    const prep = getType(note) === "interview-prep" ? note : matchingInterviewPrep(candidate, matchingNotes);
    if (prep) {
      candidate.caseId ||= contexts.get(prep.path)?.caseId ?? "";
      candidate.prepPath = prep.path;
    } else if (candidate.caseId) {
      const undated = matchingNotes.filter((item) => eligiblePrep(item) &&
        contexts.get(item.path)?.caseId === candidate.caseId && !getString(item.frontmatter.date));
      if (undated.length === 1) candidate.prepPath = undated[0].path;
    }
    const ownerContext = prep ? contexts.get(prep.path) :
      !context?.ownerKind && !context?.caseId ? matchingInterviewContext(candidate, matchingNotes) ?? context : context;
    candidate.caseId ||= ownerContext?.caseId ?? "";
    candidate.identity = candidate.caseId ? `case:${candidate.caseId}` :
      ownerContext?.ownerKind === "meeting" && ownerContext.owner ? `meeting:${ownerContext.owner}` :
      `company:${calendarCompanyIdentity(company) || company.toLocaleLowerCase("ja-JP")}`;
    const round = resolveCalendarRoundBadge(candidate, matchingNotes);
    if (round) candidate.label = round.label;
    candidate.id = `${candidate.identity}|${date}|${time}|${note.path}`;
    candidates.push(candidate);
  };

  for (const note of notes) {
    const type = getType(note);
    const date = getString(note.frontmatter.date);
    if (type === "interview-prep" || type === "review" || type === "transcript") {
      if (type === "interview-prep" && !eligiblePrep(note)) continue;
      const stage = getString(note.frontmatter.round) || getString(note.frontmatter.kind) || getTitle(note);
      const label = detectEventLabel(stage);
      // review 还用于邮件审阅、跟进结果，日期不一定是场次日期。必须明确记载面试／面谈。
      if (!label && type !== "interview-prep") continue;
      const time = interviewNoteTime(note, date);
      const end = getString(note.frontmatter.end_time);
      addEvent(note, date, time, label ?? "面谈", type === "review" ? 4 : 3,
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) && time && end > time ? end : undefined);
      continue;
    }
    if (type !== JOB_CASE_TYPE && (type !== "todo" || todoStatus(note) === "完了")) continue;
    // 只投影结构化的确约。正文、next_action、通知及返信时间都不能推测为新场次。
    const scheduled = getString(note.frontmatter.next_event_at);
    const match = scheduled.match(/^(20\d{2}-\d{2}-\d{2})(?:[ T]((?:[01]?\d|2[0-3]):[0-5]\d))?(?:\s+([^\d].*))?$/u);
    if (!match) continue;
    const time = match[2]?.padStart(5, "0") ?? "";
    // 当前行动可能谈的是下一轮或复盘，只由本场资料补轮次，不借它给历史场次贴标签。
    const label = detectEventLabel(getString(note.frontmatter.next_event_label)) ?? detectEventLabel(match[3] ?? "") ??
      (type === "todo" ? detectEventLabel(getTitle(note)) : null) ?? "面谈";
    addEvent(note, match[1], time, label, type === JOB_CASE_TYPE ? 4 : 3, scheduledEndTime(note));
  }

  const roundOf = (event: CalendarEvent) => interviewRound(event.label);
  const compatible = (left: Candidate, right: Candidate) => left.identity === right.identity && left.date === right.date &&
    !(left.time && right.time && left.time !== right.time) &&
    !((left.label === "招聘说明会") !== (right.label === "招聘说明会")) &&
    !(roundOf(left) && roundOf(right) && roundOf(left) !== roundOf(right));
  // 先处理有明确时间／轮次的来源。缺字段的旧稿仅在候选唯一时补入，避免顺序改变结果。
  candidates.sort((left, right) =>
    (Number(Boolean(right.time)) * 2 + Number(Boolean(roundOf(right)))) -
      (Number(Boolean(left.time)) * 2 + Number(Boolean(roundOf(left)))) ||
    right.priority - left.priority || left.note.path.localeCompare(right.note.path));
  const events: Candidate[] = [];
  for (const candidate of candidates) {
    const matches = events.filter((event) => compatible(event, candidate));
    if (matches.length !== 1) {
      events.push(candidate);
      continue;
    }
    const current = matches[0];
    const winner = current.priority < candidate.priority ? candidate : current;
    const other = winner === candidate ? current : candidate;
    events[events.indexOf(current)] = {
      ...winner,
      company: calendarCompanyDisplayScore(current.company) >= calendarCompanyDisplayScore(candidate.company)
        ? current.company : candidate.company,
      time: winner.time || other.time,
      ...(winner.endTime || ((!winner.time || winner.time === other.time) && other.endTime)
        ? { endTime: winner.endTime || other.endTime } : {}),
      label: roundOf(winner) ? winner.label : roundOf(other) ? other.label : winner.label,
      prepPath: winner.prepPath || other.prepPath,
    };
  }
  return events.sort((left, right) => left.date.localeCompare(right.date) ||
    left.time.localeCompare(right.time) || left.id.localeCompare(right.id));
}

/** 待ち相手の文言は lib/jobs.ts の WAITING_FOR_LABEL から組む（画像ヘッダーと同じ語）。 */
function waitingLabel(waitingFor: string) {
  if (waitingFor === "self") return "本人行动";
  return WAITING_FOR_LABEL[waitingFor] ? `等待${WAITING_FOR_LABEL[waitingFor]}` : "外部等待";
}

/** 原始期限与真实约定共用的承诺投影；日历仅使用其中的日程。 */
export function buildCommitments(
  notes: Note[],
  now = new Date(),
  events = buildCalendarEvents(notes, now),
): Commitment[] {
  const today = localDateKey(now);
  const commitments: Commitment[] = [...events];
  for (const note of notes) {
    const type = getType(note);
    if (type === "todo" && todoStatus(note) !== "完了") {
      const due = getString(note.frontmatter.due);
      if (/^20\d{2}-\d{2}-\d{2}$/.test(due)) {
        commitments.push({
          id: `action|${note.path}|${due}`,
          note,
          kind: "action",
          date: due,
          time: "",
          company: todoAction(note),
          label: "行动期限",
          phase: due >= today ? "upcoming" : "past",
          caseId: getString(note.frontmatter.case_id),
          prepPath: "",
        });
      }
      continue;
    }
    if (type !== JOB_CASE_TYPE) continue;
    const followUpAt = getString(note.frontmatter.follow_up_at);
    const waitingFor = getString(note.frontmatter.waiting_for);
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(followUpAt) || !waitingFor) continue;
    commitments.push({
      id: `follow-up|${note.path}|${followUpAt}`,
      note,
      kind: "follow-up",
      date: followUpAt,
      time: "",
      company: getString(note.frontmatter.company) || getTitle(note),
      label: `${waitingLabel(waitingFor)} · 跟进`,
      phase: followUpAt >= today ? "upcoming" : "past",
      caseId: getString(note.frontmatter.case_id),
      prepPath: "",
      waitingFor,
    });
  }
  return commitments.sort((left, right) =>
    left.date.localeCompare(right.date) ||
    left.time.localeCompare(right.time) ||
    left.kind.localeCompare(right.kind),
  );
}

/**
 * 全量スナップショットへ「サーバがまだ追いついていない書き込み」を被せ直す。
 *
 * なぜ要るか：全量取得は在途中に発行されたものが後から着地し得る。着地したスナップショットは
 * **発行時点**の vault なので、その後の書き込みを含まない——素直に採用すると書いたばかりの
 * 内容が写前の値で黙って消える。書き込みごとに全量再取得していた頃は最後に着地するのが
 * ほぼ必ず写後スナップショットだったので表面化しなかった。
 *
 * 突き合わせは本文の一致で行う（mtime はサーバ側とクライアント組み立てで基準が違う）。
 * 一致したものは settled として返し、呼ぶ側が台帳から落とす。
 */
export type PendingWrite = { note: Note; at: number };

/**
 * 台帳に残せる上限。守りたいのは「この書き込みより前に発行された全量取得が後から着地する」
 * ことだけで、それは最長でも強制爬取の1秒程度。桁で余裕を取った値にしてある。
 *
 * 期限が要る理由：突き合わせは本文の一致で行うので、Obsidian 側で手編集された等で
 * サーバと食い違ったままになると、期限が無ければ自分の版を**永久に**貼り続ける
 * （その間サーバ側の実際の内容は画面に出てこない）。
 */
export const PENDING_WRITE_TTL_MS = 30_000;

export function mergePendingWrites(
  incoming: Note[],
  pending: ReadonlyMap<string, PendingWrite>,
  now = Date.now(),
): { notes: Note[]; settled: string[] } {
  if (pending.size === 0) return { notes: incoming, settled: [] };
  const byPath = new Map(incoming.map((note) => [note.path, note]));
  const settled: string[] = [];
  for (const [path, written] of pending) {
    // 期限切れはサーバ側を正とする。食い違いの理由（手編集・削除・改名）を
    // クライアントからは区別できないので、時間で降りる。
    if (now - written.at > PENDING_WRITE_TTL_MS) {
      settled.push(path);
      continue;
    }
    const server = byPath.get(path);
    if (server && server.content === written.note.content) {
      settled.push(path);
      continue;
    }
    // server が居ない＝この書き込みより前に発行されたスナップショット（新規作成が典型）。
    // 期限内はこちらを残す。期限を過ぎれば上の分岐で降りるので、幽霊にはならない。
    byPath.set(path, written.note);
  }
  return {
    notes: [...byPath.values()].sort((left, right) => right.stat.mtime - left.stat.mtime),
    settled,
  };
}

export function buildDerivedData(notes: Note[], now = new Date()): DerivedData {
  // 每篇只解析一次链接（以前 flatMap 扫一遍、orphan filter 再扫一遍）。
  const links = notes.flatMap((note) => noteLinks(note));
  const linkedNames = new Set(links);
  const orphanCount = notes.filter(
    (note) =>
      noteLinks(note).length === 0 &&
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
  const calendarEvents = buildCalendarEvents(notes, now);
  const commitments = buildCommitments(notes, now, calendarEvents);
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
    commitments,
    totalErrors,
    highPriorityErrors,
    promoted,
    incompleteSelf,
    selfNotes: selfNotes.length,
    analysisCount: notes.filter((note) => getType(note) === "ai-report").length,
    evidenceCount: evidenceNotes.length,
    evidenceCompleteness: evidenceNotes.length ? (completeEvidence / evidenceNotes.length) * 100 : 0,
  };
}
