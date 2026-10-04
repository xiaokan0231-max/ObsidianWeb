import { getType, type Note } from "./notes.ts";
import { isLanguageTextbookChapter } from "./language-textbook.ts";

export type VaultScope = "all" | "overview" | "actions" | "jobs" | "interview" | "training";

// 场次材料也是日历历史来源；冷启动与打开复盘后的投影必须相同。
const COMMITMENT_TYPES = new Set(["job-case", "todo", "interview-prep", "review", "transcript", "transcript-study"]);
// 首页の「复盘提醒」は整理稿を起点に数える（lib/review-join.ts）。整理稿を落とすと冷启动で「待裁定 0」が出続けた。
const OVERVIEW_REVIEW_TYPES = new Set(["interview-answer-practice", "transcript-study", "study-annotation", "interview-answer-review"]);
const INTERVIEW_TYPES = new Set([
  "interview-prep", "interview-prep-library", "transcript", "transcript-study", "study-annotation",
  "review", "interview-answer-review", "interview-answer-practice", "interview-answer-feedback",
  "interview-insights", "interview-insights-feedback", "interview-advisory-state",
  // material＝自己紹介台本・転職理由台本・当日フレーズ集・単語文法帳・NG集・横断傾向。
  // 準備稿の ![[…]] の展開先であり、全局共用資産の入口が開く実体でもある。
  // 外すと埋め込みが「解決できません」になり、共用入口を押しても何も出ない。
  "material",
]);
const TRAINING_TYPES = new Set([
  "study", "training-profile", "training-lesson", "training-log", "practice-log", "exam-log",
  "language-curriculum", "language-bank", "language-session-log", "language-coach-log",
  "language-batch-log", "language-expression-course", "language-expression-course-progress",
]);

export function isLanguageScenarioResource(note: Note) {
  return getType(note) === "material"
    && ["language-scenario-guide", "language-scenario-coverage"].includes(String(note.frontmatter.material_kind));
}

export function normalizeVaultScope(value: string | null): VaultScope {
  return value === "overview" || value === "actions" || value === "jobs" || value === "interview" || value === "training"
    ? value
    : "all";
}

export function noteInVaultScope(note: Note, scope: VaultScope) {
  if (scope === "all") return true;
  const type = getType(note);
  if (scope === "overview") {
    return COMMITMENT_TYPES.has(type) || OVERVIEW_REVIEW_TYPES.has(type);
  }
  if (scope === "actions") return COMMITMENT_TYPES.has(type) || type === "outbound-draft";
  if (scope === "jobs") {
    return type === "job-case" || Boolean(note.frontmatter.case_id) || ["ledger", "job-queue", "job-audit", "job_platform_sync", "ai-report"].includes(type);
  }
  if (scope === "interview") return INTERVIEW_TYPES.has(type) || COMMITMENT_TYPES.has(type) || type === "company" || type === "self"
    || (type === "ai-report" && ["company-fit", "company-summary"].includes(String(note.frontmatter.report_kind)));
  // 专项课和学习说明属于 material；按标记读取，避免把全部求职素材载入训练页。
  return TRAINING_TYPES.has(type) || type === "self"
    || (type === "material" && note.frontmatter.material_kind === "language-expression-course")
    || isLanguageTextbookChapter(note)
    || isLanguageScenarioResource(note);
}

/**
 * vault:stats 重算之后要取回的 scope。生成区块散在多处（台帳・応募日台帳は jobs、面接傾向は interview、
 * 数据字典は all にしか入らない）ので、手元に載っているものを全部。all があればそれ一つで足りる。
 */
export function scopesToReloadAfterStats(loaded: Iterable<VaultScope>): VaultScope[] {
  const scopes = [...new Set(loaded)];
  return scopes.includes("all") ? ["all"] : scopes;
}

export function vaultScopeForView(view: string): VaultScope {
  if (view === "calendar") return "actions";
  if (view === "jobs" || view === "analytics") return "jobs";
  if (view === "session" || view === "prep" || view === "review" || view === "practice" || view === "insights") return "interview";
  if (view === "language" || view === "topics") return "training";
  return "all";
}
