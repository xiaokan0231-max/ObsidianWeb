// Bridge と正本の分類を共用し、モデルにだけ存在する段階・モジュールを作らない。
export const ADVISORY_STAGES = /** @type {const} */ (["agency", "matching", "technical", "final", "other"]);
export const INSIGHT_MODULE_KEYS = /** @type {const} */ (["employerPriorities", "positioning", "effectiveAnswers", "opportunities", "nextStage"]);

const text = { type: "string" };
const array = (items) => ({ type: "array", items });
const object = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const evidence = array(object({ sourcePath: text, blockId: text, sentenceIds: array(text) }));
const references = { evidence, contextPaths: array(text) };

export const ADVISORY_OUTPUT_SCHEMA = object({
  stage: { type: "string", enum: ADVISORY_STAGES },
  commentaryZh: text,
  fitZh: text,
  recommendationZh: text,
  changeConditionsZh: text,
  ...references,
  observations: array(object({
    id: text, titleZh: text, observationZh: text, interpretationZh: text,
    alternativeZh: text, implicationZh: text, ...references,
  })),
  answerOptions: array(object({
    id: text, titleZh: text, situationZh: text, whyZh: text, answerJa: text,
    scope: { type: "string", enum: ["general", "company"] }, ...references,
  })),
  nextSteps: array(object({
    id: text, titleZh: text, detailZh: text, triggerZh: text, ...references,
  })),
});

export const INSIGHTS_OUTPUT_SCHEMA = object({
  overviewZh: text,
  modules: array(object({
    key: { type: "string", enum: INSIGHT_MODULE_KEYS },
    titleZh: text,
    commentaryZh: text,
    findings: array(object({
      id: text, titleZh: text, bodyZh: text, boundaryZh: text, ...references,
    })),
  })),
});
