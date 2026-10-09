import assert from "node:assert/strict";
import test from "node:test";
import {
  diffStages,
  snapshotStages,
  summarizeBatch,
  summarizeHistory,
} from "../lib/training-settlement.ts";

const kinds = {
  a: "active_chunk",
  b: "error_patch",
  c: "technical_term",
  o1: "answer_strategy",
  o2: "answer_strategy",
  o3: "answer_strategy",
  o4: "answer_strategy",
  o5: "answer_strategy",
};
const kindOf = (id) => kinds[id];

const act = (itemId, phase, at, extra = {}) => ({ actionId: `${phase}-${itemId}`, itemId, phase, at, ...extra });
const progress = (itemId, stage) => ({
  itemId, stage, seenCount: 1, successCount: 0, failureCount: 0, successDates: [], rejected: false, postTrainingOccurrences: 0,
});

function batch(actions, overrides = {}) {
  return {
    id: "batch-1",
    date: "2026-10-01",
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T01:00:00Z",
    curriculumFingerprint: "fp",
    targetSize: 100,
    phase: "completed",
    cursor: 0,
    scanItemIds: ["a", "b", "c", "o1", "o2", "o3", "o4", "o5"],
    compileItemIds: ["a", "b"],
    stressItemIds: ["c", "o1", "o2", "o3", "o4", "o5"],
    actions,
    signature: "sig",
    ...overrides,
  };
}

test("按阶段统计：扫描看判断分布，编译与压力看服务端判定，空白不算答错", () => {
  const result = summarizeBatch({
    batch: batch([
      act("a", "scan", "2026-10-01T00:01:00Z", { judgment: "unknown" }),
      act("b", "scan", "2026-10-01T00:02:00Z", { judgment: "uncertain" }),
      act("c", "scan", "2026-10-01T00:03:00Z", { judgment: "known" }),
      act("a", "compile", "2026-10-01T00:10:00Z", { answer: "テスト", passed: true }),
      act("b", "compile", "2026-10-01T00:11:00Z", { answer: "", passed: false }),
      act("c", "stress", "2026-10-01T00:20:00Z", { answer: "違う", passed: false }),
    ]),
    kindOf,
    after: [],
  });
  assert.deepEqual(
    { known: result.scan.known, uncertain: result.scan.uncertain, unknown: result.scan.unknown, unjudged: result.scan.unjudged },
    { known: 1, uncertain: 1, unknown: 1, unjudged: 5 },
  );
  assert.deepEqual(
    { total: result.compile.total, pass: result.compile.pass, blank: result.compile.blank, fail: result.compile.fail },
    { total: 2, pass: 1, blank: 1, fail: 0 },
  );
  assert.equal(result.stress.fail, 1);
  assert.equal(result.stress.blank, 5, "没作答的回答结构题是未作答，不是未通过");
  assert.equal(result.hits, 1);
  assert.equal(result.answered, 2);
  assert.equal(result.rate, 0.5);
});

test("回答结构题：通过画 ✓；送评但未通过是「待确认」；超出批改上限的是「未批改」，都不画成 ×", () => {
  const result = summarizeBatch({
    batch: batch([
      act("o1", "stress", "2026-10-01T00:21:00Z", { answer: "結論から申し上げます。", passed: true }),
      act("o2", "stress", "2026-10-01T00:22:00Z", { answer: "二つ目です。", passed: false }),
      act("o3", "stress", "2026-10-01T00:23:00Z", { answer: "三つ目です。", passed: false }),
      act("o4", "stress", "2026-10-01T00:24:00Z", { answer: "四つ目です。", passed: false }),
    ]),
    kindOf,
    after: [],
  });
  const marks = Object.fromEntries(result.stressItems.map((item) => [item.itemId, item.mark]));
  assert.equal(marks.o1, "pass");
  assert.equal(marks.o2, "unconfirmed");
  assert.equal(marks.o3, "unconfirmed");
  assert.equal(marks.o4, "ungraded", "第 4 道起不会送 Codex 批改");
  assert.equal(marks.o5, "blank");
  assert.equal(result.stress.fail, 0);
  assert.equal(result.pendingReview, 3);
});

test("没有任何作答时命中率为 null，而不是 0%", () => {
  const result = summarizeBatch({ batch: batch([]), kindOf, after: [] });
  assert.equal(result.answered, 0);
  assert.equal(result.rate, null);
});

test("同一题多次作答取最后一次；旧批次超出上限但已作答的项目也计入", () => {
  const many = Array.from({ length: 22 }, (_, index) => `x${index}`);
  const result = summarizeBatch({
    batch: batch([
      act("x0", "compile", "2026-10-01T00:10:00Z", { answer: "古い", passed: false }),
      { ...act("x0", "compile", "2026-10-01T00:12:00Z", { answer: "新しい", passed: true }), actionId: "other" },
      act("x21", "compile", "2026-10-01T00:13:00Z", { answer: "追加", passed: true }),
    ], { compileItemIds: many, stressItemIds: [] }),
    kindOf: () => "active_chunk",
    after: [],
  });
  assert.equal(result.compile.total, 21);
  assert.equal(result.compileItems.find((item) => item.itemId === "x0").mark, "pass");
  assert.equal(result.compileItems.find((item) => item.itemId === "x21").mark, "pass");
});

test("升阶只比较基准里有的项目，按到达阶段从高到低排", () => {
  const before = snapshotStages(
    [progress("a", "unseen"), progress("b", "correctable"), progress("c", "stable"), progress("z", "unseen")],
    ["a", "b", "c"],
  );
  assert.deepEqual(before, { a: "unseen", b: "correctable", c: "stable" });
  const { promoted, demoted } = diffStages(before, [
    progress("a", "correctable"),
    progress("b", "transferable"),
    progress("c", "retrievable"),
    progress("z", "stable"),
    progress("new", "recognized"),
  ]);
  assert.deepEqual(promoted.map((change) => change.itemId), ["b", "a"]);
  assert.deepEqual(demoted, [{ itemId: "c", from: "stable", to: "retrievable" }]);
});

test("结算带上基准范围；没有基准时不编造升阶", () => {
  const withBaseline = summarizeBatch({
    batch: batch([]),
    kindOf,
    before: { scope: "session", stages: { a: "unseen" } },
    after: [progress("a", "correctable")],
  });
  assert.equal(withBaseline.baseline, "session");
  assert.equal(withBaseline.promoted.length, 1);
  const without = summarizeBatch({ batch: batch([]), kindOf, after: [progress("a", "correctable")] });
  assert.equal(without.baseline, "none");
  assert.equal(without.promoted.length, 0);
});

test("重复提交只有历史行时退化为简版", () => {
  assert.deepEqual(
    summarizeHistory({ id: "b", date: "2026-10-01", targetSize: 150, completedCount: 120, successCount: 18, completedAt: "2026-10-01T09:00:00Z" }),
    { kind: "history", batchId: "b", date: "2026-10-01", targetSize: 150, completedCount: 120, successCount: 18 },
  );
});
