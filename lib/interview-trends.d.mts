/**
 * interview-trends.mjs の型。実装は vault:stats（Node）と Web の両方から使うので
 * .mjs のままにし、TS 消費者（本場面試・復盤画面）にはここで形を与える。
 * これが無いと weakestDimension が string、dimensionAverages が {} に推論され、
 * REVIEW_DIMENSION_META を引けない。
 */
import type { InterviewAnswerReview, ReviewDimensionKey } from "./review-deep.ts";

export const REPEATED_INTERVIEW_MIN: number;

export function isRepeatedAcrossInterviews(interviewCount: number): boolean;

export const STRATEGY_TREND_META: Record<
  string,
  { label: string; description: string }
>;

export function interviewKeyFromNoteName(name: string): string;

export type TrendEntry = {
  key: string;
  company: string;
  date: string;
  round: string;
  review: InterviewAnswerReview | null;
};

export function reviewTrendEntry(
  path: string,
  frontmatter: Record<string, unknown>,
  content: string,
): TrendEntry;

export type CardCoverage = Map<string, { id: string; title: string }[]>;

export function buildCardCoverage(libraryContent: string): CardCoverage;

export type TrendInterview = {
  key: string;
  company: string;
  date: string;
  round: string;
  overall: number;
  dimensions: Record<ReviewDimensionKey, number | null>;
  priorityBlocks: {
    blockId: string;
    title: string;
    cards: { id: string; title: string }[];
  }[];
};

export type TrendTagExample = {
  key: string;
  company: string;
  date: string;
  blockId: string;
  title: string;
  cards: { id: string; title: string }[];
};

export type TrendTag = {
  tag: string;
  label: string;
  description: string;
  interviews: number;
  occurrences: number;
  repeated: boolean;
  inLatest: boolean;
  inRecent: boolean;
  examples: TrendTagExample[];
};

export type InterviewTrends = {
  interviews: TrendInterview[];
  dimensionAverages: Record<ReviewDimensionKey, number | null>;
  weakestDimension: ReviewDimensionKey | null;
  tags: TrendTag[];
  latestKey: string | null;
  recentKeys: string[];
  quietRecently: TrendTag[];
  uncoveredBlocks: (TrendInterview["priorityBlocks"][number] & {
    company: string;
    date: string;
    key: string;
  })[];
};

export function buildInterviewTrends(
  entries: TrendEntry[],
  coverage?: CardCoverage,
): InterviewTrends;

export function renderInterviewTrends(trends: InterviewTrends): string;
