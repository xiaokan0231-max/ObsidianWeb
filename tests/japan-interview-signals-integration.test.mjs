import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JAPAN_SIGNALS_VERSION, japanSignalsInstruction } from "../lib/japan-interview-signals.mjs";
import { ASSESSMENT_DIMENSIONS, computeAssessmentScores } from "../lib/assessment-scoring.mjs";
import { interviewDiagnosticInstruction } from "../.agents/skills/review-interview-answers/scripts/diagnostic-prompt.mjs";
import { carryOverSections, normalizeInterviewAnswerReview, parseInterviewAnswerReview, renderInterviewAnswerReview } from "../lib/review-deep.ts";
import { buildInterviewTrends, renderInterviewTrends } from "../lib/interview-trends.mjs";
import { readFile } from "node:fs/promises";

// 日本面试信号接入现有复盘链路的集成测试：Bridge 提示、正本规范化与渲染、校验器、复盘路由、跨场趋势、页面挂载。
// 契约本身的单元测试在 japan-interview-signals.test.mjs。

const ref = (blockId, ...sentenceIds) => ({ blockId, sentenceIds });

test("Bridge 提示与共享分析规则同源：只有回答质量任务要求信号", () => {
  const prompt = interviewDiagnosticInstruction("review_interview_answers");
  assert.ok(prompt.includes(japanSignalsInstruction()));
  assert.ok(!interviewDiagnosticInstruction("review_interview_advisory").includes("japanSignals"));
  assert.ok(!interviewDiagnosticInstruction("review_interview_insights").includes("japanSignals"));
});

const source = new Map([["q01", new Set(["s001"])], ["q02", new Set(["s002"])], ["q03", new Set(["s003"])]]);
const unassessed = () => ({ level: "not_assessed", baseScore: null, basisZh: "未受检验。", rationaleZh: "未受检验。", positiveEvidenceBlockIds: [], evidenceBlockIds: [], deductions: [] });
const assessed = () => ({ level: "supported", baseScore: 75, basisZh: "标准参考线。", rationaleZh: "限所引问题。", positiveEvidenceBlockIds: [], evidenceBlockIds: ["q01", "q02"], deductions: [] });
const selfSignals = () => ({
  motivation: { verdict: "poor", observationZh: "没有说出入社意欲。", fixZh: "收尾补一句志望。", evidence: [ref("q01", "s001")] },
  closing: { verdict: "mixed", observationZh: "只道谢。", fixZh: "道谢后表明意愿。", evidence: [ref("q03", "s003")] },
  concernRecovery: { verdict: "not_applicable", observationZh: "没有懸念。", fixZh: "", evidence: [] },
  unpromptedNegative: { verdict: "good", observationZh: "没有主动说负面。", fixZh: "", evidence: [ref("q02", "s002")] },
  registerConsistency: { verdict: "good", observationZh: "保持敬体。", fixZh: "", evidence: [ref("q02", "s002")] },
  salaryVisaLine: { verdict: "not_applicable", observationZh: "没谈到。", fixZh: "", evidence: [] },
  reverseQuestions: { verdict: "not_applicable", observationZh: "没有逆質問环节。", fixZh: "", evidence: [] },
});
const output = (signals = selfSignals()) => ({
  evaluationMode: "scored_evidence",
  evaluation: { conclusionZh: "按证据判断。", coverageZh: "完整文本。", limitsZh: "无原音。", scoringEligible: true, eligibilityZh: "三维可评。", materialScope: "full_available_text" },
  dimensions: Object.fromEntries(ASSESSMENT_DIMENSIONS.map((key) => [key, ["questionUnderstanding", "coverage", "directness"].includes(key) ? assessed() : unassessed()])),
  ...(signals ? { japanSignals: signals } : {}),
  overviewZh: "导读。", summaryZh: "摘要。", strengths: [], weaknesses: [], priorityBlockIds: [],
  blocks: [...source].map(([blockId, ids]) => ({ blockId, questionTitle: "测试问题", interviewerIntentZh: "核实", askedPoints: [], answeredPoints: [], missedPoints: [], comprehension: "clear", relevance: "direct", quality: "neutral", strategyTags: [], evidenceSentenceIds: [...ids], evaluationZh: "", improvementZh: "", improvedAnswerJa: "" })),
});
const meta = { company: "株式会社テスト", date: "2026-01-01", round: "一次面接", sourceName: "2026-01-01_一次面接_整理稿", annotationName: null };

test("新复盘把信号写进 JSON 正本与 Markdown，五维分数和总分不受影响，再生成不重复旧节", () => {
  const withSignals = normalizeInterviewAnswerReview(output(), { generatedAt: "2026-01-02T00:00:00Z", model: "test" }, source);
  const without = normalizeInterviewAnswerReview(output(null), { generatedAt: "2026-01-02T00:00:00Z", model: "test" }, source);
  assert.equal(withSignals.japanSignalsVersion, JAPAN_SIGNALS_VERSION);
  assert.equal(withSignals.japanSignals.closing.verdict, "mixed");
  assert.equal(without.japanSignals, undefined);
  assert.equal(without.japanSignalsVersion, undefined);
  assert.equal(withSignals.overallScore, without.overallScore);
  assert.deepEqual(withSignals.scoring, without.scoring);
  assert.deepEqual(computeAssessmentScores(withSignals).scoring, computeAssessmentScores(without).scoring);

  const markdown = renderInterviewAnswerReview(withSignals, meta);
  assert.match(markdown, /### 日本面试信号/);
  assert.match(markdown, /\*\*收尾表态：只有礼貌收尾\*\*（部分）只道谢。/);
  assert.match(markdown, /证据：q01\/s001/);
  assert.deepEqual(parseInterviewAnswerReview(markdown), withSignals);
  assert.doesNotMatch(renderInterviewAnswerReview(without, meta), /日本面试信号/, "旧报告不凭空长出信号节");
  assert.equal(carryOverSections(markdown).includes("日本面试信号"), false, "信号节由 JSON 重新渲染，不当人工追加内容带过去");
});

async function validate(review, args = []) {
  const directory = await mkdtemp(join(tmpdir(), "japan-signals-"));
  try {
    const reviewPath = join(directory, "review.json");
    const sourcePath = join(directory, "整理稿.md");
    await writeFile(reviewPath, JSON.stringify(review), "utf8");
    await writeFile(sourcePath, "## q01 志望\n- **s001｜私**\n\n## q02 経歴\n- **s002｜私**\n\n## q03 締め\n- **s003｜私**\n", "utf8");
    const result = spawnSync(process.execPath, [".agents/skills/review-interview-answers/scripts/validate-review.mjs", "--review", reviewPath, "--source", sourcePath, ...args], { encoding: "utf8" });
    return { status: result.status, report: JSON.parse(result.stdout || "{}"), stderr: result.stderr };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("校验器：旧报告缺信号只警告，--require-signals 判错；新报告逐项核证据和版本", async () => {
  const legacy = normalizeInterviewAnswerReview(output(null), { generatedAt: "2026-01-02T00:00:00Z", model: "test" }, source);
  const lenient = await validate(legacy, ["--method", "v3"]);
  assert.equal(lenient.status, 0, JSON.stringify(lenient.report));
  assert.ok(lenient.report.warnings.some((warning) => /legacy review has no Japan interview signals/.test(warning)));
  const strict = await validate(legacy, ["--method", "v3", "--require-signals"]);
  assert.equal(strict.status, 1);
  assert.ok(strict.report.errors.some((error) => /japanSignals is missing/.test(error)));

  const fresh = normalizeInterviewAnswerReview(output(), { generatedAt: "2026-01-02T00:00:00Z", model: "test" }, source);
  const accepted = await validate(fresh, ["--method", "v3", "--require-signals"]);
  assert.equal(accepted.status, 0, JSON.stringify(accepted.report));
  assert.equal(accepted.report.japanSignals, true);

  const wrong = structuredClone(fresh);
  wrong.japanSignals.motivation.evidence = [ref("q01", "s002")];
  delete wrong.japanSignalsVersion;
  const rejected = await validate(wrong, ["--method", "v3", "--require-signals"]);
  assert.equal(rejected.status, 1);
  assert.ok(rejected.report.errors.some((error) => /s002, which does not belong to q01/.test(error)));
  assert.ok(rejected.report.errors.some((error) => /japanSignalsVersion must be/.test(error)));
});

async function invokeDeep(result, { selfNotes = [] } = {}) {
  const { loadAppModule } = await import("./helpers/render-tsx.mjs");
  const notePath = "20_求職/株式会社テスト/2026-01-01_一次面接_整理稿.md";
  const originalPath = "20_求職/株式会社テスト/2026-01-01_一次面接_逐字稿.md";
  const content = "## q01 志望\n- **s001｜私**\n    - 正:: 御社で働きたいです。\n\n## q02 経歴\n- **s002｜私**\n    - 正:: 経歴をご説明します。\n\n## q03 締め\n- **s003｜面**\n    - 正:: 最後に何かありますか。\n- **s004｜私**\n    - 正:: 以上です。";
  const study = { frontmatter: { type: "transcript-study", company: "株式会社テスト", date: "2026-01-01", round: "一次面接", source_note: "[[2026-01-01_一次面接_逐字稿]]" }, content };
  const original = { frontmatter: { type: "transcript" }, content: "原始问答。" };
  const writes = [];
  let payload;
  const read = async (path) => path === notePath ? study : path === originalPath ? original : null;
  const { POST } = await loadAppModule("app/api/review/deep/route.ts", { stubs: {
    "@/lib/server/obsidian": { readNote: read, readNoteOrNull: read, readAllNotes: async () => selfNotes, writeNote: async (path, text) => { writes.push({ path, text }); } },
    "@/lib/server/codex-bridge": { invokeCodex: async (_task, input) => { payload = input; return { output: result, model: "test" }; } },
    "@/lib/server/interview-advisory": { interviewAdvisory: { generateSource: async () => { throw Error("顾问暂缓。"); } } },
  } });
  const response = await POST(new Request("http://localhost:3000/api/review/deep", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" }, body: JSON.stringify({ notePath }) }));
  return { status: response.status, body: await response.json(), writes, payload };
}

test("复盘路由只把写有年收或在留的 self 资料交给模型，并在写入前按话者核对信号", async () => {
  const self = (path, body, extra = {}) => ({ path, frontmatter: { type: "self", updated: "2026-01-01", ...extra }, content: body, tags: [], stat: { ctime: 0, mtime: 0, size: 0 } });
  const selfNotes = [
    self("10_自己/条件.md", "希望年収は面談で相談。在留は手続き中。"),
    self("10_自己/技術.md", "技術スタックの一覧。"),
    self("10_自己/旧条件.md", "旧い年収メモ。", { lifecycle: "archived" }),
    { ...self("20_求職/株式会社テスト/会社.md", "年収レンジ。"), frontmatter: { type: "company" } },
  ];
  const closingBySelf = { ...selfSignals(), closing: { ...selfSignals().closing, evidence: [ref("q03", "s004")] } };
  const good = await invokeDeep(output(closingBySelf), { selfNotes });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.deepEqual(good.payload.statedPositions.notes.map((note) => note.path), ["10_自己/条件.md"]);
  assert.match(good.payload.analysisBoundary.include, /整场日本面试信号/);
  assert.equal(good.body.review.japanSignalsVersion, JAPAN_SIGNALS_VERSION);
  assert.match(good.writes[0].text, /### 日本面试信号/);

  // q03 的 s003 是面试官的话：收尾判断必须引本人原句，模型引错就不写入。
  const bad = await invokeDeep(output(), { selfNotes });
  assert.notEqual(bad.status, 200, JSON.stringify(bad.body));
  assert.equal(bad.writes.length, 0);
  assert.match(bad.body.error, /日本面试信号无效.*closing/);

  const missing = await invokeDeep(output(null));
  assert.equal(missing.writes.length, 0);
  assert.match(missing.body.error, /japanSignals must be an object/);
});

const signals = (overrides = {}) => Object.fromEntries(["motivation", "closing", "concernRecovery", "unpromptedNegative", "registerConsistency", "salaryVisaLine", "reverseQuestions"].map((key) => [key, {
  verdict: overrides[key] ?? "not_applicable", observationZh: "观察。", fixZh: "", evidence: [],
}]));
const reviewWith = (verdicts) => ({ japanSignalsVersion: JAPAN_SIGNALS_VERSION, japanSignals: signals(verdicts) });

test("跨场趋势按场带上结果与信号，生成笔记里出现对照节；没有信号时只列结果", () => {
  const review = (extra = {}) => ({ generatedAt: "", model: "", overallScore: 80, summaryZh: "", strengths: [], weaknesses: [], priorityBlockIds: [], blocks: [], ...extra });
  const dimension = (score) => ({ score, rationaleZh: "", evidenceBlockIds: [] });
  const dimensions = { questionUnderstanding: dimension(90), coverage: dimension(70), directness: dimension(80), evidenceCredibility: dimension(85), riskControl: dimension(75) };
  const entries = (withSignals) => [
    { key: "x/2026-01-01_一次", company: "株式会社テスト", date: "2026-01-01", round: "一次", review: review({ dimensions }), outcome: { kind: "passed", label: "通过", detail: "", source: "next-round" } },
    { key: "x/2026-01-08_最終", company: "株式会社テスト", date: "2026-01-08", round: "最終", review: review({ dimensions, ...(withSignals ? reviewWith({ motivation: "poor", closing: "poor" }) : {}) }), outcome: { kind: "rejected", label: "不採用", detail: "", source: "job-case" } },
  ];
  const trends = buildInterviewTrends(entries(true));
  assert.equal(trends.interviews[0].signals, null, "旧复盘不能被当成全部做到");
  assert.equal(trends.interviews[1].signals.motivation.verdict, "poor");
  assert.equal(trends.signalOutcome.assessed, 1);
  assert.equal(trends.signalOutcome.comparable, 1);
  const without = buildInterviewTrends(entries(false));
  assert.deepEqual(trends.dimensionAverages, without.dimensionAverages, "信号不进五维平均");
  assert.deepEqual(trends.interviews.map((item) => item.overall), without.interviews.map((item) => item.overall));
  const markdown = renderInterviewTrends(trends);
  assert.match(markdown, /日本面试信号 × 选考结果/);
  assert.match(markdown, /\| 2026-01-01 \| 株式会社テスト \| 一次 \| 通过（次轮） \| — /);
  assert.match(markdown, /\| 2026-01-08 \| 株式会社テスト \| 最終 \| 不採用（案件） \| 没做到 \| 没做到 /);
});

test("复盘页把信号区块放在回答评价、对照表放在一覧；横向对照页也挂上对照表", async () => {
  const [reviewPage, insightsPage] = await Promise.all([readFile("app/interview-review.tsx", "utf8"), readFile("app/interview-insights.tsx", "utf8")]);
  const qualityPanel = reviewPage.slice(reviewPage.indexOf('hidden={panel !== "quality"}'));
  assert.ok(qualityPanel.indexOf("<JapanSignalsPanel") >= 0 && qualityPanel.indexOf("<JapanSignalsPanel") < qualityPanel.indexOf("<DeepReviewPanel"), "信号区块在回答评价面板里、五维报告之前");
  assert.match(reviewPage, /<SignalOutcomeTable comparison=\{signalOutcome\}/);
  assert.match(insightsPage, /<SignalOutcomeTable comparison=\{signalOutcome\} onSelect=\{onOpenReview\}/);
});
