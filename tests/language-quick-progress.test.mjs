import assert from "node:assert/strict";
import test from "node:test";
import {
  applyQuickEvent,
  jstMidnightIso,
  QUICK_EASY_INTERVAL,
  QUICK_INTERVALS,
  quickDay,
  quickDayStartIso,
} from "../lib/language/quick-progress.ts";
import { QUICK_DAY_START_HOUR } from "../lib/language/quick-types.ts";

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

test("jstMidnightIso 仍导出、口径不变（旧批次降级排期在用）", () => {
  assert.equal(jstMidnightIso("2026-10-07"), "2026-10-06T15:00:00.000Z");
  assert.equal(jstMidnightIso("2026-10-31", 1), "2026-10-31T15:00:00.000Z");
  assert.equal(jstMidnightIso("2026-12-31", 1), "2026-12-31T15:00:00.000Z");
});

test("练习日：日本时间 04:00 起算；到期日写成练习日起点（JST 04:00）的 UTC ISO", () => {
  assert.equal(QUICK_DAY_START_HOUR, 4);
  // JST 10-05 03:59 仍是 10-04 这个练习日，04:00 起才是 10-05。
  assert.equal(quickDay("2026-10-04T18:59:59.000Z"), "2026-10-04");
  assert.equal(quickDay("2026-10-04T19:00:00.000Z"), "2026-10-05");
  // JST 23:53（UTC 14:53）与 JST 00:30（UTC 15:30）同属一个练习日。
  assert.equal(quickDay("2026-10-04T14:53:00.000Z"), "2026-10-04");
  assert.equal(quickDay("2026-10-04T15:30:00.000Z"), "2026-10-04");
  assert.equal(quickDay("bad"), "");
  assert.equal(quickDayStartIso("2026-10-07"), "2026-10-06T19:00:00.000Z");
  assert.equal(quickDayStartIso("2026-10-31", 1), "2026-10-31T19:00:00.000Z");
  assert.equal(quickDayStartIso("2026-12-31", 1), "2026-12-31T19:00:00.000Z");
  assert.equal(quickDay(quickDayStartIso("2026-10-07")), "2026-10-07", "起点本身属于当天");
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
  assert.equal(one.nextDueAt, quickDayStartIso("2026-10-04"));
  assert.equal(one.firstSuccessAt, "2026-10-01T03:00:00.000Z");
  assert.equal(one.lastGradedDay, "2026-10-01");
  assert.equal(one.lastOutcome, "pass");

  const two = replay([["2026-10-01", true], ["2026-10-04", true]]);
  assert.equal(two.stage, "retrievable");
  assert.equal(two.nextDueAt, quickDayStartIso("2026-10-11"));
  assert.equal(two.firstSuccessAt, "2026-10-01T03:00:00.000Z", "firstSuccessAt 只记第一次");

  const three = replay([["2026-10-01", true], ["2026-10-04", true], ["2026-10-11", true]]);
  assert.equal(three.stage, "stable");
  assert.equal(three.nextDueAt, quickDayStartIso("2026-11-10"));
  assert.equal(three.successCount, 3);
});

test("3 个成功日但跨度不足 7 天：停在 retrievable", () => {
  const state = replay([["2026-10-01", true], ["2026-10-02", true], ["2026-10-03", true]]);
  assert.equal(state.stage, "retrievable");
  assert.equal(state.nextDueAt, quickDayStartIso("2026-10-10"));
});

// 原断言「跨过 JST 零点算两天」按旧日界写；本人改为练习日从 04:00 起算，这里改成 04:00 两侧。
test("成功日按练习日去重：跨过 JST 零点仍是同一天，跨过 04:00 才算两天", () => {
  const first = applyQuickEvent(empty(), event({ passed: true, at: "2026-10-01T14:00:00.000Z" }), ctx("2026-10-01"));
  // UTC 15:30＝JST 10-02 00:30，仍属练习日 10-01。
  const afterMidnight = applyQuickEvent(first, event({ passed: true, at: "2026-10-01T15:30:00.000Z" }), ctx("2026-10-01"));
  assert.deepEqual(afterMidnight.successDates, ["2026-10-01"], "深夜跨零点不算第二天");
  assert.equal(afterMidnight.stage, "correctable");
  // UTC 19:00＝JST 10-02 04:00，练习日 10-02。
  const nextDay = applyQuickEvent(first, event({ passed: true, at: "2026-10-01T19:00:00.000Z" }), ctx("2026-10-02"));
  assert.deepEqual(nextDay.successDates, ["2026-10-01", "2026-10-02"]);
  assert.equal(nextDay.stage, "retrievable");
});

test("练习日从 event.at 算，调用方传日历日也不带偏", () => {
  // 调用方（旧批次回放）按日历日传了 10-05，但 JST 00:30 仍属练习日 10-04。
  const state = applyQuickEvent(empty(), event({ passed: false, at: "2026-10-04T15:30:00.000Z" }), ctx("2026-10-05"));
  assert.equal(state.lastGradedDay, "2026-10-04");
  assert.equal(state.nextDueAt, quickDayStartIso("2026-10-05"), "答错的题到明天 04:00 才到期，不是几分钟后");
  // at 解析不了时才用 ctx.day 兜底。
  const fallback = applyQuickEvent(empty(), event({ passed: true, at: "garbage" }), ctx("2026-10-04"));
  assert.deepEqual(fallback.successDates, ["2026-10-04"]);
});

test("只有二选一的条目：4 日且跨 ≥14 天才 stable", () => {
  const days = [["2026-10-01", true], ["2026-10-04", true], ["2026-10-11", true]];
  assert.equal(replay(days, { binaryOnly: true }).stage, "retrievable", "3 日跨 10 天还不够");
  const four = replay([...days, ["2026-10-13", true]], { binaryOnly: true });
  assert.equal(four.stage, "retrievable", "4 日但只跨 12 天");
  const enough = replay([...days, ["2026-10-15", true]], { binaryOnly: true });
  assert.equal(enough.stage, "stable");
  assert.equal(enough.nextDueAt, quickDayStartIso("2026-11-14"));
});

test("答错：failureCount+1、明天到期、stable 与 transferable 退回 retrievable", () => {
  const stable = replay([["2026-10-01", true], ["2026-10-04", true], ["2026-10-11", true]]);
  const failed = applyQuickEvent(stable, event({ passed: false, at: "2026-11-10T01:00:00.000Z" }), ctx("2026-11-10"));
  assert.equal(failed.stage, "retrievable");
  assert.equal(failed.failureCount, 1);
  assert.equal(failed.nextDueAt, quickDayStartIso("2026-11-11"));
  assert.equal(failed.lastOutcome, "fail");
  assert.equal(failed.lastGradedDay, "2026-11-10");
  const transferable = applyQuickEvent(empty({ stage: "transferable" }), event({ passed: false }), ctx("2026-10-04"));
  assert.equal(transferable.stage, "retrievable");
  const fresh = applyQuickEvent(empty(), event({ passed: false }), ctx("2026-10-04"));
  assert.equal(fresh.stage, "unseen", "答错不升阶");
});

test("答错的代价：成功日只留最近 1 个，要在失败之后再攒 2 个成功日（跨 ≥7 天）才回 stable", () => {
  const stable = replay([["2026-10-01", true], ["2026-10-04", true], ["2026-10-11", true]]);
  assert.equal(stable.stage, "stable");
  const failed = replay([["2026-11-10", false]], { start: stable });
  assert.deepEqual(failed.successDates, ["2026-10-11"], "只留最近一个成功日");
  assert.equal(failed.stage, "retrievable");
  // 旧规则下这一步就回 stable、30 天后才再见；现在成功日 2 个 → 7 天后再验证。
  const once = replay([["2026-11-11", true]], { start: failed });
  assert.equal(once.stage, "retrievable");
  assert.deepEqual(once.successDates, ["2026-10-11", "2026-11-11"]);
  assert.equal(once.nextDueAt, quickDayStartIso("2026-11-18"));
  const twice = replay([["2026-11-18", true]], { start: once });
  assert.equal(twice.stage, "stable");
  assert.equal(twice.nextDueAt, quickDayStartIso("2026-12-18"));
});

test("连续两次首答答错：成功日清空，间隔回到 3 → 7 → 30", () => {
  const two = replay([["2026-10-01", true], ["2026-10-04", true]]);
  const failedTwice = replay([["2026-10-11", false], ["2026-10-12", false]], { start: two });
  assert.deepEqual(failedTwice.successDates, []);
  assert.equal(failedTwice.failureCount, 2);
  const a = replay([["2026-10-13", true]], { start: failedTwice });
  assert.equal(a.nextDueAt, quickDayStartIso("2026-10-16"), "成功日从 0 重新爬：3 天");
  const b = replay([["2026-10-16", true]], { start: a });
  assert.equal(b.nextDueAt, quickDayStartIso("2026-10-23"), "7 天");
  const c = replay([["2026-10-23", true]], { start: b });
  assert.equal(c.stage, "stable");
  assert.equal(c.nextDueAt, quickDayStartIso("2026-11-22"), "30 天");

  // 从 correctable 连错两次：要再对两天才回 retrievable。
  const one = replay([["2026-10-01", true], ["2026-10-04", false], ["2026-10-05", false]]);
  assert.deepEqual(one.successDates, []);
  assert.equal(replay([["2026-10-06", true]], { start: one }).stage, "correctable");
  assert.equal(replay([["2026-10-06", true], ["2026-10-09", true]], { start: one }).stage, "retrievable");

  // 中间隔着一次答对就不算连续：只截到 1 个。
  const alternating = replay([["2026-10-01", true], ["2026-10-04", false], ["2026-10-05", true], ["2026-10-08", false]]);
  assert.deepEqual(alternating.successDates, ["2026-10-05"]);
});

test("easy（太简单）：算一次作答、阶段至少 recognized、30 天后验证、不产生成功日也不记失败", () => {
  const fresh = applyQuickEvent(empty(), event({ action: "easy", passed: undefined, first: false, response: "" }), ctx("2026-10-04"));
  assert.equal(QUICK_EASY_INTERVAL, 30);
  assert.equal(fresh.stage, "recognized");
  assert.equal(fresh.attemptCount, 1, "不再是新题");
  assert.equal(fresh.lastOutcome, "easy");
  assert.equal(fresh.nextDueAt, quickDayStartIso("2026-11-03"));
  assert.deepEqual(fresh.successDates, []);
  assert.equal(fresh.successCount, 0);
  assert.equal(fresh.failureCount, 0);
  assert.equal(fresh.seenCount, 1);
  assert.equal(fresh.lastGradedDay, undefined);
  // 答对之后再按「太简单」：保留已有的成功日与更高阶段，只把到期推到 30 天后。
  const passed = applyQuickEvent(empty(), event({ passed: true }), ctx("2026-10-04"));
  const easy = applyQuickEvent(passed, event({ action: "easy", passed: undefined, first: false }), ctx("2026-10-04"));
  assert.equal(easy.stage, "correctable");
  assert.deepEqual(easy.successDates, ["2026-10-04"]);
  assert.equal(easy.attemptCount, 2);
  // 30 天后验证答对：开始照常记成功日，不会一步进 stable。
  const verified = applyQuickEvent(fresh, event({ passed: true, at: "2026-11-03T03:00:00.000Z" }), ctx("2026-11-03"));
  assert.equal(verified.stage, "correctable");
  assert.equal(verified.lastOutcome, "pass");
});

test("restore：撤销排除，不算见过也不计作答；triage：进度什么都不改", () => {
  const suspended = applyQuickEvent(empty(), event({ action: "suspend", passed: undefined, first: false }), ctx("2026-10-04"));
  const restored = applyQuickEvent(suspended, event({ action: "restore", passed: undefined, first: false, at: "2026-10-04T02:00:00.000Z" }), ctx("2026-10-04"));
  assert.equal(restored.rejected, false);
  assert.equal(restored.seenCount, suspended.seenCount);
  assert.equal(restored.lastSeenAt, suspended.lastSeenAt);
  assert.equal(restored.attemptCount, undefined);
  const before = empty({ stage: "correctable", successDates: ["2026-10-01"], seenCount: 2, attemptCount: 1 });
  const triaged = applyQuickEvent(before, event({ action: "triage", judgment: "known", passed: undefined, first: false }), ctx("2026-10-04"));
  assert.deepEqual(triaged, before);
  assert.notEqual(triaged, before, "返回新对象，不改入参");
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
  assert.equal(first.nextDueAt, quickDayStartIso("2026-10-04"));
  assert.equal(first.lastOutcome, "self");
  assert.equal(first.attemptCount, 1);
  const second = flip(first, "2026-10-04", "remembered");
  assert.equal(second.nextDueAt, quickDayStartIso("2026-10-11"));
  const third = flip(second, "2026-10-11", "remembered");
  const fourth = flip(third, "2026-11-10", "remembered");
  assert.equal(third.nextDueAt, quickDayStartIso("2026-11-10"));
  assert.equal(fourth.nextDueAt, quickDayStartIso("2026-12-10"));
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
  assert.equal(fuzzy.nextDueAt, quickDayStartIso("2026-10-05"));
  const forgot = flip(empty({ selfStreak: 2, stage: "stable" }), "forgot");
  assert.equal(forgot.failureCount, 1);
  assert.equal(forgot.selfStreak, 0);
  assert.equal(forgot.stage, "retrievable");
  assert.equal(forgot.nextDueAt, quickDayStartIso("2026-10-05"));
});

test("旧批次推出来的 stable 不被一次答对拉低", () => {
  const state = applyQuickEvent(empty({ stage: "stable" }), event({ passed: true }), ctx("2026-10-04"));
  assert.equal(state.stage, "stable");
  assert.equal(state.nextDueAt, quickDayStartIso("2026-11-03"));
});
