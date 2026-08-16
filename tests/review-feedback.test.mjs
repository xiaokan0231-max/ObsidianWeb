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
  // 去重は共通骨格の duplicate 分岐＋応答の deduplicated。文言でなく機構を固定する。
  assert.match(route, /duplicate: \{ id: duplicate\.id \}/);
  assert.match(route, /deduplicated: outcome\.deduplicated/);
  assert.match(deepRoute, /humanFeedback/);
  assert.match(ui, /你对这项 AI 评价/);
  assert.match(ui, />不同意</);
  assert.match(ui, />补充事实</);
});

test("cross-interview trends require the same strategy tag in two interviews", async () => {
  // タグのラベルは lib/interview-trends.mjs が唯一の持ち主（Web と vault の generated ノートで共用）。
  // ここに二重に持たせないこと——表示と生成ノートの表記がずれる
  const [ui, trends] = await Promise.all([
    readFile("app/interview-review.tsx", "utf8"),
    readFile("lib/interview-trends.mjs", "utf8"),
  ]);
  // 「何場で癖とみなすか」は lib 側の判定を呼ぶこと。閾値の数字を UI に書き戻すと、
  // 片方だけ直した時に Web の傾向ページと generated ノートが黙って割れる。
  assert.match(ui, /isRepeatedAcrossInterviews\(item\.interviewKeys\.size\)/);
  assert.doesNotMatch(ui, /interviewKeys\.size >= \d/);
  assert.match(trends, /export function isRepeatedAcrossInterviews/);
  assert.match(ui, /跨面试回答趋势/);
  assert.match(ui, /STRATEGY_TREND_META.*from "@\/lib\/interview-trends\.mjs"/s);
  assert.match(trends, /复合问题漏答/);
  assert.match(trends, /主动暴露负面信息/);
  assert.doesNotMatch(ui, /const STRATEGY_TREND_META/);
  assert.match(ui, /setSelectedTrend\(tag\)/);
  assert.match(ui, /selectedTrendItem\.questions\.map/);
  assert.match(ui, /onSelect\(question\.docKey, question\.blockId\)/);
  assert.doesNotMatch(ui, /examples\.length < 3/);
});
