import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticLedgerErrors } from "../.agents/skills/review-interview-answers/scripts/diagnostic-checks.mjs";

const event = { blockId: "q01", severity: "major", points: 25, labelZh: "未交付过去职务", evidenceSentenceIds: ["s001", "s002"] };
const report = (coverage, risk = []) => ({ dimensions: { coverage: { deductions: coverage }, riskControl: { deductions: risk } } });

test("v2 ledger accepts an anchored key failure and independent events in the same question", () => {
  assert.deepEqual(diagnosticLedgerErrors(report([event], [{ ...event, labelZh: "个人成果范围不明", evidenceSentenceIds: ["s003"] }])), []);
});

test("v2 ledger rejects false precision and charging an improvement opportunity", () => {
  assert.equal(diagnosticLedgerErrors(report([{ ...event, points: 17 }])).length, 1);
  assert.equal(diagnosticLedgerErrors(report([{ ...event, severity: "opportunity", points: 1 }])).length, 1);
});

test("v2 ledger rejects copying the same event across dimensions even when citation order changes", () => {
  const errors = diagnosticLedgerErrors(report([event], [{ ...event, evidenceSentenceIds: ["s002", "s001"] }]));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicates event/);
});

test("v2 ledger permits no deduction without claiming that untested ability was excellent", () => {
  assert.deepEqual(diagnosticLedgerErrors(report([])), []);
});

// 实际调用 Bridge 的提示组装函数，验证三个入口都收到同一方法，而非只检查文档字样。
test("Bridge injects the shared diagnostic method into answers, advisory and insights without changing unrelated tasks", async () => {
  const { readFile } = await import("node:fs/promises");
  const { interviewDiagnosticInstruction } = await import("../.agents/skills/review-interview-answers/scripts/diagnostic-prompt.mjs");
  const { REVIEW_LIMITS } = await import("../lib/review-contract.mjs");
  const source = await readFile("scripts/codex-bridge.mjs", "utf8");
  const start = source.indexOf("function buildPrompt(task, payload) {");
  const end = source.indexOf("\nfunction safeEnvironment()", start);
  const make = new Function("interviewDiagnosticInstruction", "REVIEW_LIMITS", "severityBand", "commonInstruction", `${source.slice(start, end)}\nreturn buildPrompt;`);
  const build = make(interviewDiagnosticInstruction, REVIEW_LIMITS, (key) => key, "test boundary");
  const payload = { blocks: [{ blockId: "q01" }], note: "INPUT_JSON stays source data" };
  for (const task of ["review_interview_answers", "review_interview_advisory", "review_interview_insights"]) {
    const prompt = build(task, payload);
    assert.ok(prompt.includes(interviewDiagnosticInstruction(task)), task);
    assert.equal(JSON.parse(prompt.split("\n\nINPUT_JSON:\n")[1]).blocks[0].blockId, "q01");
  }
  assert.ok(!build("coach_language_output", payload).includes(interviewDiagnosticInstruction("review_interview_advisory")));
});

test("evidence evaluation rejects averaging away an unresolved core event and requires positive citations", async () => {
  const { evidenceEvaluationErrors } = await import("../.agents/skills/review-interview-answers/scripts/diagnostic-checks.mjs");
  const review = { evaluationMode: "evidence", evaluation: {conclusionZh:"核心未交付",coverageZh:"完整输入文本",limitsZh:"无原音"}, dimensions: {coverage:{level:"core_gap",evidenceBlockIds:["q01"], deductions:[{...event,recovery:"unresolved"}]},directness:{level:"not_assessed",evidenceBlockIds:[],deductions:[]}} };
  assert.deepEqual(evidenceEvaluationErrors(review), []);
  assert.ok(evidenceEvaluationErrors({...review,overallScore:95}).some(s=>s.includes("numeric overall")));
  assert.ok(evidenceEvaluationErrors({...review,dimensions:{...review.dimensions,coverage:{...review.dimensions.coverage,level:"supported"}}}).some(s=>s.includes("unresolved major")));
  assert.ok(evidenceEvaluationErrors({...review,dimensions:{directness:{level:"supported",evidenceBlockIds:[],deductions:[]}}}).some(s=>s.includes("requires evidence")));
});
