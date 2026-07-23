import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeInterviewAnswerReview,
  parseInterviewAnswerReview,
  renderInterviewAnswerReview,
} from "../lib/review-deep.ts";

test("answer-quality review round-trips through its durable vault note", () => {
  const review = normalizeInterviewAnswerReview(
    {
      overallScore: 68,
      dimensions: {
        questionUnderstanding: {
          score: 72,
          rationaleZh: "多数问题听懂，但复合问题有遗漏。",
          evidenceBlockIds: ["q10"],
        },
        coverage: {
          score: 60,
          rationaleZh: "AI、MCP、DDD 三项只覆盖一项。",
          evidenceBlockIds: ["q10"],
        },
        directness: {
          score: 65,
          rationaleZh: "回答相关，但没有逐项先给结论。",
          evidenceBlockIds: ["q10"],
        },
        evidenceCredibility: {
          score: 80,
          rationaleZh: "DDD 的判断与原回答一致。",
          evidenceBlockIds: ["q10"],
        },
        riskControl: {
          score: 63,
          rationaleZh: "主动承认未跟进会放大弱项。",
          evidenceBlockIds: ["q10"],
        },
      },
      summaryZh: "复合问题有漏答。",
      strengths: ["有实际经验"],
      weaknesses: ["只回答了 DDD"],
      priorityBlockIds: ["q10"],
      blocks: [
        {
          blockId: "q10",
          questionTitle: "AI・MCP・DDD",
          interviewerIntentZh: "确认三个方向的跟进情况",
          askedPoints: ["AI", "MCP", "DDD"],
          answeredPoints: ["DDD"],
          missedPoints: ["AI", "MCP"],
          comprehension: "likely_missed",
          relevance: "partial",
          quality: "weak",
          strategyTags: ["compound-question-miss", "no-conclusion-first"],
          evidenceSentenceIds: ["s091", "s092"],
          evaluationZh: "回答相关，但只覆盖了三分之一。",
          improvementZh: "先逐项回答，再展开最有把握的一项。",
          improvedAnswerJa: "AIとMCPは継続的に試しています。DDDは勉強中です。",
        },
      ],
    },
    { generatedAt: "2026-07-22T00:00:00.000Z", model: "test-model" },
    new Set(["q10"]),
  );
  assert.equal(review.overallScore, 68);
  const note = renderInterviewAnswerReview(review, {
    company: "テスト社",
    date: "2026-07-01",
    round: "一次",
    sourceName: "整理稿",
    annotationName: "批注",
  });
  assert.deepEqual(parseInterviewAnswerReview(note), review);
  assert.match(note, /AIとMCPは継続的に試しています/);
  assert.match(note, /採点内訳（各20%）/);
  assert.match(note, /问题理解 72/);
  assert.match(note, /compound-question-miss/);
});

test("deep review stays locked behind completed human decisions and an allowlisted task", async () => {
  const [route, bridge, client, annotate] = await Promise.all([
    readFile("app/api/review/deep/route.ts", "utf8"),
    readFile("scripts/codex-bridge.mjs", "utf8"),
    readFile("lib/server/codex-bridge.ts", "utf8"),
    readFile("app/api/review/annotate/route.ts", "utf8"),
  ]);
  assert.match(route, /unresolved\.length > 0/);
  assert.match(route, /review_interview_answers/);
  assert.match(bridge, /review_interview_answers: \{ model: SOL_MODEL, timeoutMs: 480_000 \}/);
  assert.match(bridge, /AI、MCP、DDD/);
  assert.match(bridge, /"dimensions"/);
  assert.match(bridge, /"strategyTags"/);
  assert.match(bridge, /服务器会据此计算总分/);
  assert.match(client, /review_interview_answers/);
  assert.match(annotate, /inAnnotationQueue/);
  assert.match(annotate, /deduplicated: true/);
});

test("five-dimension scores stay visible before the full report is expanded", async () => {
  const [client, css] = await Promise.all([
    readFile("app/interview-review.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);
  const stageStart = client.indexOf("rv-deep-stage");
  const collapsedReportStart = client.indexOf("doc.deepReview && deepOpen", stageStart);
  const glanceStart = client.indexOf("rv-score-glance", stageStart);

  assert.ok(stageStart >= 0);
  assert.ok(glanceStart > stageStart);
  assert.ok(glanceStart < collapsedReportStart);
  assert.match(client, /五维评分/);
  assert.match(client, /Object\.keys\(REVIEW_DIMENSION_META\)/);
  assert.match(css, /\.rv-score-glance > div \{[^}]*repeat\(5/);
  assert.match(css, /\.rv-dimension-track em\.low/);
});
