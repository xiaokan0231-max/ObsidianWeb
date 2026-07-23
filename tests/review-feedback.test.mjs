import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseReviewFeedback,
  uniqueReviewFeedback,
} from "../lib/review-feedback.ts";

test("human feedback stays append-only and deduplicates identical judgments", () => {
  const note = `---
type: interview-answer-feedback
---
# 回答品質批注

- **f001｜q10｜agree｜2026-07-22**
    - 我:: 同意该项 AI 评价

- **f002｜q10｜disagree｜2026-07-22**
    - 我:: AI 和 MCP 实际上能回答，当时只听到了 DDD

- **f003｜q10｜disagree｜2026-07-22**
    - 我:: AI 和 MCP 实际上能回答，当时只听到了 DDD
`;
  const parsed = parseReviewFeedback(note);
  assert.equal(parsed.length, 3);
  assert.deepEqual(uniqueReviewFeedback(parsed), parsed.slice(0, 2));
  assert.equal(parsed[1].kind, "disagree");
  assert.equal(parsed[1].blockId, "q10");
});

test("feedback is written separately, shown per AI block, and reused on regeneration", async () => {
  const [route, deepRoute, ui] = await Promise.all([
    readFile("app/api/review/feedback/route.ts", "utf8"),
    readFile("app/api/review/deep/route.ts", "utf8"),
    readFile("app/interview-review.tsx", "utf8"),
  ]);
  assert.match(route, /interview-answer-feedback/);
  assert.match(route, /kind === "disagree" \|\| kind === "context"/);
  assert.match(route, /deduplicated: true/);
  assert.match(deepRoute, /humanFeedback/);
  assert.match(ui, /你对这项 AI 评价/);
  assert.match(ui, />不同意</);
  assert.match(ui, />补充事实</);
});

test("cross-interview trends require the same strategy tag in two interviews", async () => {
  const ui = await readFile("app/interview-review.tsx", "utf8");
  assert.match(ui, /item\.interviewKeys\.size >= 2/);
  assert.match(ui, /跨面试回答趋势/);
  assert.match(ui, /复合问题漏答/);
  assert.match(ui, /主动暴露负面信息/);
  assert.match(ui, /setSelectedTrend\(tag\)/);
  assert.match(ui, /selectedTrendItem\.questions\.map/);
  assert.match(ui, /onSelect\(question\.docKey, question\.blockId\)/);
  assert.doesNotMatch(ui, /examples\.length < 3/);
});
