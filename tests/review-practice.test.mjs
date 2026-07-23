import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseInterviewPractice,
  renderInterviewPracticeEntry,
} from "../lib/review-practice.ts";

test("interview practice entries round-trip the selected AI draft and evidence", () => {
  const entry = {
    blockId: "q10",
    status: "queued",
    queuedAt: "2026-07-22T10:30:00.000Z",
    questionTitle: "AI、MCP与DDD的跟进情况",
    improvedAnswerJa: "はい、三つともキャッチアップしています。",
    evidenceSentenceIds: ["s091", "s092", "s094"],
  };
  const note = `---\ntype: interview-answer-practice\n---\n# 回答練習\n${renderInterviewPracticeEntry(entry)}`;
  assert.deepEqual(parseInterviewPractice(note), [entry]);
});

test("review UI connects evidence jumps and the durable practice API", async () => {
  const [ui, route] = await Promise.all([
    readFile("app/interview-review.tsx", "utf8"),
    readFile("app/api/review/practice/route.ts", "utf8"),
  ]);
  assert.match(ui, /getElementById\(`rvs-\$\{sentenceId\}`\)/);
  assert.match(ui, /onEvidenceClick\(sentenceId\)/);
  assert.match(ui, /\/api\/review\/practice/);
  assert.match(ui, /已加入重练/);
  assert.match(route, /interview-answer-practice/);
  assert.match(route, /parseInterviewPractice/);
  assert.match(route, /deduplicated: true/);
  assert.match(route, /改善回答は AI 草稿/);
});
