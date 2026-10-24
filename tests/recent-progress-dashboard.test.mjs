import assert from "node:assert/strict";
import test from "node:test";
import { buildRecentProgressOverview } from "../lib/recent-progress-overview.ts";
import { buildProgressDashboard } from "../lib/recent-progress-dashboard.ts";

const today = "2026-10-25";
const entry = (id, fields = {}) => ({ id, caseId: id, kind: "status", sourceType: "case", dateBasis: "event", date: today,
  company: "株式会社テスト", position: "開発職", state: "応募済", sourcePaths: [], externalSources: [], sourceCount: 1, ...fields });
const model = (entries, range = "7d") => buildProgressDashboard(buildRecentProgressOverview(entries, today, range));

test("趋势每日去重公司，保留不同岗位，工作日和核实日不计成企业动态", () => {
  const result = model([entry("a"), entry("b", { company: "テスト株式会社" }), entry("c", { company: "株式会社サンプル", date: "2026-10-24" }),
    entry("log", { kind: "work", sourceType: "platform-sync", dateBasis: "recorded", state: "work-completed" }),
    entry("review", { kind: "blocker", sourceType: "user-action", dateBasis: "reviewed", state: "required-action" }),
    entry("future", { date: "2026-10-26" }), entry("invalid", { date: "2026-02-30" })]);
  assert.equal(result.companies, 2);
  assert.equal(result.buckets.length, 7);
  assert.equal(result.buckets[0].date, "2026-10-19");
  assert.equal(result.buckets[0].companies, 0);
  assert.equal(result.buckets.at(-1).companies, 1);
  assert.equal(result.buckets.at(-1).entries.length, 2);
  assert.equal(result.caseCount, 3);
});

test("分布按案件的最新记录互斥计数，申请历史保留在趋势里，同公司不同岗位不合并", () => {
  const application = entry("application", { caseId: "one", date: "2026-10-20", kind: "application", sourceType: "ai-application", state: "application-submitted" });
  const rejected = entry("rejected", { caseId: "one", state: "不採用" });
  const second = entry("second", { state: "面接中", position: "分析職" });
  for (const inputs of [[application, rejected, second], [second, rejected, application]]) {
    const result = model(inputs);
    assert.equal(result.caseCount, 2);
    assert.equal(result.segments.find((item) => item.key === "rejected").entries[0].id, "rejected");
    assert.equal(result.segments.find((item) => item.key === "applied").entries.length, 0);
    assert.equal(result.segments.find((item) => item.key === "advancing").entries.length, 1);
    assert.equal(result.waitingCompanies, 0, "已经不采用的案件不再计为申请与保留");
    assert.equal(result.buckets.find((bucket) => bucket.date === application.date).entries[0].id, "application");
  }
});

test("同日状态优先于AI申请，无case_id时依精确来源路径去重", () => {
  const inputs = [entry("status", { caseId: undefined, sourcePaths: ["20_求職/テスト/案件.md"], state: "保留" }),
    entry("application", { caseId: undefined, sourcePaths: ["20_求職/テスト/案件.md"], kind: "application", sourceType: "ai-application", state: "application-submitted" })];
  for (const entries of [inputs, [...inputs].reverse()]) {
    const result = model(entries);
    assert.equal(result.caseCount, 1);
    assert.equal(result.segments.find((item) => item.key === "held").entries.length, 1);
  }
});

test("30日补齐无动态日期，全期按月归并且每月公司去重，不受设备时区影响", () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ["Asia/Tokyo", "America/Los_Angeles"]) {
      process.env.TZ = timezone;
      const entries = [entry("old", { date: "2026-08-31" }), entry("recent", { date: "2026-10-01" })];
      assert.equal(model(entries, "30d").buckets.length, 30);
      const all = model(entries, "all");
      assert.equal(all.monthly, true);
      assert.deepEqual(all.buckets.map((bucket) => [bucket.date, bucket.end, bucket.companies]), [
        ["2026-08-01", "2026-08-31", 1], ["2026-09-01", "2026-09-30", 0], ["2026-10-01", today, 1],
      ]);
      assert.equal(all.companies, 1, "每月相同公司不能累加成全期公司数");
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("无企业动态也保留零刻度，不把工作完成记为推进，输入保持不变", () => {
  const entries = [entry("log", { kind: "work", sourceType: "application-log", dateBasis: "recorded", state: "work-completed" })];
  const before = structuredClone(entries);
  const result = model(entries);
  assert.equal(result.caseCount, 0);
  assert.equal(result.companies, 0);
  assert.equal(result.peak, 1);
  assert.equal(result.advancingCompanies, 0);
  assert.equal(result.buckets.length, 7);
  assert.deepEqual(entries, before);
});

test("热力图独立回看12周，标出所选窗口，历史日不被7日筛选清空", () => {
  const history = [entry("old", { date: "2026-08-05" }), entry("now"), entry("alias", { company: "テスト株式会社" }),
    entry("future", { date: "2026-10-26" }), entry("invalid", { date: "2026-02-30" }),
    entry("work", { date: "2026-08-06", kind: "work", sourceType: "platform-sync", dateBasis: "recorded" })];
  const result = buildProgressDashboard(buildRecentProgressOverview(history, today), history);
  assert.equal(result.heatmap.length, 84);
  assert.equal(result.heatmap[0].date, "2026-08-03");
  assert.equal(result.heatmap.at(-1).date, today);
  const old = result.heatmap.find((day) => day.date === "2026-08-05");
  assert.equal(old.companies, 1); assert.equal(old.inRange, false);
  const current = result.heatmap.at(-1);
  assert.equal(current.companies, 1); assert.equal(current.inRange, true);
  assert.equal(result.activeDays, 2);
  assert.equal(result.stars.length, 2, "星图仍只显示所选窗口的案件");
  assert.equal(result.heatmap.find((day) => day.date === "2026-08-06").companies, 0);
});

test("星图、流向和分布使用同一案件全集，sparkline按公司去重", () => {
  const result = model([entry("a", { state: "面接中" }), entry("b", { state: "面接中", company: "テスト株式会社" }),
    entry("c", { state: "不採用", company: "株式会社サンプル" })]);
  assert.equal(result.stars.length, result.caseCount);
  assert.equal(result.stars.filter((star) => star.segment === "advancing").length, 2);
  assert.equal(result.sparks.advancing.at(-1), 1);
  assert.equal(result.sparks.all.at(-1), 2);
  const midweek = buildProgressDashboard(buildRecentProgressOverview([], "2026-10-21"));
  assert.equal(midweek.heatmap.filter((day) => day.future).length, 4);
  assert.ok(midweek.heatmap.filter((day) => day.future).every((day) => !day.inRange && !day.entries.length));
});
