import assert from "node:assert/strict";
import test from "node:test";
import { applyQuickEvent, jstMidnightIso, QUICK_INTERVALS } from "../lib/language/quick-progress.ts";

const empty = (overrides = {}) => ({
  itemId: "li2_test",
  stage: "unseen",
  seenCount: 0,
  successCount: 0,
  failureCount: 0,
  successDates: [],
  rejected: false,
  postTrainingOccurrences: 0,
  ...overrides,
});

let serial = 0;
const event = (overrides = {}) => ({
  eventId: `e${(serial += 1)}`,
  setId: "set_a",
  setSize: 20,
  itemId: "li2_test",
  type: "cloze_choice",
  action: "answer",
  response: "に",
  first: true,
  at: "2026-10-04T01:00:00.000Z",
  ...overrides,
});

const ctx = (day, binaryOnly = false) => ({ day, binaryOnly });

/** 按 [day, passed] 依次作答（每天首答），返回最终进度。 */
function replay(days, { binaryOnly = false, start = empty() } = {}) {
  return days.reduce(
    (state, [day, passed]) =>
      applyQuickEvent(state, event({ passed, at: `${day}T03:00:00.000Z` }), ctx(day, binaryOnly)),
    start,
  );
}

test("间隔常量与方案一致", () => {
  assert.deepEqual(QUICK_INTERVALS, { firstSuccess: 3, retrievable: 7, stable: 30, failure: 1 });
});

test("到期日写成 JST 0 点的 UTC ISO", () => {
  assert.equal(jstMidnightIso("2026-10-07"), "2026-10-06T15:00:00.000Z");
  assert.equal(jstMidnightIso("2026-10-31", 1), "2026-10-31T15:00:00.000Z");
  assert.equal(jstMidnightIso("2026-12-31", 1), "2026-12-31T15:00:00.000Z");
});

test("任何事件都更新 seenCount 与 lastSeenAt，且不改入参", () => {
  const before = empty();
  const after = applyQuickEvent(before, event({ passed: true }), ctx("2026-10-04"));
  assert.equal(after.seenCount, 1);
  assert.equal(after.lastSeenAt, "2026-10-04T01:00:00.000Z");
  assert.equal(before.seenCount, 0);
  assert.deepEqual(before.successDates, []);
});

test("suspend：只标 rejected，不计成败也不排期", () => {
  const after = applyQuickEvent(empty(), event({ action: "suspend", passed: undefined }), ctx("2026-10-04"));
  assert.equal(after.rejected, true);
  assert.equal(after.attemptCount, undefined);
  assert.equal(after.failureCount, 0);
  assert.equal(after.nextDueAt, undefined);
  assert.equal(after.seenCount, 1);
});

test("非首答只算见过：同一天答错后再答对拿不到成功日", () => {
  const day = "2026-10-04";
  const failed = applyQuickEvent(empty(), event({ passed: false }), ctx(day));
  const retried = applyQuickEvent(failed, event({ passed: true, first: false }), ctx(day));
  assert.equal(retried.successCount, 0);
  assert.deepEqual(retried.successDates, []);
  assert.equal(retried.failureCount, 1);
  assert.equal(retried.attemptCount, 1);
  assert.equal(retried.seenCount, 2);
  assert.equal(retried.lastOutcome, "fail");
});

test("自动判分首答对：1 日 correctable(+3)、2 日 retrievable(+7)、3 日跨 ≥7 天 stable(+30)", () => {
  const one = replay([["2026-10-01", true]]);
  assert.equal(one.stage, "correctable");
  assert.equal(one.nextDueAt, jstMidnightIso("2026-10-04"));
  assert.equal(one.firstSuccessAt, "2026-10-01T03:00:00.000Z");
  assert.equal(one.lastGradedDay, "2026-10-01");
  assert.equal(one.lastOutcome, "pass");

  const two = replay([["2026-10-01", true], ["2026-10-04", true]]);
  assert.equal(two.stage, "retrievable");
  assert.equal(two.nextDueAt, jstMidnightIso("2026-10-11"));
  assert.equal(two.firstSuccessAt, "2026-10-01T03:00:00.000Z", "firstSuccessAt 只记第一次");

  const three = replay([["2026-10-01", true], ["2026-10-04", true], ["2026-10-11", true]]);
  assert.equal(three.stage, "stable");
  assert.equal(three.nextDueAt, jstMidnightIso("2026-11-10"));
  assert.equal(three.successCount, 3);
});

test("3 个成功日但跨度不足 7 天：停在 retrievable", () => {
  const state = replay([["2026-10-01", true], ["2026-10-02", true], ["2026-10-03", true]]);
  assert.equal(state.stage, "retrievable");
  assert.equal(state.nextDueAt, jstMidnightIso("2026-10-10"));
});

test("成功日按 JST 去重：UTC 同一天跨过 JST 零点算两天", () => {
  const first = applyQuickEvent(empty(), event({ passed: true, at: "2026-10-01T14:00:00.000Z" }), ctx("2026-10-01"));
  // UTC 15:00 已是日本的 10-02。
  const second = applyQuickEvent(first, event({ passed: true, at: "2026-10-01T15:30:00.000Z" }), ctx("2026-10-02"));
  assert.deepEqual(second.successDates, ["2026-10-01", "2026-10-02"]);
  assert.equal(second.stage, "retrievable");
  const sameDay = applyQuickEvent(first, event({ passed: true, at: "2026-10-01T14:30:00.000Z" }), ctx("2026-10-01"));
  assert.deepEqual(sameDay.successDates, ["2026-10-01"], "同一 JST 日不重复记");
});

test("只有二选一的条目：4 日且跨 ≥14 天才 stable", () => {
  const days = [["2026-10-01", true], ["2026-10-04", true], ["2026-10-11", true]];
  assert.equal(replay(days, { binaryOnly: true }).stage, "retrievable", "3 日跨 10 天还不够");
  const four = replay([...days, ["2026-10-13", true]], { binaryOnly: true });
  assert.equal(four.stage, "retrievable", "4 日但只跨 12 天");
  const enough = replay([...days, ["2026-10-15", true]], { binaryOnly: true });
  assert.equal(enough.stage, "stable");
  assert.equal(enough.nextDueAt, jstMidnightIso("2026-11-14"));
});

test("答错：failureCount+1、明天到期、stable 与 transferable 退回 retrievable", () => {
  const stable = replay([["2026-10-01", true], ["2026-10-04", true], ["2026-10-11", true]]);
  const failed = applyQuickEvent(stable, event({ passed: false, at: "2026-11-10T01:00:00.000Z" }), ctx("2026-11-10"));
  assert.equal(failed.stage, "retrievable");
  assert.equal(failed.failureCount, 1);
  assert.equal(failed.nextDueAt, jstMidnightIso("2026-11-11"));
  assert.equal(failed.lastOutcome, "fail");
  assert.equal(failed.lastGradedDay, "2026-11-10");
  const transferable = applyQuickEvent(empty({ stage: "transferable" }), event({ passed: false }), ctx("2026-10-04"));
  assert.equal(transferable.stage, "retrievable");
  const fresh = applyQuickEvent(empty(), event({ passed: false }), ctx("2026-10-04"));
  assert.equal(fresh.stage, "unseen", "答错不升阶");
});

test("「不知道」由服务端记为 passed=false，等同答错", () => {
  const state = applyQuickEvent(empty(), event({ gaveUp: true, passed: false, response: "" }), ctx("2026-10-04"));
  assert.equal(state.failureCount, 1);
  assert.equal(state.attemptCount, 1);
});

test("快练不产生 transferable：答对不会升到 transferable", () => {
  const state = replay([["2026-10-01", true], ["2026-10-04", true]]);
  assert.notEqual(state.stage, "transferable");
});

test("翻卡记得：阶段最高到 recognized，按 3/7/30 天排期，selfStreak 累加", () => {
  const flip = (state, day, rating) =>
    applyQuickEvent(state, event({ type: "flip", passed: undefined, rating, response: "", at: `${day}T02:00:00.000Z` }), ctx(day));
  const first = flip(empty(), "2026-10-01", "remembered");
  assert.equal(first.stage, "recognized");
  assert.equal(first.selfStreak, 1);
  assert.equal(first.nextDueAt, jstMidnightIso("2026-10-04"));
  assert.equal(first.lastOutcome, "self");
  assert.equal(first.attemptCount, 1);
  const second = flip(first, "2026-10-04", "remembered");
  assert.equal(second.nextDueAt, jstMidnightIso("2026-10-11"));
  const third = flip(second, "2026-10-11", "remembered");
  const fourth = flip(third, "2026-11-10", "remembered");
  assert.equal(third.nextDueAt, jstMidnightIso("2026-11-10"));
  assert.equal(fourth.nextDueAt, jstMidnightIso("2026-12-10"));
  assert.equal(fourth.stage, "recognized", "自评永远不进 stable");
  assert.deepEqual(fourth.successDates, [], "自评不产生成功日");
  assert.equal(fourth.successCount, 0);
  assert.equal(fourth.lastGradedDay, undefined, "lastGradedDay 只记自动判分");

  const kept = flip(empty({ stage: "retrievable" }), "2026-10-01", "remembered");
  assert.equal(kept.stage, "retrievable", "已有更高阶段时自评不降级");
});

test("翻卡模糊：明天再来、不记失败、selfStreak 清零；忘了：记失败", () => {
  const flip = (state, rating) =>
    applyQuickEvent(state, event({ type: "flip", passed: undefined, rating, response: "" }), ctx("2026-10-04"));
  const fuzzy = flip(empty({ selfStreak: 2 }), "fuzzy");
  assert.equal(fuzzy.failureCount, 0);
  assert.equal(fuzzy.selfStreak, 0);
  assert.equal(fuzzy.nextDueAt, jstMidnightIso("2026-10-05"));
  const forgot = flip(empty({ selfStreak: 2, stage: "stable" }), "forgot");
  assert.equal(forgot.failureCount, 1);
  assert.equal(forgot.selfStreak, 0);
  assert.equal(forgot.stage, "retrievable");
  assert.equal(forgot.nextDueAt, jstMidnightIso("2026-10-05"));
});

test("旧批次推出来的 stable 不被一次答对拉低", () => {
  const state = applyQuickEvent(empty({ stage: "stable" }), event({ passed: true }), ctx("2026-10-04"));
  assert.equal(state.stage, "stable");
  assert.equal(state.nextDueAt, jstMidnightIso("2026-11-03"));
});
