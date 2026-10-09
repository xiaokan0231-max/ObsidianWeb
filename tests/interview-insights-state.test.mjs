import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_INSIGHTS_FILTER, filterAdvisoryCoverage, filterInsightModules } from "../app/interview-insights-state.ts";

const sourceA = "20_求職/株式会社テストA/2026-09-01_一次_整理稿.md";
const sourceB = "20_求職/株式会社テストB/2026-09-01_一次_整理稿.md";
const sourceA2 = "20_求職/株式会社テストA/2026-09-02_二次_整理稿.md";
const evidence = (sourcePath) => ({ sourcePath, blockId: "q01", sentenceIds: ["s001"] });
const coverage = [
  { sourcePath: sourceA, company: "株式会社テストA", date: "2026-09-01", round: "一次", stage: "matching", status: "ready", reason: "" },
  { sourcePath: sourceB, company: "株式会社テストB", date: "2026-09-01", round: "一次", stage: "technical", status: "ready", reason: "" },
  { sourcePath: sourceA2, company: "株式会社テストA", date: "2026-09-02", round: "二次", stage: "technical", status: "ready", reason: "" },
];

test("company, date and stage filters preserve distinct same-day interview identities", () => {
  assert.deepEqual(filterAdvisoryCoverage(coverage, { ...EMPTY_INSIGHTS_FILTER, company: "株式会社テストA" }).map((item) => item.sourcePath), [sourceA, sourceA2]);
  assert.deepEqual(filterAdvisoryCoverage(coverage, { ...EMPTY_INSIGHTS_FILTER, from: "2026-09-01", to: "2026-09-01", stage: "technical" }).map((item) => item.sourcePath), [sourceB]);
  assert.deepEqual(filterAdvisoryCoverage(coverage, { ...EMPTY_INSIGHTS_FILTER, company: "株式会社テストA", stage: "technical" }).map((item) => item.sourcePath), [sourceA2]);
});

test("locating a finding keeps both original sources and does not turn comparison into a one-source claim", () => {
  const matching = { id: "role", titleZh: "角色差异", bodyZh: "两场问法的实际目的不同。", boundaryZh: "阶段不同。", evidence: [evidence(sourceA), evidence(sourceB)], contextPaths: [] };
  const other = { ...matching, id: "technical", evidence: [evidence(sourceB), evidence(sourceA2)] };
  const report = { modules: [{ key: "positioning", titleZh: "定位", commentaryZh: "整个资料范围。", findings: [matching, other] }] };
  const filtered = filterInsightModules(report, coverage, { ...EMPTY_INSIGHTS_FILTER, stage: "matching" });
  assert.deepEqual(filtered[0].findings, [matching]);
  assert.equal(new Set(filtered[0].findings[0].evidence.map((ref) => ref.sourcePath)).size, 2);
  assert.deepEqual(filtered[0].findings[0].evidence, matching.evidence);
  assert.deepEqual(report.modules[0].findings, [matching, other]);
});

test("no matching stage exposes no invented findings while keeping module structure", () => {
  const report = { modules: [{ key: "opportunities", titleZh: "机会", commentaryZh: "已知材料。", findings: [{ id: "match", evidence: [evidence(sourceA), evidence(sourceB)] }] }] };
  const result = filterInsightModules(report, coverage, { ...EMPTY_INSIGHTS_FILTER, stage: "final" });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].findings, []);
  assert.equal(filterInsightModules(report, coverage, EMPTY_INSIGHTS_FILTER), report.modules);
});
