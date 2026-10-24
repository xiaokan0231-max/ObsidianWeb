import { isInterviewEvent, type CalendarInterviewTarget } from "./calendar-interview.ts";
import type { CalendarEvent } from "./memory-atlas-data.ts";
import { companyIdentity, getString, getType, type Note } from "./notes.ts";
import { interviewRound } from "./interview-round.ts";
import { interviewEvidenceScores } from "./interview-evidence-scores.ts";
import { parseInterviewAnswerReview } from "./review-deep.ts";

export type CalendarInterviewScore = { kind: "overall" | "local"; scores: number[] };

function sameDateRound(note: Note, event: CalendarEvent) {
  const round = interviewRound(getString(note.frontmatter.round));
  const expected = interviewRound(event.label);
  return getString(note.frontmatter.date) === event.date && !(round && expected && round !== expected);
}

function sameSession(note: Note, event: CalendarEvent) {
  return sameDateRound(note, event)
    && companyIdentity(getString(note.frontmatter.company)) === companyIdentity(event.company);
}

function latest(notes: Note[]) {
  const sorted = [...notes].sort((a, b) => getString(b.frontmatter.generated_at).localeCompare(getString(a.frontmatter.generated_at)));
  // 同时生成的两份不同报告无法消歧，不按文件顺序挑一个数字。
  return sorted.length > 1 && getString(sorted[0].frontmatter.generated_at) === getString(sorted[1].frontmatter.generated_at)
    ? null : sorted[0] ?? null;
}

function finiteScores(values: unknown[]) {
  return [...new Set(values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100))];
}

function scoreLabel(overall: number | null, local: unknown[]): CalendarInterviewScore | null {
  if (overall !== null) return { kind: "overall", scores: [overall] };
  const scores = finiteScores(local);
  // 多个局部分分别展示，绝不平均成一个不存在的整场分。
  return scores.length ? { kind: "local", scores } : null;
}

/** 场次解析已经核过日期、轮次、案件和时刻；评分再按完整整理稿路径取正本。 */
export function calendarInterviewScore(event: CalendarEvent, target: CalendarInterviewTarget | undefined, notes: Note[]): CalendarInterviewScore | null {
  if (!isInterviewEvent(event) || target?.view !== "review" || !target.path) return null;
  const reports = notes.filter(note => getType(note) === "ai-report"
    && note.frontmatter.report_kind === "interview-reassessment" && note.frontmatter.report_role === "session"
    && note.frontmatter.source_path === target.path);
  if (reports.length) {
    const report = latest(reports);
    // 新版空分或身份冲突都不能借历史高分替补。报告已按 source_path 精确指向这场整理稿，
    // 其 company 常是文件夹别名（如 テストキャリア 对 株式会社テスト），再比公司名只会挡掉同一场；日期与轮次仍要核对。
    if (!report || !sameDateRound(report, event)) return null;
    const scores = interviewEvidenceScores({ reassessment: report });
    if (!scores.scored) return null;
    const local = Array.isArray(report.frontmatter.local_assessments)
      ? report.frontmatter.local_assessments.map(value => value && typeof value === "object" ? (value as Record<string, unknown>).score : null)
      : [];
    return scoreLabel(scores.overall, local);
  }
  // 后续单场重生成没有独立重评笔记时，读取同目录明确 source_note 指向的质量正本。
  const stem = target.path.replace(/\.md$/i, "");
  const parent = stem.slice(0, stem.lastIndexOf("/") + 1);
  const base = stem.slice(stem.lastIndexOf("/") + 1);
  const candidates = notes.filter(note => {
    if (getType(note) !== "interview-answer-review" || !sameSession(note, event)) return false;
    const ref = getString(note.frontmatter.source_note).replace(/^\[\[|\]\]$/g, "").split("|")[0].split("#")[0].replace(/\.md$/i, "");
    return ref === stem || (ref === base && note.path.slice(0, note.path.lastIndexOf("/") + 1) === parent);
  });
  const report = latest(candidates);
  const review = report ? parseInterviewAnswerReview(report.content) : null;
  const scores = interviewEvidenceScores({ review });
  if (!scores.scored) return null;
  return scoreLabel(scores.overall, scores.assessed.map(key => scores.dimensions[key]));
}
