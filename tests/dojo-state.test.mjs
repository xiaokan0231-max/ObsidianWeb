import assert from "node:assert/strict";
import test from "node:test";
import { deriveDojoState } from "../lib/dojo/state.ts";

const profile = {
  version: 1,
  generatedAt: "2026-07-19T00:00:00.000Z",
  model: "fake",
  sourceFingerprint: "src_same",
  sourceCount: 1,
  summaryZh: "test",
  immediateAdviceZh: "test",
  learningItems: [
    {
      id: "ti_stable",
      canonicalKey: "stable-key",
      category: "structure",
      titleZh: "结论先行",
      targetJa: "結論から申し上げます。",
      explanationZh: "test",
      evidence: [],
      priority: 90,
      drillZh: "test",
      passCriteriaZh: "test",
      risk: "high",
    },
  ],
  questionBank: [],
  upcomingFocus: [],
};

const trainedEvent = {
  id: "event-1",
  itemId: "ti_stable",
  action: "trained",
  at: "2026-07-19T01:00:00.000Z",
};

function report(id, submittedAt, score, passed) {
  return {
    id,
    examId: `exam-${id}`,
    examName: "测试考试",
    submittedAt,
    model: "program",
    profileFingerprint: "src_same",
    score,
    categoryScores: { structure: score },
    questions: [],
    grades: [],
    itemResults: [
      { itemId: "ti_stable", score, passed, criticalError: !passed },
    ],
    newlyMastered: passed ? ["ti_stable"] : [],
    stillUnmastered: passed ? [] : ["ti_stable"],
  };
}

test("finishing training does not imply mastery", () => {
  const state = deriveDojoState(profile, [trainedEvent], []);
  assert.equal(state.items[0].trainingStatus, "trained");
  assert.equal(state.items[0].masteryStatus, "unassessed");
  assert.equal(state.items[0].examCount, 0);
});

test("passing an exam marks mastery", () => {
  const state = deriveDojoState(profile, [trainedEvent], [
    report("pass", "2026-07-19T02:00:00.000Z", 88, true),
  ]);
  assert.equal(state.items[0].masteryStatus, "mastered");
  assert.equal(state.items[0].latestScore, 88);
  assert.equal(state.items[0].bestScore, 88);
});

test("a later failure demotes mastery while preserving training", () => {
  const state = deriveDojoState(profile, [trainedEvent], [
    report("pass", "2026-07-19T02:00:00.000Z", 92, true),
    report("fail", "2026-07-19T03:00:00.000Z", 61, false),
  ]);
  assert.equal(state.items[0].trainingStatus, "trained");
  assert.equal(state.items[0].masteryStatus, "failed");
  assert.equal(state.items[0].latestScore, 61);
  assert.equal(state.items[0].bestScore, 92);
  assert.equal(state.items[0].examCount, 2);
  assert.equal(state.items[0].failedCount, 1);
});

test("a v2 profile with the same stable item id inherits v1 history", () => {
  const rebuiltProfile = {
    ...profile,
    version: 2,
    generatedAt: "2026-07-20T00:00:00.000Z",
    sourceFingerprint: "src_new",
    learningItems: profile.learningItems.map((item) => ({
      ...item,
      titleZh: "结论先行（升级教材）",
    })),
  };
  const state = deriveDojoState(rebuiltProfile, [trainedEvent], [
    report("pass", "2026-07-19T02:00:00.000Z", 86, true),
  ]);
  assert.equal(state.items[0].id, "ti_stable");
  assert.equal(state.items[0].trainingStatus, "trained");
  assert.equal(state.items[0].masteryStatus, "mastered");
});
