import assert from "node:assert/strict";
import test from "node:test";
import { buildRecentProgressOverview, progressTone } from "../lib/recent-progress-overview.ts";

const TODAY = "2026-10-05";
function entry(id, state = "応募済", fields = {}) {
  return { id, kind: "status", date: TODAY, dateBasis: "event", company: "株式会社テスト", position: "データエンジニア",
    state, sourceType: "case", sourcePaths: [], externalSources: [], sourceCount: 1, ...fields };
}
function blocker(id, fields = {}) {
  return entry(id, "required-action", { kind: "blocker", sourceType: "user-action", dateBasis: "reviewed", ...fields });
}
function application(id, fields = {}) {
  return entry(id, "application-submitted", { kind: "application", sourceType: "ai-application", ...fields });
}
function work(id, state = "work-completed", fields = {}) {
  return entry(id, state, { kind: "work", sourceType: "application-log", dateBasis: "recorded", company: "", ...fields });
}
const ids = (items) => items.map((item) => item.id);

test("默认7日与30日都含首尾JST日，all保留全部有效历史但不含未来", () => {
  const inputs = [entry("today"), entry("seven-start", "応募済", { date: "2026-09-29" }),
    entry("before-seven", "応募済", { date: "2026-09-28" }), entry("thirty-start", "応募済", { date: "2026-09-06" }),
    entry("before-thirty", "応募済", { date: "2026-09-05" }), entry("future", "不採用", { date: "2026-10-06" }),
    entry("invalid", "不採用", { date: "2026-02-30" })];
  const seven = buildRecentProgressOverview(inputs, TODAY);
  assert.equal(seven.start, "2026-09-29");
  assert.equal(seven.end, TODAY);
  assert.deepEqual(ids(seven.entries), ["today", "seven-start"]);
  const thirty = buildRecentProgressOverview(inputs, TODAY, "30d");
  assert.equal(thirty.start, "2026-09-06");
  assert.deepEqual(ids(thirty.entries), ["today", "seven-start", "before-seven", "thirty-start"]);
  const all = buildRecentProgressOverview(inputs, TODAY, "all");
  assert.equal(all.start, null);
  assert.equal(all.entries.length, 5);
  assert.deepEqual(all.rejected, []);
});

test("日窗口跨月与闰年正确，不按设备时区二次换算", () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ["Asia/Tokyo", "America/Los_Angeles", "Europe/London"]) {
      process.env.TZ = timezone;
      const result = buildRecentProgressOverview([entry("leap", "応募済", { date: "2028-02-29" }),
        entry("first", "応募済", { date: "2028-02-24" }), entry("outside", "応募済", { date: "2028-02-23" })], "2028-03-01");
      assert.equal(result.start, "2028-02-24");
      assert.deepEqual(ids(result.entries), ["leap", "first"]);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("当前必办不受窗口裁剪，以真实due排序，原文相对期限与建议日不抢优先级", () => {
  const inputs = [blocker("relative", { dueText: "本日から1週間以内", suggested_due: "2026-10-01" }),
    blocker("older-review", { date: "2026-08-01", due: "2026-10-04" }),
    blocker("later", { due: "2026-10-07" }), blocker("today", { due: TODAY }),
    blocker("invalid-due", { due: "2026-02-30" }), blocker("future-review", { date: "2026-10-06", due: "2026-10-04" }),
    blocker("not-required", { state: "saved" }), blocker("not-reviewed", { dateBasis: "recorded" })];
  const result = buildRecentProgressOverview(inputs, TODAY);
  assert.deepEqual(ids(result.current), ["older-review", "today", "later", "invalid-due", "relative"]);
  assert.equal(result.entries.some((item) => item.id === "older-review"), false);
  assert.equal(result.entries.some((item) => item.id === "future-review"), false);
  assert.equal(result.current.length, buildRecentProgressOverview(inputs, TODAY, "all").current.length);
});

test("只把案件明确通过/面试/内定列入推进，自动受理、说明文字与拟稿不升级", () => {
  const result = buildRecentProgressOverview([
    entry("passed", "書類通過"), entry("interview", "面接中"), entry("offer", "内定"),
    entry("received", "応募済", { summary: "收到通知：仍在准备面谈" }), application("ai-submitted"),
    work("draft-label", "書類通過", { summary: "已收到回复" }),
    entry("recorded-label", "書類通過", { dateBasis: "recorded" }),
    entry("old-pass", "書類通過", { date: "2026-09-28" }),
  ], TODAY);
  assert.deepEqual(new Set(ids(result.advancing)), new Set(["passed", "interview", "offer"]));
  assert.equal(result.waiting.length, 1);
  assert.deepEqual(new Set(ids(result.waiting[0].entries)), new Set(["received", "ai-submitted"]));
});

test("拒绝和申请/保留按真实公司归一化，各岗位与事件保留、跨组可重叠", () => {
  const inputs = [entry("rejected-one", "不採用", { company: "株式会社ＴＥＳＴ", position: "基盤エンジニア" }),
    entry("rejected-two", "不採用", { company: "TEST株式会社", position: "分析エンジニア", date: "2026-10-04" }),
    entry("other-company", "不採用", { company: "株式会社TEST2" }),
    application("application-one", { company: "TEST", date: "2026-10-01" }),
    entry("paused", "保留", { company: "ＴＥＳＴ（採用媒体）", date: "2026-10-03" }),
    entry("another-position", "応募済", { company: "TEST株式会社", position: "ソフトウェアエンジニア" })];
  const result = buildRecentProgressOverview([...inputs, inputs[0]], TODAY);
  assert.equal(result.entries.length, 6, "只去掉相同entry id的重复输入");
  assert.equal(result.rejected.length, 2);
  const rejected = result.rejected.find((group) => group.key === "test");
  assert.deepEqual(ids(rejected.entries), ["rejected-one", "rejected-two"]);
  assert.deepEqual(rejected.entries.map((item) => item.position), ["基盤エンジニア", "分析エンジニア"]);
  assert.equal(result.waiting.length, 1);
  assert.equal(result.waiting[0].key, rejected.key);
  assert.deepEqual(new Set(ids(result.waiting[0].entries)), new Set(["application-one", "paused", "another-position"]));
  assert.equal(result.entries.some((item) => item.id === "application-one"), true, "后续拒绝不删除真实申请历史");
});

test("无公司或归一化空名不造未知公司统计，记录仍在明细，工作仅按类型分组", () => {
  const result = buildRecentProgressOverview([entry("blank", "不採用", { company: "  " }),
    entry("empty-key", "保留", { company: "株式会社" }), application("missing", { company: "" }),
    work("completed"), work("draft", "not-sent", { kind: "draft", sourceType: "outbound-draft" }),
    work("older-work", "sent", { date: "2026-09-28", kind: "draft", sourceType: "outbound-draft" })], TODAY);
  assert.equal(result.entries.length, 5);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.waiting.length, 0);
  assert.deepEqual(new Set(ids(result.work)), new Set(["completed", "draft"]));
});

test("重要性只读明确事实：当日/逾期真实期限紧急，受理不等于推进", () => {
  const checks = [
    [blocker("late", { due: "2026-10-04" }), "urgent"], [blocker("due-today", { due: TODAY }), "urgent"],
    [blocker("future-due", { due: "2026-10-06" }), "action"], [blocker("no-due"), "action"],
    [blocker("relative", { dueText: "今天到期", suggested_due: TODAY }), "action"],
    [blocker("bad-due", { due: "2026-02-30" }), "action"],
    [entry("passed", "書類通過"), "positive"], [entry("interview", "面接中"), "positive"], [entry("offer", "内定"), "positive"],
    [work("done"), "positive"], [work("sent", "sent", { kind: "draft", sourceType: "outbound-draft" }), "positive"],
    [work("prepared", "prepared"), "info"], [work("working", "work-in-progress"), "info"],
    [entry("rejected", "不採用"), "muted"], [entry("paused", "保留"), "neutral"],
    [entry("received"), "neutral"], [application("ai-application"), "neutral"],
    [work("saved", "saved"), "neutral"], [work("approval", "awaiting-approval"), "neutral"],
    [work("unsent", "not-sent", { kind: "draft", sourceType: "outbound-draft" }), "neutral"],
    [work("unverified-label", "書類通過"), "neutral"],
    [blocker("future-review", { date: "2026-10-06", due: "2026-10-04" }), "neutral"],
  ];
  for (const [item, expected] of checks) assert.equal(progressTone(item, TODAY), expected, item.id);
});

test("非法today返回诚实空范围，合法结果不修改输入", () => {
  for (const today of ["", "2026-2-3", "2026-02-30", "0000-01-01", "2026-10-05T00:00:00+09:00"]) {
    const result = buildRecentProgressOverview([entry("one"), blocker("action", { due: "2026-10-04" })], today);
    assert.deepEqual(result, { start: null, end: "", entries: [], current: [], advancing: [], rejected: [], waiting: [], work: [] });
    assert.equal(progressTone(blocker("action", { due: "2026-10-04" }), today), "neutral");
  }
  const inputs = [entry("one", "不採用"), application("two"), blocker("three"), work("four")];
  const before = structuredClone(inputs);
  for (const item of inputs) Object.freeze(item);
  Object.freeze(inputs);
  const result = buildRecentProgressOverview(inputs, TODAY);
  assert.deepEqual(inputs, before);
  assert.deepEqual(result, buildRecentProgressOverview([...inputs].reverse(), TODAY));
});
