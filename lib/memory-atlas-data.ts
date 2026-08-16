// 記憶星図の「ノート配列 → 画面が読む数字と一覧」層。React にも three にも依存しない。
// ここに置く理由: 首页の健康度・日历・图书馆の絞り込みは全部ここで決まる派生値で、
// tsx の中に居る限り単体テストが書けず、間違っても誰も気づけない。

import { graphGroup, type GraphGroup } from "./knowledge-graph.ts";
import {
  companyIdentity,
  getString,
  getTitle,
  getType,
  noteBasename,
  stripFrontmatter,
  stripMarkdown,
  stripNonLinkRegions,
  type Note,
} from "./notes.ts";
import { joinReviewNotes } from "./review-join.ts";
import { parseInterviewAnswerReview, type InterviewAnswerReview } from "./review-deep.ts";
import { JOB_CASE_TYPE } from "./vault-boundary.mjs";

export type GroupKey = GraphGroup;
export type LibraryScope = "all" | "evidence" | "action" | "interview" | "language" | "analysis";

export type CalendarEvent = {
  id: string;
  note: Note;
  date: string;
  time: string;
  company: string;
  label: string;
  phase: "upcoming" | "past";
};

export type ReviewPreviewDoc = {
  key: string;
  company: string;
  date: string;
  round: string;
  decisionTotal: number;
  pendingDecisions: number;
  deepReview?: InterviewAnswerReview;
};

export type ReviewPreview = {
  docs: ReviewPreviewDoc[];
  reviewedCount: number;
  pendingDecisions: number;
  readyCount: number;
  scoreDoc: ReviewPreviewDoc | null;
  actionDoc: ReviewPreviewDoc | null;
};

export type DerivedData = {
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

// GraphGroup をキーに固定してあるので、分区が増えた時に色を書き忘れると型で落ちる。
export const GROUPS: Record<GroupKey, {
  label: string;
  short: string;
  color: string;
  tint: string;
}> = {
  self: { label: "关于我", short: "我", color: "#e66d45", tint: "#f9ddd0" },
  career: { label: "求职", short: "职", color: "#2f6b59", tint: "#d8e9df" },
  study: { label: "日语学习", short: "学", color: "#7466a9", tint: "#e3def2" },
  analysis: { label: "AI 分析", short: "析", color: "#b5842f", tint: "#f3e6c8" },
  system: { label: "系统", short: "规", color: "#66706c", tint: "#e5e7e4" },
};

export const ACTIVE_JOB_STATUSES = new Set(["応募済", "書類通過", "面接中"]);

export const TODO_STATUS = ["未着手", "進行中", "保留", "完了"];
export const TODO_PRIORITY: Record<string, { label: string; rank: number }> = {
  high: { label: "高", rank: 0 },
  medium: { label: "中", rank: 1 },
  low: { label: "低", rank: 2 },
};

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

export function careerStatus(status: string) {
  if (["応募済", "書類通過", "面接中"].includes(status)) {
    return { label: status, tone: "active" };
  }
  if (status.includes("不採用")) return { label: "不採用", tone: "rejected" };
  if (status.includes("未応募")) return { label: "未応募", tone: "idle" };
  if (status.includes("辞退")) return { label: "辞退", tone: "idle" };
  return { label: status || "未分類", tone: "idle" };
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

export function getLatestNoteDate(note: Note) {
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

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 今日から見て何日か。日付として読めなければ null（0日先と区別する）。 */
export function daysFromToday(date: string) {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(`${localDateKey()}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/**
 * 「3 天后」「今天」のような相対表記。
 *
 * 過去を必ず「N 天前」に落とすのが要点。以前は頂栏側が負の日数を
 * そのまま `${days} 天后` に流していて、期限を過ぎた予定が「-2 天后」と出ていた。
 * 表示だけの分岐に見えるが、遅れているものが遅れて見えないという実害がある。
 */
export function countdownLabel(date: string) {
  const days = daysFromToday(date);
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

export function buildReviewPreview(notes: Note[]): ReviewPreview {
  // 照合規則そのものは lib/review-join.ts が持つ。ここは要約に必要な数だけを畳む。
  const docs = joinReviewNotes(notes).map((joined): ReviewPreviewDoc => ({
    key: joined.key,
    company: joined.company,
    date: joined.date,
    round: joined.round,
    decisionTotal: joined.decisionTasks.length,
    pendingDecisions: joined.decisionTasks.filter((item) => !item.resolvedBy).length,
    deepReview: joined.deepReviewNote
      ? parseInterviewAnswerReview(joined.deepReviewNote.content) ?? undefined
      : undefined,
  }));
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

/**
 * 種別語が無ければ null を返す。「判定できなかった」と「面谈と判定した」を
 * 呼び出し側で区別するために要る——両者を潰すと、日時だけの構造化フィールドが
 * 常に「面谈」に化けて、しかもそれが正しい判定に見えてしまう。
 */
function detectEventLabel(text: string): string | null {
  if (/エージェント面談|猎头面谈/.test(text)) return "猎头面谈";
  if (/カジュアル面談|轻松面谈/.test(text)) return "轻松面谈";
  if (/最終面接|最终面试/.test(text)) return "最终面试";
  if (/一次面接|一面/.test(text)) return "第一次面试";
  if (/二次面接|二面/.test(text)) return "第二次面试";
  if (/セミナー|说明会/.test(text)) return "招聘说明会";
  if (/面接|面试/.test(text)) return "面试";
  return null;
}

export function calendarEventLabel(text: string) {
  return detectEventLabel(text) ?? "面谈";
}

/**
 * 日历の重複判定に使う会社 identity。
 * 表示名は出所ごとに `株式会社Sharing Innovations` / `Sharing_Innovations` のように
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

export function buildCalendarEvents(notes: Note[], now = new Date()): CalendarEvent[] {
  const today = localDateKey(now);
  const events = new Map<string, CalendarEvent>();

  const addEvent = (note: Note, date: string, source: string, priority: number) => {
    const company = getString(note.frontmatter.company) || getTitle(note);
    // 種別は「勝った出所」ではなくノート全体から決める。next_event_at は書式が
    // 純粋な `YYYY-MM-DD HH:MM` なので単体では種別を判定できず、しかも priority 4 で
    // next_action(3) を上書きするため、規約どおり構造化した予定ほど
    // ラベルが「面谈」へ退化していた（2026-08-04 実証：一次面接が確定している案件が
    // 日历上「面谈」としか出ず、面接が消えたように見えた）。
    // source から読めた時はそれを優先し、読めない時だけ next_action を種別の手掛かりにする。
    const label =
      detectEventLabel(source) ??
      detectEventLabel(getString(note.frontmatter.next_action)) ??
      calendarEventLabel(getTitle(note));
    const time = source.match(/(?:^|\D)((?:[01]?\d|2[0-3]):[0-5]\d)(?:\D|$)/)?.[1] ?? "";
    const identity = calendarCompanyIdentity(company) || company.toLocaleLowerCase("ja-JP");
    const key = `${identity}|${date}`;
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
    if (!current) {
      events.set(key, candidate);
      return;
    }
    const winner = (current.priority ?? 0) < priority ? candidate : current;
    const other = winner === candidate ? current : candidate;
    const displayCompany = calendarCompanyDisplayScore(company) > calendarCompanyDisplayScore(current.company)
      ? company
      : current.company;
    events.set(key, {
      ...winner,
      company: displayCompany,
      time: winner.time || other.time,
      label: winner.label === "面谈" ? other.label : winner.label,
    });
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
    // next_event_at は「確定日程しか書かない」構造化フィールドで、job-inbox-sync が
    // 指示する書式は純粋な YYYY-MM-DD HH:MM。ここに面接などの語を要求すると、
    // 書式どおりに書いた予定が日历から丸ごと消える。todo 側も job-progress 側も
    // 語を要求していないので、案件側の日历だけが黙って落ちていた。
    const scheduled = getString(note.frontmatter.next_event_at);
    const scheduledDate = scheduled.match(/\b(20\d{2}-\d{2}-\d{2})\b/u)?.[1];
    if (scheduledDate) addEvent(note, scheduledDate, scheduled, 4);

    const sources = [
      { line: getString(note.frontmatter.next_action), priority: 3, trusted: true },
      ...stripFrontmatter(note.content)
        .split("\n")
        .map((line) => ({ line, priority: 2, trusted: false })),
    ];
    sources.forEach(({ line, priority, trusted }) => {
      // 🔴 本文からの推測は「予定」より「叙述」を拾いやすい。実測した誤検出3型：
      //   ①`[[ワークポート面談対応]] の 2026-08-08 追記に集約した`＝**ノート名**の中の「面談」
      //   ②`| 2026-07-24 | ワークポート面談実施 → …`＝表の**履歴行**
      //   ③`…2026-07-24…＝面談の前に謝絶`＝「面談に至らなかった」という叙述
      // いずれも予定ではないのに、会社名つきで日历へ出る（＝約束していない面談が現れる）。
      // 予定は next_event_at が正本なので、ここは**取りこぼしの兜底**に徹して厳しく絞る。
      if (!trusted) {
        // 表の行は履歴・照合表であって予定ではない（引用ブロック `> |` の中にもある）。
        if (/^\s*>?\s*\|/.test(line)) return;
        // 語の判定から [[wikilink]] の中身を除く。ノート名は予定の根拠にならない。
        if (!/(?:面接|面談|面试|面谈|カジュアル|セミナー|说明会)/.test(line.replace(/\[\[[^\]]*\]\]/g, ""))) {
          return;
        }
      }
      if (!/(?:面接|面談|面试|面谈|カジュアル|セミナー|说明会)/.test(line)) return;
      // 「拒」は中文表記の拒否（书类拒 等）。拒否の叙述行に他社の日付が混ざり、
      // 別会社の予定として出ていた実例がある（FPTコンサル に FPTソフトウェア の日付）。
      if (!trusted && /(?:通知|リマインド|案内|お礼|準備|証拠|応募|スカウト|不採用|結果|拒)/.test(line)) return;
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
export function mergePendingWrites(
  incoming: Note[],
  pending: ReadonlyMap<string, Note>,
): { notes: Note[]; settled: string[] } {
  if (pending.size === 0) return { notes: incoming, settled: [] };
  const byPath = new Map(incoming.map((note) => [note.path, note]));
  const settled: string[] = [];
  for (const [path, written] of pending) {
    const server = byPath.get(path);
    if (server && server.content === written.content) {
      settled.push(path);
      continue;
    }
    byPath.set(path, written);
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
}
