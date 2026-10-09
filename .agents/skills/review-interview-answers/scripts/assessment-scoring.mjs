// 数字只表达本次有据表现，不是能力百分位；基准与事件由语义评审举证，计算不得补证。
export const ASSESSMENT_METHOD_VERSION = "2026-10-v3";
export const ASSESSMENT_DIMENSIONS = /** @type {const} */ (["questionUnderstanding", "coverage", "directness", "evidenceCredibility", "riskControl"]);
export const ASSESSMENT_BASES = /** @type {const} */ ([75, 85, 95]);
export const ASSESSMENT_EVENT_POINTS = /** @type {const} */ ({ major: 25, moderate: 5, minor: 2 });
export const ASSESSMENT_DIMENSION_LABELS = /** @type {const} */ ({ questionUnderstanding: "问题理解", coverage: "覆盖完整度", directness: "直接性", evidenceCredibility: "证据可信度", riskControl: "风险控制" });

/** 不依据修复标签猜损失：成功澄清无残余以0明记，有真实残余仍按已举证事件档扣。 */
export function computeAssessmentScores(review) {
  const dimensions = {};
  let unresolvedMajor = false;
  for (const key of ASSESSMENT_DIMENSIONS) {
    const dimension = review?.dimensions?.[key];
    if (!dimension) continue;
    const major = (dimension.deductions ?? []).some(item => item.severity === "major" && item.recovery === "unresolved");
    unresolvedMajor ||= major;
    const assessed = dimension.level !== "not_assessed" && ASSESSMENT_BASES.includes(dimension.baseScore);
    const lost = (dimension.deductions ?? []).reduce((sum, item) => sum + (Number.isFinite(item.points) ? item.points : 0), 0);
    const score = assessed ? Math.max(0, Math.min(major ? 50 : 100, dimension.baseScore - lost)) : null;
    dimensions[key] = { ...dimension, score };
  }
  const assessedDimensions = ASSESSMENT_DIMENSIONS.filter(key => typeof dimensions[key]?.score === "number");
  const eligible = review?.evaluation?.scoringEligible === true
    && review?.evaluation?.materialScope === "full_available_text"
    && assessedDimensions.length >= 3
    && assessedDimensions.includes("coverage") && assessedDimensions.includes("directness");
  const rawMean = eligible ? assessedDimensions.reduce((sum, key) => sum + dimensions[key].score, 0) / assessedDimensions.length : null;
  const roundedMean = rawMean === null ? null : Math.round(rawMean / 5) * 5;
  const cap = eligible && unresolvedMajor ? 60 : null;
  const overallScore = roundedMean === null ? null : Math.min(roundedMean, cap ?? 100);
  const dimensionFormula = assessedDimensions.map(key => {
    const d = dimensions[key];
    const deductions = (d.deductions ?? []).map(item => `−${item.points}`).join(" ");
    const capped = (d.deductions ?? []).some(item => item.severity === "major" && item.recovery === "unresolved");
    return `${ASSESSMENT_DIMENSION_LABELS[key]}: ${d.baseScore} ${deductions}${capped ? "，未恢复关键缺口维度上限50" : ""} → ${d.score}`;
  }).join("；");
  const overallFormula = eligible
    ? `仅${assessedDimensions.length}个已评维平均≈${Number(rawMean.toFixed(1))}，取最近5分=${roundedMean}${cap !== null ? "，未恢复关键缺口总分上限60" : ""} → ${overallScore}`
    : "不提供总分：须资料完整、明确允许评分、至少3个已评维且覆盖/直接性可评；未评维不进入平均";
  return { dimensions, overallScore, scoring: {
    methodVersion: ASSESSMENT_METHOD_VERSION, assessedDimensions, rawMean, roundedMean, cap,
    formulaZh: `${dimensionFormula ? `${dimensionFormula}。` : "没有可评维。"}${overallFormula}。上限是规范性门槛，不是同事件再次扣分；75为标准参考线，不证明优秀。`,
  } };
}
