import { ASSESSMENT_BASES, ASSESSMENT_DIMENSIONS, computeAssessmentScores } from "./assessment-scoring.mjs";
import { REVIEW_LIMITS } from "./review-contract.mjs";

// 新方法只验证能机械判断的账本约束；语义诊断必须另做完整问答盲评。
export function diagnosticLedgerErrors(review) {
  const errors = [];
  const anchors = { major: 25, moderate: 5, minor: 2 };
  const events = new Map();
  for (const [dimension, value] of Object.entries(review?.dimensions ?? {})) {
    for (const [index, deduction] of (value.deductions ?? []).entries()) {
      const location = `dimensions.${dimension}.deductions[${index}]`;
      const restoredWithoutLoss = review.evaluationMode === "scored_evidence" && deduction.recovery === "repaired" && deduction.points === 0;
      if (!(deduction.severity in anchors) || !restoredWithoutLoss && deduction.points !== anchors[deduction.severity]) {
        errors.push(`${location}: requires major=25, moderate=5, minor=2; only repaired without residual loss may use 0; opportunities are not errors`);
      }
      // 同文同标签的跨维复制才可确定重复，其他同题独立事件不在此猜测。
      const key = JSON.stringify([deduction.blockId, [...(deduction.evidenceSentenceIds ?? [])].sort(), ...(review.evaluationMode === "scored_evidence" ? [] : [deduction.labelZh?.trim()])]);
      if (events.has(key)) errors.push(`${location}: duplicates event already charged at ${events.get(key)}`);
      else events.set(key, location);
    }
  }
  return errors;
}


// 非数值评价同样必须有据；空事件或未问不能被判为已展示。
export function evidenceEvaluationErrors(review) {
  const errors = [];
  if (typeof review?.overallScore === "number") errors.push("new evaluation cannot include a numeric overall score");
  if (review?.evaluationMode !== "evidence") errors.push("evaluationMode must be evidence");
  for (const key of ["conclusionZh", "coverageZh", "limitsZh"]) {
    if (!review?.evaluation?.[key]?.trim()) errors.push(`evaluation.${key} is required`);
  }
  for (const [key, value] of Object.entries(review?.dimensions ?? {})) {
    if (typeof value.score === "number") errors.push(`${key}: new evaluation cannot include a numeric dimension score`);
    if (!["supported", "partial", "core_gap", "not_assessed"].includes(value.level)) errors.push(`${key}.level is invalid`);
    if (value.level !== "not_assessed" && !value.evidenceBlockIds?.length) errors.push(`${key}: assessed level requires evidence`);
    for (const item of value.deductions ?? []) {
      if (!["unresolved", "partial", "repaired", "unknown"].includes(item.recovery)) errors.push(`${key}: event recovery is required`);
      if (item.severity === "major" && item.recovery === "unresolved" && value.level !== "core_gap") errors.push(`${key}: unresolved major cannot be softened by other answers`);
    }
    if (value.level === "core_gap" && !(value.deductions ?? []).some(i => i.severity === "major" && i.recovery === "unresolved")) errors.push(`${key}: core_gap needs an unresolved major event`);
  }
  return errors;
}

/**
 * 模型不得自报派生数字；持久报告须逐字段重算，正证质量另由完整问答语义审核。
 * @param {object} review
 * @param {{sourceBlockIds?: Iterable<string>, sentencesByBlock?: Map<string, Set<string>>, allowComputedScores?: boolean}} options
 */
export function scoredEvidenceErrors(review, { sourceBlockIds, sentencesByBlock, allowComputedScores = false } = {}) {
  const errors = [];
  if (review?.evaluationMode !== "scored_evidence") errors.push("evaluationMode must be scored_evidence");
  if (!allowComputedScores && (Object.hasOwn(review ?? {}, "overallScore") || Object.hasOwn(review ?? {}, "scoring"))) errors.push("model must not self-report overallScore or scoring numbers");
  for (const key of ["conclusionZh", "coverageZh", "limitsZh", "eligibilityZh"]) {
    if (typeof review?.evaluation?.[key] !== "string" || !review.evaluation[key].trim()) errors.push(`evaluation.${key} is required`);
  }
  if (typeof review?.evaluation?.scoringEligible !== "boolean") errors.push("evaluation.scoringEligible must be boolean");
  if (!["full_available_text", "limited"].includes(review?.evaluation?.materialScope)) errors.push("evaluation.materialScope is invalid");
  const source = sourceBlockIds ? new Set(sourceBlockIds) : new Set((review?.blocks ?? []).map(block => block.blockId));
  const dimensions = review?.dimensions;
  if (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions)) {
    if (review?.evaluation?.materialScope !== "limited" || review?.evaluation?.scoringEligible !== false) errors.push("full scoring requires five dimensions");
  } else for (const key of ASSESSMENT_DIMENSIONS) {
    const value = dimensions[key];
    if (!value || typeof value !== "object") { errors.push(`${key}: dimension is required`); continue; }
    if (!allowComputedScores && Object.hasOwn(value, "score")) errors.push(`${key}: model must not self-report dimension score`);
    if (!["supported", "partial", "core_gap", "not_assessed"].includes(value.level)) errors.push(`${key}.level is invalid`);
    if (typeof value.basisZh !== "string" || !value.basisZh.trim()) errors.push(`${key}.basisZh is required`);
    if (typeof value.rationaleZh !== "string" || !value.rationaleZh.trim()) errors.push(`${key}.rationaleZh is required`);
    if (!Array.isArray(value.evidenceBlockIds) || value.evidenceBlockIds.some(id => typeof id !== "string")) errors.push(`${key}.evidenceBlockIds must be a string array`);
    if (!Array.isArray(value.positiveEvidenceBlockIds) || value.positiveEvidenceBlockIds.some(id => typeof id !== "string")) errors.push(`${key}.positiveEvidenceBlockIds must be a string array`);
    const positives = Array.isArray(value.positiveEvidenceBlockIds) ? value.positiveEvidenceBlockIds : [];
    const cited = Array.isArray(value.evidenceBlockIds) ? value.evidenceBlockIds : [];
    if (new Set(positives).size !== positives.length) errors.push(`${key}: positive q must be independent, not repeated`);
    for (const id of [...cited, ...positives]) if (!source.has(id)) errors.push(`${key}: unknown source q ${id}`);
    for (const id of positives) if (!cited.includes(id)) errors.push(`${key}: positive q ${id} must appear in evidenceBlockIds`);
    if (value.level === "not_assessed") {
      if (value.baseScore !== null) errors.push(`${key}: not_assessed must have null baseScore`);
      if (positives.length || (value.deductions ?? []).some(item => item.points > 0)) errors.push(`${key}: unassessed dimension cannot claim positive scoring or loss`);
    } else {
      if (!ASSESSMENT_BASES.includes(value.baseScore)) errors.push(`${key}.baseScore must be 75, 85 or 95`);
      if (!cited.length) errors.push(`${key}: assessed level requires source evidence`);
      if ((value.baseScore === 85 || value.baseScore === 95) && new Set(positives).size < 2) errors.push(`${key}: baseScore ${value.baseScore} requires two independent positive source q`);
    }
    if (!Array.isArray(value.deductions)) { errors.push(`${key}.deductions must be an array`); continue; }
    if (value.deductions.length > REVIEW_LIMITS.deductionsPerDimension) errors.push(`${key}: deduction ledger exceeds ${REVIEW_LIMITS.deductionsPerDimension} events; cannot silently truncate`);
    for (const item of value.deductions) {
      if (!["unresolved", "partial", "repaired", "unknown"].includes(item.recovery)) errors.push(`${key}: event recovery is required`);
      if (item.recovery === "repaired" && (!item.detailZh?.trim())) errors.push(`${key}: repaired event must state whether residual loss remains in detailZh`);
      if (item.severity === "major" && item.recovery === "unresolved" && value.level !== "core_gap") errors.push(`${key}: unresolved major cannot be softened by other answers`);
      if (!source.has(item.blockId)) errors.push(`${key}: event cites unknown source q ${item.blockId}`);
      for (const field of ["labelZh", "detailZh", "fixZh"]) if (typeof item[field] !== "string" || !item[field].trim()) errors.push(`${key}: event ${field} is required`);
      if (!Array.isArray(item.evidenceSentenceIds) || !item.evidenceSentenceIds.length || item.evidenceSentenceIds.some(id => typeof id !== "string")) errors.push(`${key}: event requires sentence evidence`);
      if (sentencesByBlock) for (const id of item.evidenceSentenceIds ?? []) if (!sentencesByBlock.get(item.blockId)?.has(id)) errors.push(`${key}: event sentence ${id} does not belong to ${item.blockId}`);
    }
    if (value.level === "core_gap" && !value.deductions.some(item => item.severity === "major" && item.recovery === "unresolved")) errors.push(`${key}: core_gap needs an unresolved major event`);
  }
  errors.push(...diagnosticLedgerErrors(review));
  const computed = computeAssessmentScores(review);
  if (review?.evaluation?.scoringEligible === true && (review.evaluation.materialScope !== "full_available_text" || computed.scoring.assessedDimensions.length < 3 || !computed.scoring.assessedDimensions.includes("coverage") || !computed.scoring.assessedDimensions.includes("directness"))) errors.push("scoringEligible conflicts with material or assessed-dimension gates");
  if (allowComputedScores) {
    if (review?.overallScore !== computed.overallScore) errors.push("overallScore does not equal server formula");
    for (const key of ASSESSMENT_DIMENSIONS) if (dimensions?.[key] && dimensions[key].score !== computed.dimensions[key]?.score) errors.push(`${key}.score does not equal base minus anchored events / cap`);
    for (const key of ["methodVersion", "assessedDimensions", "rawMean", "roundedMean", "cap", "formulaZh"]) if (JSON.stringify(review?.scoring?.[key]) !== JSON.stringify(computed.scoring[key])) errors.push(`scoring.${key} does not equal server formula`);
  }
  return errors;
}
