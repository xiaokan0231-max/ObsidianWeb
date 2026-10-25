import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ASSESSMENT_DIMENSIONS, computeAssessmentScores } from "../lib/assessment-scoring.mjs";
import { diagnosticLedgerErrors, scoredEvidenceErrors } from "../.agents/skills/review-interview-answers/scripts/diagnostic-checks.mjs";
import { normalizeInterviewAnswerReview, parseInterviewAnswerReview, renderInterviewAnswerReview } from "../lib/review-deep.ts";

const source = new Map([["q01", new Set(["s001"])], ["q02", new Set(["s002"])], ["q03", new Set(["s003"])]]);
const unassessed = () => ({ level: "not_assessed", baseScore: null, basisZh: "未问实际独立责任，不能评。", rationaleZh: "未受检验。", positiveEvidenceBlockIds: [], evidenceBlockIds: [], deductions: [] });
const assessed = (base = 75) => ({ level: "supported", baseScore: base, basisZh: base === 75 ? "所引窄问题达到标准参考线，未证明优秀。" : "q01、q02分别有具体个人动作及结果，可供语义审核。", rationaleZh: "限所引问题，保留未知范围。", positiveEvidenceBlockIds: base === 75 ? [] : ["q01", "q02"], evidenceBlockIds: ["q01", "q02"], deductions: [] });
const event = (recovery = "unresolved", points = 25, severity = "major") => ({ blockId: "q03", points, severity, recovery, labelZh: "过去职责核心未交付", detailZh: "问过去职责却答未来，后文未恢复；原因未知。", fixZh: "核真实职责，先答过去。", evidenceSentenceIds: ["s003"] });
// 新生成的复盘必须带整场日本面试信号；它独立于五维，不影响这里断言的任何分数。
const signals = () => ({
  motivation: { verdict: "poor", observationZh: "整场没有说出想进这家公司。", fixZh: "收尾先说想在贵公司负责的工作。", evidence: [{ blockId: "q01", sentenceIds: ["s001"] }] },
  closing: { verdict: "mixed", observationZh: "只道谢，没有表明意愿。", fixZh: "道谢后补一句希望进入下一步。", evidence: [{ blockId: "q03", sentenceIds: ["s003"] }] },
  concernRecovery: { verdict: "not_applicable", observationZh: "查过全部问答，面试官没有流露懸念。", fixZh: "", evidence: [] },
  unpromptedNegative: { verdict: "good", observationZh: "职责说明里没有主动说负面。", fixZh: "", evidence: [{ blockId: "q02", sentenceIds: ["s002"] }] },
  registerConsistency: { verdict: "good", observationZh: "即兴补充保持です・ます。", fixZh: "", evidence: [{ blockId: "q02", sentenceIds: ["s002"] }] },
  salaryVisaLine: { verdict: "not_applicable", observationZh: "本场没有谈年收或在留。", fixZh: "", evidence: [] },
  reverseQuestions: { verdict: "not_applicable", observationZh: "面试官没有给提问机会。", fixZh: "", evidence: [] },
});
const raw = () => ({ evaluationMode: "scored_evidence", japanSignals: signals(), evaluation: { conclusionZh: "按实际证据判断。", coverageZh: "完整现有文本，非原音。", limitsZh: "未问范围不外推。", scoringEligible: true, eligibilityZh: "三维可评且覆盖和直接性可评。", materialScope: "full_available_text" }, dimensions: Object.fromEntries(ASSESSMENT_DIMENSIONS.map(key => [key, unassessed()])), overviewZh: "关键问题先看，正面另列。", summaryZh: "仅本场有据表现。", strengths: ["独立具体回答有证据"], weaknesses: [], priorityBlockIds: ["q03"], blocks: [...source].map(([blockId, ids]) => ({ blockId, questionTitle: "测试问题", interviewerIntentZh: "核职责", askedPoints: ["职责"], answeredPoints: ["实际回应"], missedPoints: [], comprehension: "clear", relevance: "direct", quality: "mixed", strategyTags: [], evidenceSentenceIds: [...ids], evaluationZh: "按实际连续上下文。", improvementZh: "先答真实范围。", improvedAnswerJa: "" })) });
const three = () => {
  const value = raw();
  value.dimensions.questionUnderstanding = assessed();
  value.dimensions.coverage = assessed(85);
  value.dimensions.directness = assessed(85);
  return value;
};
const normalize = value => normalizeInterviewAnswerReview(value, { generatedAt: "2026-01-01", model: "test" }, source);
const meta = { company: "株式会社テスト", date: "2026-01-01", round: "一次", sourceName: "整理稿", annotationName: null };

test("assessed-only mean and five-point rounding leave unasked dimensions null", () => {
  const value = three();
  assert.deepEqual(scoredEvidenceErrors(value, { sourceBlockIds: source.keys(), sentencesByBlock: source }), []);
  const review = normalize(value);
  assert.equal(review.overallScore, 80);
  assert.equal(review.scoring.rawMean, 245 / 3);
  assert.equal(review.scoring.roundedMean, 80);
  assert.equal(review.scoring.cap, null);
  assert.deepEqual(review.scoring.assessedDimensions, ["questionUnderstanding", "coverage", "directness"]);
  assert.equal(review.dimensions.riskControl.score, null);
  assert.match(review.scoring.formulaZh, /平均≈81.7/);
  assert.doesNotMatch(review.scoring.formulaZh, /81.666666|questionUnderstanding/);
});

test("unresolved core loss cannot be averaged away by four strong dimensions", () => {
  const value = raw();
  for (const key of ASSESSMENT_DIMENSIONS) value.dimensions[key] = assessed(95);
  value.dimensions.coverage = { ...assessed(95), level: "core_gap", evidenceBlockIds: ["q01", "q02", "q03"], deductions: [event()] };
  const review = normalize(value);
  assert.equal(review.dimensions.coverage.score, 50);
  assert.equal(review.scoring.rawMean, 86);
  assert.equal(review.scoring.roundedMean, 85);
  assert.equal(review.scoring.cap, 60);
  assert.equal(review.overallScore, 60);
  assert.match(review.scoring.formulaZh, /上限是规范性门槛，不是同事件再次扣分/);
  const markdown = renderInterviewAnswerReview(review, meta);
  assert.match(markdown, /严重 · 未恢复/);
  assert.match(markdown, /60 \/ 100（有据参考分）/);
  assert.match(markdown, /基准95/);
  assert.match(markdown, /正证：q01・q02/);
  assert.ok(markdown.indexOf("关键问题与修复状态") < markdown.indexOf("有据评分与计算依据"));
});

test("successful clarification without residual loss is zero; repaired extraction cost remains explicit", () => {
  const success = three();
  success.dimensions.coverage.deductions = [{ ...event("repaired", 0, "moderate"), detailZh: "重问后即时完整回答，未见残余信息或提取损失。" }];
  success.dimensions.coverage.evidenceBlockIds.push("q03");
  assert.deepEqual(diagnosticLedgerErrors(success), []);
  assert.deepEqual(scoredEvidenceErrors(success, { sourceBlockIds: source.keys(), sentencesByBlock: source }), []);
  assert.equal(normalize(success).dimensions.coverage.score, 85);
  const cost = structuredClone(success);
  cost.dimensions.coverage.level = "partial";
  cost.dimensions.coverage.deductions = [{ ...event("repaired", 5, "moderate"), detailZh: "最终字段完整，但对方反复从旧条件中提取当前条件，已发生的额外成本有原问答支持。" }];
  assert.deepEqual(scoredEvidenceErrors(cost, { sourceBlockIds: source.keys(), sentencesByBlock: source }), []);
  assert.equal(normalize(cost).dimensions.coverage.score, 80);
  assert.equal(normalize(cost).dimensions.coverage.deductions[0].recovery, "repaired");
  const falseZero = structuredClone(success);
  falseZero.dimensions.coverage.deductions[0].recovery = "unresolved";
  assert.ok(diagnosticLedgerErrors(falseZero).length > 0);
});

test("material and dimension eligibility gates never synthesize an overall score", () => {
  for (const mutate of [
    value => { value.evaluation.materialScope = "limited"; value.evaluation.scoringEligible = false; },
    value => { value.dimensions.questionUnderstanding = unassessed(); value.evaluation.scoringEligible = false; },
    value => { value.dimensions.coverage = unassessed(); value.dimensions.riskControl = assessed(); value.evaluation.scoringEligible = false; },
    value => { value.evaluation.scoringEligible = false; },
  ]) {
    const value = three(); mutate(value);
    const scores = computeAssessmentScores(value);
    assert.equal(scores.overallScore, null);
    assert.equal(scores.scoring.rawMean, null);
    assert.equal(scores.scoring.roundedMean, null);
    assert.equal(scores.scoring.cap, null);
  }
  const invalid = three(); invalid.evaluation.materialScope = "limited";
  assert.ok(scoredEvidenceErrors(invalid).some(error => error.includes("gates")));
});

test("bases require independent positive source questions; missing or repeated evidence cannot upgrade", () => {
  for (const mutate of [
    value => { value.dimensions.riskControl.baseScore = 75; },
    value => { value.dimensions.coverage.positiveEvidenceBlockIds = ["q01"]; },
    value => { value.dimensions.coverage.positiveEvidenceBlockIds = ["q01", "q01"]; },
    value => { value.dimensions.coverage.positiveEvidenceBlockIds = ["q01", "q99"]; },
    value => { value.dimensions.coverage.baseScore = 95; value.dimensions.coverage.basisZh = ""; },
    value => { value.overallScore = 99; },
    value => { value.dimensions.directness.score = 99; },
  ]) {
    const value = three(); mutate(value);
    assert.ok(scoredEvidenceErrors(value, { sourceBlockIds: source.keys() }).length > 0);
  }
});

test("unresolved major cannot be softened or copied across dimensions with renamed label", () => {
  const value = three();
  value.dimensions.coverage.deductions = [event()];
  value.dimensions.coverage.evidenceBlockIds.push("q03");
  assert.ok(scoredEvidenceErrors(value).some(error => error.includes("unresolved major")));
  value.dimensions.coverage.level = "core_gap";
  value.dimensions.directness = { ...assessed(85), level: "core_gap", evidenceBlockIds: ["q01", "q02", "q03"], deductions: [{ ...event(), labelZh: "同一缺口换名" }] };
  assert.ok(scoredEvidenceErrors(value).some(error => error.includes("duplicates event")));
  value.dimensions.directness = assessed(85);
  value.dimensions.coverage.deductions[0].evidenceSentenceIds = ["s002"];
  assert.ok(scoredEvidenceErrors(value, { sentencesByBlock: source }).some(error => error.includes("does not belong")));
});

test("durable v3 markdown validates its calculated formula and preserves old evidence and numeric histories", () => {
  const review = normalize(three());
  const markdown = renderInterviewAnswerReview(review, meta);
  assert.deepEqual(parseInterviewAnswerReview(markdown), review);
  const validator = ".agents/skills/review-interview-answers/scripts/validate-review.mjs";
  const good = spawnSync(process.execPath, [validator, "--review", "-", "--method", "v3"], { input: markdown, encoding: "utf8" });
  assert.equal(good.status, 0, good.stdout + good.stderr);
  const corrupt = { ...review, overallScore: 99 };
  const bad = spawnSync(process.execPath, [validator, "--review", "-", "--method", "v3"], { input: JSON.stringify(corrupt), encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /server formula/);
  const historic = { ...review, evaluationMode: "evidence", overallScore: null };
  const old = parseInterviewAnswerReview(renderInterviewAnswerReview(historic, meta));
  assert.equal(old.evaluationMode, "evidence");
  assert.equal(old.overallScore, null);
  const numberHistory = { ...review, evaluationMode: undefined, overallScore: 97 };
  assert.equal(parseInterviewAnswerReview(renderInterviewAnswerReview(numberHistory, meta)).overallScore, 97);
});

async function invokeDeep(output, { originalPresent = true, changeOriginalDuringGeneration = false } = {}) {
  const { loadAppModule } = await import("./helpers/render-tsx.mjs");
  const notePath = "20_求職/株式会社テスト/2026-01-01_一次_整理稿.md";
  const originalPath = "20_求職/株式会社テスト/2026-01-01_一次_逐字稿.md";
  const content = [...source].map(([q, ids]) => `## ${q} 测试问题\n- **${[...ids][0]}｜私**\n    - 正:: 事実を確認してお答えします。`).join("\n\n");
  const study = { frontmatter: { type: "transcript-study", company: "株式会社テスト", date: "2026-01-01", round: "一次", source_note: "[[2026-01-01_一次_逐字稿]]" }, content };
  let original = originalPresent ? { frontmatter: { type: "transcript" }, content: "原始问答文本，不能当作AI补稿。" } : null;
  const writes = [];
  let payload;
  const read = async path => path === notePath ? study : path === originalPath ? original : null;
  const { POST } = await loadAppModule("app/api/review/deep/route.ts", { stubs: {
    "@/lib/server/obsidian": { readNote: read, readNoteOrNull: read, readAllNotes: async () => [], writeNote: async (path, text) => { writes.push({ path, text }); } },
    "@/lib/server/codex-bridge": { invokeCodex: async (_task, input) => {
      payload = input;
      if (changeOriginalDuringGeneration) original = { ...original, content: "生成期间本人更新了原问答。" };
      return { output, model: "test" };
    } },
    "@/lib/server/interview-advisory": { interviewAdvisory: { generateSource: async () => { throw Error("测试顾问暂缓，不影响已保存评价。"); } } },
  } });
  const response = await POST(new Request("http://localhost:3000/api/review/deep", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify({ notePath }) }));
  return { status: response.status, body: await response.json(), writes, payload };
}

test("actual deep route calculates v3 scores, preserves original provenance and refuses fabricated scores before writing", async () => {
  const value = three();
  value.dimensions.coverage = { ...value.dimensions.coverage, level: "core_gap", evidenceBlockIds: ["q01", "q02", "q03"], deductions: [event()] };
  const good = await invokeDeep(value);
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.equal(good.body.review.overallScore, 60);
  assert.equal(good.body.review.dimensions.coverage.score, 50);
  assert.equal(good.writes.length, 1);
  assert.match(good.writes[0].text, /严重 · 未恢复/);
  assert.equal(good.payload.sourceMaterial.layer, "ai-cleaned-transcript");
  assert.match(good.payload.sourceMaterial.originalText, /原始问答文本/);
  const invalid = await invokeDeep({ ...value, overallScore: 99 });
  assert.equal(invalid.writes.length, 0);
  assert.notEqual(invalid.status, 200);
  assert.match(invalid.body.error, /self-report/);
});

test("actual deep route treats missing originals as limited and guards changes to original evidence", async () => {
  const withoutOriginal = await invokeDeep(three(), { originalPresent: false });
  assert.equal(withoutOriginal.writes.length, 0);
  assert.match(withoutOriginal.body.error, /limited/);
  const limited = three();
  limited.evaluation.materialScope = "limited"; limited.evaluation.scoringEligible = false;
  limited.dimensions = Object.fromEntries(ASSESSMENT_DIMENSIONS.map(key => [key, unassessed()]));
  const local = await invokeDeep(limited, { originalPresent: false });
  assert.equal(local.status, 200, JSON.stringify(local.body));
  assert.equal(local.body.review.overallScore, null);
  assert.ok(Object.values(local.body.review.dimensions).every(d => d.score === null));
  assert.equal(local.payload.sourceMaterial.materialScopeLimit, "limited");
  const changed = await invokeDeep(three(), { changeOriginalDuringGeneration: true });
  assert.equal(changed.writes.length, 0);
  assert.match(changed.body.error, /原文或本人补充已更新/);
});
