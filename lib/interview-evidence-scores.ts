import { REVIEW_DIMENSION_META, type ReviewDimensionKey } from "./review-deep.ts";
import { getString } from "./notes.ts";

type ScoreRecord = Record<string, unknown>;
const DIMENSION_KEYS = Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[];

function record(value: unknown): ScoreRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ScoreRecord : null;
}

function finiteScore(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** 日历只读已保存的评分；窄化原始字段，不要求同时发布趋势页的评分模型改造。 */
export function interviewEvidenceScores(entry: { review?: unknown; reassessment?: unknown }): {
  scored: boolean;
  reassessed: boolean;
  dimensions: Record<ReviewDimensionKey, number | null>;
  assessed: ReviewDimensionKey[];
  overall: number | null;
  historical: number | null;
  methodVersion: string;
} {
  const rawMetadata = record(entry.reassessment)?.frontmatter ?? entry.reassessment;
  const metadata = record(rawMetadata);
  const review = record(entry.review);
  const reassessed = Boolean(rawMetadata);
  const scored = Boolean(reassessed ? metadata?.evaluation_mode === "scored_evidence" : review?.evaluationMode === "scored_evidence");
  const rawDimensions = record(reassessed ? metadata?.dimension_scores : review?.dimensions);
  const dimensions = Object.fromEntries(DIMENSION_KEYS.map((key) => {
    const dimension = record(rawDimensions?.[key]);
    return [key, scored ? finiteScore(reassessed ? rawDimensions?.[key] : dimension?.level === "not_assessed" ? null : dimension?.score) : null];
  })) as Record<ReviewDimensionKey, number | null>;
  const assessed = DIMENSION_KEYS.filter((key) => dimensions[key] !== null);
  const evaluation = record(review?.evaluation);
  const full = reassessed ? metadata?.assessment_scope === "full_available_text"
    : evaluation?.materialScope !== "limited" && evaluation?.scoringEligible !== false;
  const eligible = scored && full && assessed.length >= 3 && dimensions.coverage !== null && dimensions.directness !== null;
  return {
    scored, reassessed, dimensions, assessed,
    overall: eligible ? finiteScore(reassessed ? metadata?.overall_score : review?.overallScore) : null,
    historical: finiteScore(reassessed ? metadata?.historical_score : scored || review?.evaluationMode === "evidence" ? null : review?.overallScore),
    methodVersion: reassessed ? getString(metadata?.method_version) : getString(record(review?.scoring)?.methodVersion),
  };
}
