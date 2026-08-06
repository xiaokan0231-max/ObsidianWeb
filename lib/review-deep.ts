import {
  DEDUCTION_SEVERITY_BANDS,
  REVIEW_COMPREHENSION_VALUES,
  REVIEW_DIMENSION_WEIGHTS,
  REVIEW_LIMITS,
  REVIEW_QUALITY_VALUES,
  REVIEW_RELEVANCE_VALUES,
  REVIEW_STRATEGY_TAGS,
} from "./review-contract.mjs";

// 枚举本体不在这里，在 review-contract.mjs——那份同时被 codex-bridge 的 JSON schema
// 和 skill 的校验器读。在这里再写一遍联合类型，就等于多一个不会变红的副本。
export type AnswerComprehension = (typeof REVIEW_COMPREHENSION_VALUES)[number];
export type AnswerRelevance = (typeof REVIEW_RELEVANCE_VALUES)[number];
export type AnswerQuality = (typeof REVIEW_QUALITY_VALUES)[number];
export type AnswerStrategyTag = (typeof REVIEW_STRATEGY_TAGS)[number];

export type ReviewDimensionKey = keyof typeof REVIEW_DIMENSION_WEIGHTS;

/** 扣分档。档位决定分数带，所以「轻微」在任何一场都不可能扣掉 15 分。 */
export type ReviewDeductionSeverity = keyof typeof DEDUCTION_SEVERITY_BANDS;

// 分数带来自契约，label / hintZh 是只在界面出现的中文说明，留在这一层。
export const DEDUCTION_SEVERITY_META: Record<
  ReviewDeductionSeverity,
  { label: string; hintZh: string; min: number; max: number }
> = {
  major: { label: "失误", hintZh: "核心子问漏答・答非所问・明确的招聘风险表达", ...DEDUCTION_SEVERITY_BANDS.major },
  moderate: { label: "缺口", hintZh: "答到了但明显不完整，或要对方追问才对齐", ...DEDUCTION_SEVERITY_BANDS.moderate },
  minor: { label: "轻微", hintZh: "点状瑕疵，不改变面试官的判断", ...DEDUCTION_SEVERITY_BANDS.minor },
  opportunity: { label: "机会成本", hintZh: "没做错，但白白少赚一次加分", ...DEDUCTION_SEVERITY_BANDS.opportunity },
};

const DEDUCTION_SEVERITIES = Object.keys(
  DEDUCTION_SEVERITY_META,
) as ReviewDeductionSeverity[];

/** 一条可举证的扣分：扣在哪道题、扣几分、为什么、下次怎么不扣。 */
export type ReviewDeduction = {
  /** qNN。找不到对应块时留空，只失去跳转能力，分数照扣（否则会被静默抹平）。 */
  blockId: string;
  points: number;
  severity: ReviewDeductionSeverity;
  labelZh: string;
  detailZh: string;
  fixZh: string;
  evidenceSentenceIds: string[];
};

export type InterviewAnswerDimension = {
  score: number;
  rationaleZh: string;
  evidenceBlockIds: string[];
  /**
   * 扣分明细。schema v3 起必填（可以是空数组＝满分）。
   * 有它时 score 一律由 100 − Σpoints 推导，不采用模型自报的 score——
   * 「说不出扣在哪就扣不动分」，避免旧版那种理由全是好话、分数却只有 86 的幽灵扣分。
   */
  deductions?: ReviewDeduction[];
};

export type InterviewAnswerDimensions = Record<ReviewDimensionKey, InterviewAnswerDimension>;

// key 的写死顺序＝报告与界面的排列顺序，和契约里的顺序保持一致。
export const REVIEW_DIMENSION_META: Record<ReviewDimensionKey, { label: string; weight: number }> = {
  questionUnderstanding: { label: "问题理解", weight: REVIEW_DIMENSION_WEIGHTS.questionUnderstanding },
  coverage: { label: "覆盖完整度", weight: REVIEW_DIMENSION_WEIGHTS.coverage },
  directness: { label: "直接性", weight: REVIEW_DIMENSION_WEIGHTS.directness },
  evidenceCredibility: { label: "证据可信度", weight: REVIEW_DIMENSION_WEIGHTS.evidenceCredibility },
  riskControl: { label: "风险控制", weight: REVIEW_DIMENSION_WEIGHTS.riskControl },
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

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

// limit 必须显式标 number：契约里的上限是字面量类型，不标注会把参数窄成 12，
// 传 8 / 30 的调用点全部变成 TS2345。
function texts(value: unknown, limit: number = REVIEW_LIMITS.listItems) {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, limit) : [];
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function boundedScore(value: unknown) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function normalizeDeductions(
  value: unknown,
  sentencesByBlock: Map<string, Set<string>>,
): ReviewDeduction[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {}))
    .map((item): ReviewDeduction => {
      const severity = oneOf(item.severity, DEDUCTION_SEVERITIES, "moderate");
      const band = DEDUCTION_SEVERITY_META[severity];
      const detailZh = text(item.detailZh);
      const rawBlockId = text(item.blockId);
      const blockId = sentencesByBlock.has(rawBlockId) ? rawBlockId : "";
      // 別の設問の sNN を引いた証拠は落とす。残すと「証拠句」ボタンが
      // 関係ない質問へ飛び、扣分の根拠を確かめに行った人を騙すことになる。
      // 点数は残す：出典が一つ間違っていただけで減点自体が消えるのは行き過ぎ。
      const allowedSentences = sentencesByBlock.get(blockId);
      return {
        blockId,
        points: Math.min(band.max, Math.max(band.min, Math.round(Number(item.points) || 0))),
        severity,
        labelZh: text(item.labelZh) || detailZh.slice(0, 40),
        detailZh,
        fixZh: text(item.fixZh),
        evidenceSentenceIds: texts(item.evidenceSentenceIds, REVIEW_LIMITS.deductionEvidenceSentenceIds)
          .filter((id) => (allowedSentences ? allowedSentences.has(id) : false)),
      };
    })
    // 一句说明都没有的条目不是扣分，是黑箱：宁可不扣，也不能让分数被无法追查的项拿走。
    .filter((item) => item.labelZh)
    // 这行只是最后的兜底：prompt 已经把上限连同「合并同类项」一起告诉模型，
    // validate-review.mjs 也会对超额条数判错。这里仍然只能静默砍——砍掉扣分
    // 等于把这一维的分数调高，而砍完的结果依旧自洽，落盘后无从发现。
    // 所以别把防线寄托在这一行上。
    .slice(0, REVIEW_LIMITS.deductionsPerDimension);
}

function scoreFromDeductions(deductions: ReviewDeduction[]) {
  return Math.max(0, 100 - deductions.reduce((total, item) => total + item.points, 0));
}

function normalizeDimensions(
  value: unknown,
  sentencesByBlock: Map<string, Set<string>>,
): InterviewAnswerDimensions | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[];
  if (!keys.every((key) => source[key] && typeof source[key] === "object")) return undefined;
  return Object.fromEntries(
    keys.map((key) => {
      const item = source[key] as Record<string, unknown>;
      const hasLedger = Array.isArray(item.deductions);
      const deductions = normalizeDeductions(item.deductions, sentencesByBlock);
      return [key, {
        score: hasLedger ? scoreFromDeductions(deductions) : boundedScore(item.score),
        rationaleZh: text(item.rationaleZh),
        evidenceBlockIds: texts(item.evidenceBlockIds, REVIEW_LIMITS.dimensionEvidenceBlockIds).filter((id) => sentencesByBlock.has(id)),
        // 旧レポートでは键自体を生やさない：JSON 往復で消える undefined を持つと
        // 保存前後で形が変わり、round-trip の同一性が壊れる。
        ...(hasLedger ? { deductions } : {}),
      }];
    }),
  ) as InterviewAnswerDimensions;
}

function scoreFromDimensions(dimensions: InterviewAnswerDimensions) {
  const keys = Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[];
  return Math.round(
    keys.reduce(
      (total, key) => total + dimensions[key].score * REVIEW_DIMENSION_META[key].weight,
      0,
    ),
  );
}

/** schema v2 的旧报告只有分数和一段理由，没有扣分明细；界面要据此退回旧版渲染。 */
export function hasDeductionLedger(dimensions: InterviewAnswerDimensions | undefined) {
  if (!dimensions) return false;
  return (Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[]).some((key) =>
    Array.isArray(dimensions[key].deductions),
  );
}

export type FlatDeduction = ReviewDeduction & { dimension: ReviewDimensionKey };

/** 把五维的扣分摊平成一张「本场最贵的失误」排行，按分数降序。 */
export function allDeductions(dimensions: InterviewAnswerDimensions | undefined): FlatDeduction[] {
  if (!dimensions) return [];
  return (Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[])
    .flatMap((dimension) =>
      (dimensions[dimension].deductions ?? []).map((item) => ({ ...item, dimension })),
    )
    .sort((left, right) => right.points - left.points);
}

export function normalizeInterviewAnswerReview(
  value: Record<string, unknown>,
  meta: { generatedAt: string; model: string },
  /** qNN → その設問に属する sNN。証拠が別の設問へ飛ぶのをここで止める。 */
  sentencesByBlock: Map<string, Set<string>>,
): InterviewAnswerReview {
  const rawBlocks = Array.isArray(value.blocks) ? value.blocks : [];
  const blocks = rawBlocks
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {}))
    .filter((item) => sentencesByBlock.has(text(item.blockId)))
    .map((item): InterviewAnswerBlockReview => ({
      blockId: text(item.blockId),
      questionTitle: text(item.questionTitle),
      interviewerIntentZh: text(item.interviewerIntentZh),
      askedPoints: texts(item.askedPoints),
      answeredPoints: texts(item.answeredPoints),
      missedPoints: texts(item.missedPoints),
      comprehension: oneOf(item.comprehension, REVIEW_COMPREHENSION_VALUES, "partial"),
      relevance: oneOf(item.relevance, REVIEW_RELEVANCE_VALUES, "partial"),
      quality: oneOf(item.quality, REVIEW_QUALITY_VALUES, "neutral"),
      strategyTags: texts(item.strategyTags, REVIEW_STRATEGY_TAGS.length).filter(
        (tag): tag is AnswerStrategyTag => REVIEW_STRATEGY_TAGS.includes(tag as AnswerStrategyTag),
      ),
      evidenceSentenceIds: texts(item.evidenceSentenceIds, REVIEW_LIMITS.blockEvidenceSentenceIds)
        .filter((id) => /^s\d+[a-z]?$/.test(id)),
      evaluationZh: text(item.evaluationZh),
      improvementZh: text(item.improvementZh),
      improvedAnswerJa: text(item.improvedAnswerJa),
    }));

  const dimensions = normalizeDimensions(value.dimensions, sentencesByBlock);
  return {
    generatedAt: meta.generatedAt,
    model: meta.model,
    overallScore: dimensions ? scoreFromDimensions(dimensions) : boundedScore(value.overallScore),
    dimensions,
    summaryZh: text(value.summaryZh),
    strengths: texts(value.strengths),
    weaknesses: texts(value.weaknesses),
    // 上限现在只在 review-contract.mjs 定义一次。曾经这里用的是默认值 12、skill 侧写 8，
    // 模型多返回的块原样写进 Vault，等到事后跑 validate-review.mjs 才报错——那时已经落盘了。
    priorityBlockIds: texts(value.priorityBlockIds, REVIEW_LIMITS.priorityBlockIds)
      .filter((id) => sentencesByBlock.has(id)),
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

/** レンダラが必ず書き直す見出し。ここに無い節は「機械が作れないもの」として扱う。 */
const RENDERED_HEADINGS = new Set([
  "全体評価",
  "採点内訳（各20%）",
  "強み",
  "弱み",
]);

/**
 * 前回の本文から、レンダラが再現できない節だけを取り出す。
 *
 * この関数が無かったせいで、Web からの再生成が Vault モードのスキルや人が書いた
 * 「次回面接で主に伝えること」「旧復盤から修正すべき点」を黙って消した。
 * 再生成は派生値を作り直す操作であって、作り直せないものを捨てる権利は無い。
 * qNN 節は JSON から必ず再生成されるので対象外。
 */
export function carryOverSections(previousContent: string) {
  if (!previousContent) return "";
  const body = previousContent.split(DATA_MARKER)[0];
  const sections: string[] = [];
  // 見出し行で切って、qNN 節に入ったら打ち切る（そこから先は全部再生成対象）。
  const parts = body.split(/^(#{2,3} .*)$/m);
  for (let index = 1; index < parts.length; index += 2) {
    const heading = parts[index].replace(/^#{2,3} /, "").trim();
    if (/^q\d+\b/.test(heading)) break;
    if (RENDERED_HEADINGS.has(heading)) continue;
    sections.push(`${parts[index]}\n${parts[index + 1] ?? ""}`.trimEnd());
  }
  return sections.join("\n\n");
}

export function renderInterviewAnswerReview(
  review: InterviewAnswerReview,
  meta: {
    company: string;
    date: string;
    round: string;
    sourceName: string;
    /** 批注ノートが実在する時だけ渡す。無いのにリンクを書くと vault:check が壊れリンクとして弾く。 */
    annotationName: string | null;
    /** 回答品質批注（本人の同意・反対・補足）。同じく実在する時だけ。 */
    feedbackName?: string | null;
    /** carryOverSections() の戻り値。前回本文のうち機械が再現できない節。 */
    carriedSections?: string;
  },
) {
  const dimensionSection = review.dimensions
    ? `### 採点内訳（各20%）\n\n${(Object.keys(REVIEW_DIMENSION_META) as ReviewDimensionKey[])
        .map((key) => {
          const dimension = review.dimensions?.[key];
          const label = REVIEW_DIMENSION_META[key].label;
          const head = `- **${label} ${dimension?.score ?? 0}**：${dimension?.rationaleZh ?? ""}（証拠: ${dimension?.evidenceBlockIds.join("・") || "なし"}）`;
          const deductions = dimension?.deductions;
          if (!deductions) return head;
          if (!deductions.length) return `${head}\n  - 減点なし（100）`;
          // 算式を書いておく：数字と説明が別々に育って食い違うのを防ぐ。
          const formula = `100 ${deductions.map((item) => `− ${item.points}`).join(" ")} = ${dimension?.score ?? 0}`;
          const rows = deductions
            .map((item) =>
              `  - **−${item.points}**（${DEDUCTION_SEVERITY_META[item.severity].label}）${item.blockId ? `${item.blockId} ` : ""}${item.labelZh}\n` +
              `    - 何が起きたか：${item.detailZh || "—"}\n` +
              `    - 次はこうする：${item.fixZh || "—"}\n` +
              `    - 証拠：${item.evidenceSentenceIds.join("・") || "なし"}`,
            )
            .join("\n");
          return `${head}\n  - 内訳：${formula}\n${rows}`;
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
${meta.annotationName ? `annotation_note: "[[${meta.annotationName}]]"\n` : ""}${meta.feedbackName ? `feedback_note: "[[${meta.feedbackName}]]"\n` : ""}generated_at: ${review.generatedAt}
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
${meta.carriedSections ? `\n${meta.carriedSections}\n` : ""}
${blockSections}

${DATA_MARKER}
\`\`\`json
${JSON.stringify(review, null, 2)}
\`\`\`
`;
}
