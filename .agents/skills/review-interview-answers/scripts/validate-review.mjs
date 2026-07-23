#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const DIMENSIONS = [
  "questionUnderstanding",
  "coverage",
  "directness",
  "evidenceCredibility",
  "riskControl",
];
const TAGS = new Set([
  "compound-question-miss",
  "no-conclusion-first",
  "negative-oversharing",
  "weak-evidence",
  "over-absolute",
  "role-mismatch",
  "numbers-confusion",
]);
const COMPREHENSION = new Set(["clear", "partial", "likely_missed"]);
const RELEVANCE = new Set(["direct", "partial", "off_target"]);
const QUALITY = new Set(["strong", "mixed", "weak", "neutral"]);

function usage() {
  console.error("Usage: node validate-review.mjs --review <review.md|review.json|-> [--source <整理稿.md>]");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key !== "--review" && key !== "--source") throw new Error(`Unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

async function readInput(path) {
  if (path !== "-") return readFile(path, "utf8");
  let content = "";
  for await (const chunk of process.stdin) content += chunk;
  return content;
}

function parseReview(content) {
  const marker = "<!-- interview-answer-review-data -->";
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

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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
  const sourceQuestions = args.source ? parseSource(await readFile(args.source, "utf8")) : null;
  const errors = [];
  const warnings = [];
  const fail = (message) => errors.push(message);

  if (!review || typeof review !== "object" || Array.isArray(review)) {
    fail("review must be a JSON object");
  }

  const dimensionScores = [];
  for (const key of DIMENSIONS) {
    const item = review?.dimensions?.[key];
    if (!item || typeof item !== "object") {
      fail(`dimensions.${key} is missing`);
      continue;
    }
    if (typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < 0 || item.score > 100) {
      fail(`dimensions.${key}.score must be a number from 0 to 100`);
    } else {
      dimensionScores.push(item.score);
    }
    if (typeof item.rationaleZh !== "string" || !item.rationaleZh.trim()) {
      fail(`dimensions.${key}.rationaleZh is empty`);
    }
    if (!isStringArray(item.evidenceBlockIds) || item.evidenceBlockIds.length === 0) {
      fail(`dimensions.${key}.evidenceBlockIds must contain qNN evidence`);
    }
  }

  const computedOverallScore = dimensionScores.length === DIMENSIONS.length
    ? Math.round(dimensionScores.reduce((total, score) => total + score, 0) / DIMENSIONS.length)
    : null;
  if (
    computedOverallScore !== null &&
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

  if (!isStringArray(review.priorityBlockIds)) {
    fail("priorityBlockIds must be a string array");
  } else {
    if (review.priorityBlockIds.length > 8) fail("priorityBlockIds may contain at most 8 blocks");
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
  if (blockIds.size === 0) warnings.push("review contains no blocks");

  const result = {
    ok: errors.length === 0,
    computedOverallScore,
    reviewedBlocks: blockIds.size,
    sourceBlocks: sourceQuestions?.size ?? null,
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
