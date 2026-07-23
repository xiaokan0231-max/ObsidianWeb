export type AnswerComprehension = "clear" | "partial" | "likely_missed";
export type AnswerRelevance = "direct" | "partial" | "off_target";
export type AnswerQuality = "strong" | "mixed" | "weak" | "neutral";
export type AnswerStrategyTag =
  | "compound-question-miss"
  | "no-conclusion-first"
  | "negative-oversharing"
  | "weak-evidence"
  | "over-absolute"
  | "role-mismatch"
  | "numbers-confusion";

export type ReviewDimensionKey =
  | "questionUnderstanding"
  | "coverage"
  | "directness"
  | "evidenceCredibility"
  | "riskControl";

export type InterviewAnswerDimension = {
  score: number;
  rationaleZh: string;
  evidenceBlockIds: string[];
};

export type InterviewAnswerDimensions = Record<ReviewDimensionKey, InterviewAnswerDimension>;

export const REVIEW_DIMENSION_META: Record<ReviewDimensionKey, { label: string; weight: number }> = {
  questionUnderstanding: { label: "问题理解", weight: 0.2 },
  coverage: { label: "覆盖完整度", weight: 0.2 },
  directness: { label: "直接性", weight: 0.2 },
  evidenceCredibility: { label: "证据可信度", weight: 0.2 },
  riskControl: { label: "风险控制", weight: 0.2 },
};

export type InterviewAnswerBlockReview = {
  blockId: string;
  questionTitle: string;
  interviewerIntentZh: string;
  askedPoints: string[];
  answeredPoints: string[];
  missedPoints: string[];
  comprehension: AnswerComprehension;
  relevance: AnswerRelevance;
  quality: AnswerQuality;
  strategyTags: AnswerStrategyTag[];
  evidenceSentenceIds: string[];
  evaluationZh: string;
  improvementZh: string;
  improvedAnswerJa: string;
};

export type InterviewAnswerReview = {
  generatedAt: string;
  model: string;
  overallScore: number;
  /** schema v1 の旧レポートには無い。新規生成では必須。 */
  dimensions?: InterviewAnswerDimensions;
  summaryZh: string;
  strengths: string[];
  weaknesses: string[];
  priorityBlockIds: string[];
  blocks: InterviewAnswerBlockReview[];
};

const DATA_MARKER = "<!-- interview-answer-review-data -->";
const STRATEGY_TAGS: readonly AnswerStrategyTag[] = [
  "compound-question-miss",
  "no-conclusion-first",
  "negative-oversharing",
  "weak-evidence",
  "over-absolute",
  "role-mismatch",
  "numbers-confusion",
];

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function texts(value: unknown, limit = 12) {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, limit) : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function boundedScore(value: unknown) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function normalizeDimensions(
  value: unknown,
  allowedBlockIds: Set<string>,
): InterviewAnswerDimensions | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[];
  if (!keys.every((key) => source[key] && typeof source[key] === "object")) return undefined;
  return Object.fromEntries(
    keys.map((key) => {
      const item = source[key] as Record<string, unknown>;
      return [key, {
        score: boundedScore(item.score),
        rationaleZh: text(item.rationaleZh),
        evidenceBlockIds: texts(item.evidenceBlockIds, 12).filter((id) => allowedBlockIds.has(id)),
      }];
    }),
  ) as InterviewAnswerDimensions;
}

export function scoreFromDimensions(dimensions: InterviewAnswerDimensions) {
  const keys = Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[];
  return Math.round(
    keys.reduce(
      (total, key) => total + dimensions[key].score * REVIEW_DIMENSION_META[key].weight,
      0,
    ),
  );
}

export function normalizeInterviewAnswerReview(
  value: Record<string, unknown>,
  meta: { generatedAt: string; model: string },
  allowedBlockIds: Set<string>,
): InterviewAnswerReview {
  const rawBlocks = Array.isArray(value.blocks) ? value.blocks : [];
  const blocks = rawBlocks
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {}))
    .filter((item) => allowedBlockIds.has(text(item.blockId)))
    .map((item): InterviewAnswerBlockReview => ({
      blockId: text(item.blockId),
      questionTitle: text(item.questionTitle),
      interviewerIntentZh: text(item.interviewerIntentZh),
      askedPoints: texts(item.askedPoints),
      answeredPoints: texts(item.answeredPoints),
      missedPoints: texts(item.missedPoints),
      comprehension: oneOf(
        item.comprehension,
        ["clear", "partial", "likely_missed"] as const,
        "partial",
      ),
      relevance: oneOf(item.relevance, ["direct", "partial", "off_target"] as const, "partial"),
      quality: oneOf(item.quality, ["strong", "mixed", "weak", "neutral"] as const, "neutral"),
      strategyTags: texts(item.strategyTags, STRATEGY_TAGS.length).filter(
        (tag): tag is AnswerStrategyTag => STRATEGY_TAGS.includes(tag as AnswerStrategyTag),
      ),
      evidenceSentenceIds: texts(item.evidenceSentenceIds, 30).filter((id) => /^s\d+[a-z]?$/.test(id)),
      evaluationZh: text(item.evaluationZh),
      improvementZh: text(item.improvementZh),
      improvedAnswerJa: text(item.improvedAnswerJa),
    }));

  const dimensions = normalizeDimensions(value.dimensions, allowedBlockIds);
  return {
    generatedAt: meta.generatedAt,
    model: meta.model,
    overallScore: dimensions ? scoreFromDimensions(dimensions) : boundedScore(value.overallScore),
    dimensions,
    summaryZh: text(value.summaryZh),
    strengths: texts(value.strengths),
    weaknesses: texts(value.weaknesses),
    priorityBlockIds: texts(value.priorityBlockIds).filter((id) => allowedBlockIds.has(id)),
    blocks,
  };
}

export function parseInterviewAnswerReview(content: string): InterviewAnswerReview | null {
  const marker = content.indexOf(DATA_MARKER);
  if (marker < 0) return null;
  const json = content.slice(marker + DATA_MARKER.length).match(/```json\s*([\s\S]*?)\s*```/)?.[1];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as InterviewAnswerReview;
    // schema v1 の既存レポートには戦略タグが無い。Vault を再生成する前でも
    // Web が読めるよう、読み側だけで空配列を補う。
    return {
      ...parsed,
      blocks: Array.isArray(parsed.blocks)
        ? parsed.blocks.map((block) => ({
            ...block,
            strategyTags: Array.isArray(block.strategyTags) ? block.strategyTags : [],
          }))
        : [],
    };
  } catch {
    return null;
  }
}

function list(items: string[]) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- なし";
}

export function renderInterviewAnswerReview(
  review: InterviewAnswerReview,
  meta: { company: string; date: string; round: string; sourceName: string; annotationName: string },
) {
  const dimensionSection = review.dimensions
    ? `### 採点内訳（各20%）\n${(Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[])
        .map((key) => {
          const dimension = review.dimensions?.[key];
          return `- **${REVIEW_DIMENSION_META[key].label} ${dimension?.score ?? 0}**：${dimension?.rationaleZh ?? ""}（証拠: ${dimension?.evidenceBlockIds.join("・") || "なし"}）`;
        })
        .join("\n")}`
    : "";
  const blockSections = review.blocks
    .map(
      (block) => `## ${block.blockId} ${block.questionTitle}

- 理解度: ${block.comprehension}
- 回答適合: ${block.relevance}
- 評価: ${block.quality}
- 戦略タグ: ${block.strategyTags?.join(" / ") || "なし"}
- 面接官の意図: ${block.interviewerIntentZh}

### 聞かれた論点
${list(block.askedPoints)}

### 回答できた論点
${list(block.answeredPoints)}

### 漏れた論点
${list(block.missedPoints)}

### 評価

${block.evaluationZh}

### 改善方針

${block.improvementZh}

### 改善回答

${block.improvedAnswerJa || "（改善回答なし）"}`,
    )
    .join("\n\n");

  return `---
type: interview-answer-review
company: ${meta.company}
date: ${meta.date}
round: ${meta.round}
source_note: "[[${meta.sourceName}]]"
annotation_note: "[[${meta.annotationName}]]"
generated_at: ${review.generatedAt}
model: ${review.model}
layer: ai-derived
---
# ${meta.date} ${meta.company} 回答品質復盤

> 文法の採点ではなく、質問理解・論点網羅・回答の直接性・日本面接での戦略リスクを評価する AI 派生レポート。
> 元の整理稿と本人の裁定・批注が更新された場合は Web から再生成する。

## 全体評価

**${review.overallScore} / 100** — ${review.summaryZh}

${dimensionSection}

### 強み
${list(review.strengths)}

### 弱み
${list(review.weaknesses)}

${blockSections}

${DATA_MARKER}
\`\`\`json
${JSON.stringify(review, null, 2)}
\`\`\`
`;
}
