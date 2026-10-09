import assert from "node:assert/strict";
import test from "node:test";
import {
  dailyTraining,
  formatClock,
  goalRatio,
  heatLevel,
  jstDay,
  stageDistribution,
  trainingStreak,
} from "../lib/training-rhythm.ts";

const entry = (id, completedAt, completedCount = 100, successCount = 10) => ({
  id, date: "2026-01-01", targetSize: 100, completedCount, successCount, completedAt,
});

test("完成时间按 JST 归日：UTC 15:00 已是日本的第二天", () => {
  assert.equal(jstDay("2026-10-01T14:59:00Z"), "2026-10-01");
  assert.equal(jstDay("2026-10-01T15:00:00Z"), "2026-10-02");
  assert.equal(jstDay("bad"), "");
});

test("今天练过：从今天往回数连续天数", () => {
  const history = [
    entry("a", "2026-10-04T01:00:00Z"),
    entry("b", "2026-10-03T01:00:00Z"),
    entry("c", "2026-10-02T20:00:00Z"), // JST 10-03
    entry("d", "2026-10-02T01:00:00Z"),
    entry("e", "2026-09-29T01:00:00Z"),
  ];
  assert.deepEqual(trainingStreak(history, "2026-10-04"), { days: 3, status: "done", lastDay: "2026-10-04" });
});

test("今天还没练但昨天练过：保持中，不算断", () => {
  const history = [entry("a", "2026-10-03T01:00:00Z"), entry("b", "2026-10-02T01:00:00Z")];
  assert.deepEqual(trainingStreak(history, "2026-10-04"), { days: 2, status: "holding", lastDay: "2026-10-03" });
});

test("昨天也没练才算断；未完成的批次不计入", () => {
  const history = [entry("a", "2026-10-02T01:00:00Z"), entry("open", undefined)];
  assert.deepEqual(trainingStreak(history, "2026-10-04"), { days: 0, status: "none", lastDay: "2026-10-02" });
  assert.deepEqual(trainingStreak([], "2026-10-04"), { days: 0, status: "none", lastDay: undefined });
});

test("每日热度：固定天数、旧到新，按完成日汇总批次、项目与命中", () => {
  const days = dailyTraining([
    entry("a", "2026-10-04T01:00:00Z", 100, 12),
    entry("b", "2026-10-04T03:00:00Z", 150, 20),
    entry("c", "2026-09-30T01:00:00Z", 200, 30),
    entry("old", "2026-09-01T01:00:00Z"),
  ], 7, "2026-10-04");
  assert.equal(days.length, 7);
  assert.equal(days[0].day, "2026-09-28");
  assert.equal(days.at(-1).day, "2026-10-04");
  assert.deepEqual(days.at(-1), { day: "2026-10-04", batches: 2, items: 250, hits: 32 });
  assert.equal(days.find((day) => day.day === "2026-09-30").batches, 1);
  assert.deepEqual(days.map(heatLevel), [0, 0, 1, 0, 0, 0, 2]);
});

test("阶段分布：六段按掌握顺序、比例之和为 1，空进度不除零", () => {
  const progress = ["unseen", "unseen", "stable", "recognized"].map((stage, index) => ({ itemId: String(index), stage }));
  const shares = stageDistribution(progress);
  assert.deepEqual(shares.map((value) => value.stage), ["unseen", "recognized", "correctable", "retrievable", "transferable", "stable"]);
  assert.deepEqual(shares.map((value) => value.count), [2, 1, 0, 0, 0, 1]);
  assert.equal(shares.reduce((sum, value) => sum + value.share, 0), 1);
  assert.ok(stageDistribution([]).every((value) => value.share === 0));
});

test("计时 mm:ss，满一小时进位；目标比例夹在 0–1", () => {
  assert.equal(formatClock(0), "00:00");
  assert.equal(formatClock(65_400), "01:05");
  assert.equal(formatClock(3_599_999), "59:59");
  assert.equal(formatClock(3_661_000), "1:01:01");
  assert.equal(formatClock(-5), "00:00");
  assert.equal(goalRatio(30 * 60_000), 0.5);
  assert.equal(goalRatio(2 * 3_600_000), 1);
  assert.equal(goalRatio(-1), 0);
});
