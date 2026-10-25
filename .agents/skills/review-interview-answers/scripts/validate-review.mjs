#!/usr/bin/env node

import { diagnosticLedgerErrors, evidenceEvaluationErrors, scoredEvidenceErrors } from "./diagnostic-checks.mjs";
import { computeAssessmentScores } from "./assessment-scoring.mjs";
import { JAPAN_SIGNALS_VERSION, japanSignalErrors, japanSignalWarnings } from "./japan-interview-signals.mjs";

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateInterviewAdvisory, validateInterviewInsights } from "./interview-advisory.ts";

// 契約値は skill の中に閉じた ./review-contract.mjs から取る。
// リポジトリ外（../../../lib/…）を参照すると、skill だけ別の場所へコピーして
// 走らせた時に import が解決できず、校验器そのものが起動しなくなる。
// lib/review-contract.mjs との同値は tests/review-contract.test.mjs が見ている。
import {
  DEDUCTION_SEVERITY_BANDS,
  REVIEW_COMPREHENSION_VALUES,
  REVIEW_DIMENSION_WEIGHTS,
  REVIEW_LIMITS,
  REVIEW_QUALITY_VALUES,
  REVIEW_RELEVANCE_VALUES,
  REVIEW_STRATEGY_TAGS,
} from "./review-contract.mjs";

// 等重みであることが、下で総分を単純平均にしている前提。
// REVIEW_DIMENSION_WEIGHTS が等重みでなくなったら、この平均は正本側の加重平均と
// 一致しなくなる——しかもどちらもエラーを出さない。
const DIMENSIONS = Object.keys(REVIEW_DIMENSION_WEIGHTS);
const TAGS = new Set(REVIEW_STRATEGY_TAGS);
const COMPREHENSION = new Set(REVIEW_COMPREHENSION_VALUES);
const RELEVANCE = new Set(REVIEW_RELEVANCE_VALUES);
const QUALITY = new Set(REVIEW_QUALITY_VALUES);

function usage() {
  console.error("Usage: node validate-review.mjs --review <review.md|review.json|-> [--source <整理稿.md>] [--vault <vault root>] [--method v2|v3] [--require-signals]");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    // 旧报告没有日本面试信号是正常的；新生成或本人要求重评的场次才必须带，由调用方显式声明。
    if (key === "--require-signals") {
      args.requireSignals = true;
      continue;
    }
    if (key !== "--review" && key !== "--source" && key !== "--vault" && key !== "--method") throw new Error(`Unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  if (args.method && !["v2", "v3"].includes(args.method)) throw new Error("--method must be v2 or v3");
  return args;
}

async function readInput(path) {
  if (path !== "-") return readFile(path, "utf8");
  let content = "";
  for await (const chunk of process.stdin) content += chunk;
  return content;
}

function parseReview(content) {
  const marker = content.includes("<!-- interview-insights-data -->")
    ? "<!-- interview-insights-data -->" : "<!-- interview-answer-review-data -->";
  const tail = content.includes(marker) ? content.slice(content.indexOf(marker) + marker.length) : content;
  const fenced = tail.match(/```json\s*([\s\S]*?)\s*```/i)?.[1];
  return JSON.parse((fenced ?? tail).trim());
}

function parseSource(content) {
  const questions = new Map();
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    const question = line.match(/^##\s+(q\d+)\b/);
    if (question) {
      current = question[1];
      if (!questions.has(current)) questions.set(current, new Set());
      continue;
    }
    const sentence = line.match(/^\s*-\s+\*\*(s\d+[a-z]?)｜/i);
    if (current && sentence) questions.get(current).add(sentence[1]);
  }
  return questions;
}

/**
 * 日本面试信号要核话者与记忆重构。只认整理稿里已确定的话者（「私?」「面?」待裁定的不算任何一方），
 * 免得校验器在看不到批注的情况下替本人裁定话者。
 */
function parseSourceSignalsContext(content) {
  const speakers = new Map();
  for (const line of content.split(/\r?\n/)) {
    const sentence = line.match(/^\s*-\s+\*\*(s\d+[a-z]?)｜(私|面)(\?|？)?\*\*/i);
    if (sentence && !sentence[3]) speakers.set(sentence[1], sentence[2]);
  }
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const reconstructed = /^reconstruction:\s*["']?memory["']?\s*$/m.test(frontmatter) || /^verbatim:\s*false\s*$/m.test(frontmatter);
  return { speakers, reconstructed };
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

async function advisoryContext(value, args) {
  const sourcePaths = new Set();
  const contextPaths = new Set();
  const collect = (item) => {
    if (!item || typeof item !== "object") return;
    for (const ref of item.evidence ?? []) sourcePaths.add(ref.sourcePath);
    for (const path of item.contextPaths ?? []) contextPaths.add(path);
  };
  collect(value);
  for (const key of ["observations", "answerOptions", "nextSteps"]) {
    for (const item of value[key] ?? []) collect(item);
  }
  for (const section of value.modules ?? []) {
    for (const item of section.findings ?? []) collect(item);
  }
  const sources = new Map();
  for (const path of sourcePaths) {
    let localPath;
    if (args.vault) localPath = join(resolve(args.vault), path);
    else if (args.source && resolve(args.source).endsWith(`/${path}`)) localPath = args.source;
    else throw new Error(`顾问证据 ${path} 需要 --vault，或对应完整路径的 --source。`);
    sources.set(path, parseSource(await readFile(localPath, "utf8")));
  }
  for (const path of contextPaths) {
    if (!args.vault) throw new Error("顾问背景引用需要 --vault 才能验证。");
    await readFile(join(resolve(args.vault), path), "utf8");
  }
  return { sources, contextPaths };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    throw error;
  }
  if (!args.review) {
    usage();
    process.exitCode = 2;
    return;
  }

  const review = parseReview(await readInput(args.review));
  const sourceContent = args.source ? await readFile(args.source, "utf8") : null;
  const sourceQuestions = sourceContent === null ? null : parseSource(sourceContent);
  const errors = [];
  const warnings = [];
  const fail = (message) => errors.push(message);

  // 顾问与横向洞察不参与五维评分；它们各自严格验证证据，不能冒充零扣分报告。
  const isInsights = review && Array.isArray(review.modules);
  const isAdvisory = review && Array.isArray(review.observations);
  const advisory = isAdvisory ? review : review?.advisory;
  if (isInsights || advisory) {
    const value = isInsights ? review : advisory;
    const validate = isInsights ? validateInterviewInsights : validateInterviewAdvisory;
    try {
      // 先校验路径格式，再用路径读文件，避免坏引用越过 Vault 边界。
      validate(value);
      validate(value, await advisoryContext(value, args));
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
  if (isInsights || isAdvisory) {
    console.log(JSON.stringify({ ok: errors.length === 0, kind: isInsights ? "interview-insights" : "interview-advisory", errors, warnings }, null, 2));
    if (errors.length) process.exitCode = 1;
    return;
  }

  if (!review || typeof review !== "object" || Array.isArray(review)) {
    fail("review must be a JSON object");
  }

  const evidenceMode = review?.evaluationMode === "evidence";
  const scoredMode = review?.evaluationMode === "scored_evidence";
  if (args.method === "v3" && !scoredMode) fail("--method v3 requires scored_evidence");
  if (args.method === "v2" && scoredMode) fail("--method v2 cannot validate a v3 scoring report");
  if (evidenceMode) errors.push(...evidenceEvaluationErrors(review));
  if (scoredMode) errors.push(...scoredEvidenceErrors(review, { sourceBlockIds: sourceQuestions?.keys(), sentencesByBlock: sourceQuestions, allowComputedScores: true }));
  const dimensionScores = [];
  const deductionRefs = [];
  for (const key of scoredMode && review?.evaluation?.materialScope === "limited" && !review.dimensions ? [] : DIMENSIONS) {
    const item = review?.dimensions?.[key];
    if (!item || typeof item !== "object") {
      fail(`dimensions.${key} is missing`);
      continue;
    }
    if (!evidenceMode && !scoredMode && (typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < 0 || item.score > 100)) {
      fail(`dimensions.${key}.score must be a number from 0 to 100`);
    } else if (!evidenceMode && !scoredMode) {
      dimensionScores.push(item.score);
    }
    if (typeof item.rationaleZh !== "string" || !item.rationaleZh.trim()) {
      fail(`dimensions.${key}.rationaleZh is empty`);
    }
    if (!isStringArray(item.evidenceBlockIds) || ((!evidenceMode && !scoredMode) || item.level !== "not_assessed") && item.evidenceBlockIds.length === 0) {
      fail(`dimensions.${key}.evidenceBlockIds must contain qNN evidence`);
    }

    // schema v2 の旧レポートには deductions が無い。あるときだけ厳格に検査する。
    if (item.deductions === undefined) {
      warnings.push(`dimensions.${key} has no deduction ledger (schema v2 report; regenerate to get one)`);
      continue;
    }
    if (!Array.isArray(item.deductions)) {
      fail(`dimensions.${key}.deductions must be an array`);
      continue;
    }
    // 上限を超えた分は正本側（lib/review-deep.ts）で黙って切り捨てられ、
    // 切られた扣分のぶんだけ維度分が上がる。しかも切られた後の JSON は
    // score = 100 − Σ(残った扣分) で完全に自洽するので、落ちた後からは気づけない。
    // だから手書き稿・正規化前の JSON がここを通る時点で赤くする。
    if (item.deductions.length > REVIEW_LIMITS.deductionsPerDimension) {
      fail(
        `dimensions.${key}.deductions has ${item.deductions.length} entries, `
          + `more than the ${REVIEW_LIMITS.deductionsPerDimension} allowed (merge duplicates instead of listing them)`,
      );
    }
    let lost = 0;
    for (const [index, entry] of item.deductions.entries()) {
      const prefix = `dimensions.${key}.deductions[${index}]`;
      if (!entry || typeof entry !== "object") {
        fail(`${prefix} must be an object`);
        continue;
      }
      const band = DEDUCTION_SEVERITY_BANDS[entry.severity];
      if (!band) {
        fail(`${prefix}.severity is invalid: ${entry.severity}`);
      }
      if (typeof entry.points !== "number" || !Number.isInteger(entry.points)) {
        fail(`${prefix}.points must be an integer`);
      } else {
        lost += entry.points;
        if (band && !(scoredMode && entry.recovery === "repaired" && entry.points === 0) && (entry.points < band.min || entry.points > band.max)) {
          fail(`${prefix}.points ${entry.points} is outside the ${entry.severity} band ${band.min}–${band.max}`);
        }
      }
      // 扣分点が「どこで何点」を言えないと、この契約の目的そのものが失われる。
      for (const field of ["labelZh", "detailZh", "fixZh"]) {
        if (typeof entry[field] !== "string" || !entry[field].trim()) {
          fail(`${prefix}.${field} is empty`);
        }
      }
      if (typeof entry.blockId !== "string" || !/^q\d+$/.test(entry.blockId)) {
        fail(`${prefix}.blockId must be qNN`);
      }
      if (!isStringArray(entry.evidenceSentenceIds) || entry.evidenceSentenceIds.length === 0) {
        fail(`${prefix}.evidenceSentenceIds must cite at least one sNN`);
      }
      deductionRefs.push({ prefix, blockId: entry.blockId, sentenceIds: entry.evidenceSentenceIds });
    }
    const expected = Math.max(0, 100 - lost);
    if (!evidenceMode && !scoredMode && typeof item.score === "number" && item.score !== expected) {
      fail(`dimensions.${key}.score ${item.score} does not equal 100 − ${lost} = ${expected}`);
    }
  }

  const computedOverallScore = scoredMode ? computeAssessmentScores(review).overallScore : dimensionScores.length === DIMENSIONS.length
    ? Math.round(dimensionScores.reduce((total, score) => total + score, 0) / DIMENSIONS.length)
    : null;
  if (
    !scoredMode && computedOverallScore !== null &&
    review.overallScore !== undefined &&
    review.overallScore !== computedOverallScore
  ) {
    fail(`overallScore ${review.overallScore} does not equal five-dimension average ${computedOverallScore}`);
  }

  if (!Array.isArray(review.blocks)) fail("blocks must be an array");
  const blockIds = new Set();
  for (const [index, block] of (Array.isArray(review.blocks) ? review.blocks : []).entries()) {
    const prefix = `blocks[${index}]`;
    if (!block || typeof block !== "object") {
      fail(`${prefix} must be an object`);
      continue;
    }
    if (typeof block.blockId !== "string" || !/^q\d+$/.test(block.blockId)) {
      fail(`${prefix}.blockId must be qNN`);
      continue;
    }
    if (blockIds.has(block.blockId)) fail(`duplicate blockId: ${block.blockId}`);
    blockIds.add(block.blockId);
    if (sourceQuestions && !sourceQuestions.has(block.blockId)) fail(`${block.blockId} does not exist in source`);
    for (const field of ["questionTitle", "interviewerIntentZh", "evaluationZh", "improvementZh", "improvedAnswerJa"]) {
      if (typeof block[field] !== "string") fail(`${prefix}.${field} must be a string`);
    }
    for (const field of ["askedPoints", "answeredPoints", "missedPoints", "strategyTags", "evidenceSentenceIds"]) {
      if (!isStringArray(block[field])) fail(`${prefix}.${field} must be a string array`);
    }
    if (!COMPREHENSION.has(block.comprehension)) fail(`${prefix}.comprehension is invalid`);
    if (!RELEVANCE.has(block.relevance)) fail(`${prefix}.relevance is invalid`);
    if (!QUALITY.has(block.quality)) fail(`${prefix}.quality is invalid`);
    for (const tag of Array.isArray(block.strategyTags) ? block.strategyTags : []) {
      if (!TAGS.has(tag)) fail(`${block.blockId} has unknown strategy tag: ${tag}`);
    }
    if (!Array.isArray(block.evidenceSentenceIds) || block.evidenceSentenceIds.length === 0) {
      fail(`${block.blockId} has no sentence evidence`);
    }
    if (sourceQuestions) {
      const allowedSentences = sourceQuestions.get(block.blockId) ?? new Set();
      for (const sentenceId of Array.isArray(block.evidenceSentenceIds) ? block.evidenceSentenceIds : []) {
        if (!allowedSentences.has(sentenceId)) {
          fail(`${block.blockId} cites ${sentenceId}, which does not belong to that source block`);
        }
      }
    }
  }

  if (sourceQuestions) {
    for (const blockId of sourceQuestions.keys()) {
      if (!blockIds.has(blockId)) fail(`source block ${blockId} has no review block`);
    }
  }

  for (const key of DIMENSIONS) {
    for (const blockId of review?.dimensions?.[key]?.evidenceBlockIds ?? []) {
      if (!blockIds.has(blockId)) fail(`dimensions.${key} cites unknown block ${blockId}`);
    }
  }

  for (const ref of deductionRefs) {
    if (!blockIds.has(ref.blockId)) {
      fail(`${ref.prefix} cites unknown block ${ref.blockId}`);
      continue;
    }
    if (!sourceQuestions) continue;
    const allowedSentences = sourceQuestions.get(ref.blockId) ?? new Set();
    for (const sentenceId of Array.isArray(ref.sentenceIds) ? ref.sentenceIds : []) {
      if (!allowedSentences.has(sentenceId)) {
        fail(`${ref.prefix} cites ${sentenceId}, which does not belong to ${ref.blockId}`);
      }
    }
  }

  if (!isStringArray(review.priorityBlockIds)) {
    fail("priorityBlockIds must be a string array");
  } else {
    if (review.priorityBlockIds.length > REVIEW_LIMITS.priorityBlockIds) {
      fail(`priorityBlockIds may contain at most ${REVIEW_LIMITS.priorityBlockIds} blocks`);
    }
    for (const blockId of review.priorityBlockIds) {
      if (!blockIds.has(blockId)) fail(`priorityBlockIds contains unknown block ${blockId}`);
    }
    if (new Set(review.priorityBlockIds).size !== review.priorityBlockIds.length) {
      fail("priorityBlockIds contains duplicates");
    }
  }

  if (!isStringArray(review.strengths) || !isStringArray(review.weaknesses)) {
    fail("strengths and weaknesses must be string arrays");
  }
  if (typeof review.summaryZh !== "string" || !review.summaryZh.trim()) fail("summaryZh is empty");
  if (review.overviewZh === undefined) {
    warnings.push("overviewZh is missing: legacy review has no holistic introduction");
  } else if (typeof review.overviewZh !== "string" || !review.overviewZh.trim()) {
    fail("overviewZh must be a non-empty string when present");
  }
  if (blockIds.size === 0) warnings.push("review contains no blocks");

  // 日本面试信号是独立层：不参与上面的五维与总分校验，缺了也不能被当成「全部做到」。
  if (review?.japanSignals !== undefined) {
    const context = sourceContent === null ? null : parseSourceSignalsContext(sourceContent);
    errors.push(...japanSignalErrors(review.japanSignals, {
      sentencesByBlock: sourceQuestions ?? undefined,
      speakers: context?.speakers,
      materialScope: review?.evaluation?.materialScope,
      reconstructed: context?.reconstructed ?? false,
    }));
    warnings.push(...japanSignalWarnings(review.japanSignals));
    if (review.japanSignalsVersion !== JAPAN_SIGNALS_VERSION) {
      fail(`japanSignalsVersion must be ${JAPAN_SIGNALS_VERSION} (server-written alongside japanSignals)`);
    }
    if (!sourceQuestions) {
      for (const [key, item] of Object.entries(review.japanSignals ?? {})) {
        for (const ref of Array.isArray(item?.evidence) ? item.evidence : []) {
          if (typeof ref?.blockId === "string" && !blockIds.has(ref.blockId)) fail(`japanSignals.${key} cites unknown block ${ref.blockId}`);
        }
      }
    }
  } else if (args.requireSignals) {
    fail("japanSignals is missing: new or re-requested reviews must assess the seven Japan interview signals");
  } else {
    warnings.push("japanSignals is missing: legacy review has no Japan interview signals (pass --require-signals for new or re-requested reviews)");
  }

  if (args.method === "v2") errors.push(...diagnosticLedgerErrors(review));

  const result = {
    ok: errors.length === 0,
    computedOverallScore,
    deductions: deductionRefs.length,
    reviewedBlocks: blockIds.size,
    sourceBlocks: sourceQuestions?.size ?? null,
    japanSignals: review?.japanSignals !== undefined,
    errors,
    warnings,
  };
  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
