// 评分契约的单一事实源。
//
// 同一组枚举和上限，代码侧有三个消费者：
//   1. lib/review-deep.ts       ——正本 JSON 的规范化与渲染（Web / Vault）
//   2. scripts/codex-bridge.mjs ——发给 Codex 的 output schema 与 prompt
//   3. .agents/skills/review-interview-answers/scripts/review-contract.mjs
//      ——本文件的逐字副本。skill 不 import 仓库外的文件，否则被单独拷走时校验器
//        连启动都做不到；两份同值由 tests/review-contract.test.mjs 保证。
//
// 为什么要单独一份：三处手写时，改一处别处不会变红。priorityBlockIds 就这样
// 在正本侧留着默认的 12、skill 侧写着 8，模型多返回的块先写进 Vault，
// 事后跑校验器才报错——那时笔记已经落盘了。
//
// references/*.md 是给人和 AI 读的散文契约，不从这里生成；
// 冲突时以代码为准（SKILL.md 已声明）。
//
// 用 .mjs 而不是 .ts：node 脚本要能直接 import。TS 侧靠 JSDoc 的 const 断言
// 拿到字面量联合类型，所以每个 /** @type {const} */ 都不能省。

/** 战略标签。数组顺序＝对外展示顺序，别随手重排。 */
export const REVIEW_STRATEGY_TAGS = /** @type {const} */ ([
  "compound-question-miss",
  "no-conclusion-first",
  "negative-oversharing",
  "weak-evidence",
  "over-absolute",
  "role-mismatch",
  "numbers-confusion",
]);

export const REVIEW_COMPREHENSION_VALUES = /** @type {const} */ ([
  "clear",
  "partial",
  "likely_missed",
]);

export const REVIEW_RELEVANCE_VALUES = /** @type {const} */ ([
  "direct",
  "partial",
  "off_target",
]);

export const REVIEW_QUALITY_VALUES = /** @type {const} */ ([
  "strong",
  "mixed",
  "weak",
  "neutral",
]);

/**
 * 五维的 key 与权重。key 的顺序决定报告、界面和 schema 里的排列顺序。
 * 等权是校验器把总分算成算术平均的前提——一旦不等权，那边的平均值
 * 就不再等于正本的加权分，而且两边都不会报错。
 */
export const REVIEW_DIMENSION_WEIGHTS = /** @type {const} */ ({
  questionUnderstanding: 0.2,
  coverage: 0.2,
  directness: 0.2,
  evidenceCredibility: 0.2,
  riskControl: 0.2,
});

/** 扣分档与分数区间。档位决定分数带，所以「轻微」在任何一场都不可能扣掉 15 分。 */
export const DEDUCTION_SEVERITY_BANDS = /** @type {const} */ ({
  major: { min: 10, max: 25 },
  moderate: { min: 5, max: 9 },
  minor: { min: 2, max: 4 },
  opportunity: { min: 1, max: 3 },
});

export const REVIEW_LIMITS = /** @type {const} */ ({
  /** 三方共同的契约值：prompt 这样要求、正本按它截断、校验器按它判错。 */
  priorityBlockIds: 8,
  /**
   * 同样是三方共管，区别在于正本的截断是静默的：砍掉扣分＝这一维分数被抬高，
   * 而砍完的 JSON 仍满足 score = 100 − Σ(剩下的扣分)，落盘后再也看不出来。
   * 所以真正的防线是 prompt 里的「合并同类项」和校验器的条数检查，不是那次截断。
   */
  deductionsPerDimension: 12,
  // 以下只是正本侧的防御性截断，写在这里是为了不再散成魔数，不是对外承诺。
  deductionEvidenceSentenceIds: 8,
  dimensionEvidenceBlockIds: 12,
  blockEvidenceSentenceIds: 30,
  listItems: 12,
});
