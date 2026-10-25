import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAppModule } from "./helpers/render-tsx.mjs";
import { reviewDisplayScore, reviewScoreTimeline, historicalDimensionAverages } from "../lib/review-visual.ts";
import { interviewEvidenceScores, buildInterviewTrends } from "../lib/interview-trends.mjs";

const { InterviewReassessmentEntry, findInterviewReassessment } = await loadAppModule("app/interview-reassessment-entry.tsx");
const { default: InterviewReview, DeepReviewPanel } = await loadAppModule("app/interview-review.tsx", { stubs: { "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN" }) } } });
const keys = ["questionUnderstanding", "coverage", "directness", "evidenceCredibility", "riskControl"];
const sourcePath = "20_求職/株式会社テスト/2026-01-01_一次面接_整理稿.md";
const note = (path, frontmatter, content = "# 测试") => ({ path, name: path.split("/").at(-1), frontmatter, content, tags: [], stat: { mtime: 1, ctime: 1, size: 0 } });
const entry = (key, reassessment, review) => ({ key, company: "株式会社テスト", date: "2026-01-01", round: "一次面接", reassessment, review });
const fm = { type: "ai-report", report_kind: "interview-reassessment", report_role: "session", source_path: sourcePath, method_version: "2026-10-v3", evaluation_mode: "scored_evidence", generated_at: "2026-01-03", assessment_scope: "full_available_text", overall_score: 60, dimension_scores: { questionUnderstanding: 85, coverage: 50, directness: 85, evidenceCredibility: 75, riskControl: null }, historical_score: 95, eligibility: "完整文本且核心维度可评", scoring_formula: "已评维度均值，上限60", score_basis: ["覆盖：基准95（q02正证）−25（q01事件）=70；未恢复严重问题上限50，最终50"], local_scores: ["q02足够且已澄清，不扣分"], diagnostic_conclusion: "核心时段尚未交付", priority_issues: ["严重 · 未恢复 · q01 s001：核心时段未交付。下一步：先确认时期。"], dimension_evaluation: ["风险控制：未评估／证据不足"], material_limits: "没有原音，原因未知" };
const full = note("80_AI分析/面试重评/2026-10-v3/测试.md", fm);
const htmls = {};
const renderEntry = (name, notes, source = sourcePath) => htmls[name] = renderToStaticMarkup(createElement(InterviewReassessmentEntry, { notes, sourcePath: source, onOpenNote() {} }));
const oldReview = { generatedAt: "", model: "", overallScore: 95, dimensions: Object.fromEntries(keys.map(key => [key, { score: 95, rationaleZh: "旧判断", evidenceBlockIds: [], deductions: [] }])), summaryZh: "旧总结", strengths: [], weaknesses: [], priorityBlockIds: [], blocks: [] };

test("FM新评分优先旧复盘，分数与未恢复问题同屏，完整算式和正证保留", () => {
  assert.deepEqual(reviewDisplayScore(entry("current", full, oldReview)), { score: 60, label: "新版有据评分", historicalScore: 95 });
  const html = renderEntry("full", [full]);
  assert.match(html, /60 \/ 100/);
  assert.match(html, /历史旧分：95 \/ 100 · 不同口径，不能解读为能力涨跌/);
  assert.match(html, /严重 · 未恢复 · q01 s001/);
  assert.ok(html.indexOf("核心时段未交付") < html.indexOf("查看评价依据"));
  assert.match(html, /基准95（q02正证）−25（q01事件）=70；未恢复严重问题上限50，最终50/);
  assert.match(html, /<dt>风险控制<\/dt><dd>暂无法判断<\/dd>/);
});

test("有限材料保留可证局部评分；缺维度不借用旧95或补0/100，也不生成整场分", () => {
  const limited = note("80_AI分析/面试重评/2026-10-v3/有限.md", { ...fm, assessment_scope: "memory", historical_score: null, overall_score: 90, dimension_scores: { coverage: 75, directness: 85 }, score_basis: [], local_scores: ["q01：75，有限材料可证"] });
  const scores = interviewEvidenceScores(entry("limited", limited, oldReview));
  assert.equal(scores.overall, null);
  assert.equal(scores.dimensions.questionUnderstanding, null);
  assert.equal(scores.dimensions.coverage, 75);
  const html = renderEntry("limited", [limited]);
  assert.match(html, /现有材料不足以给整场评分/);
  assert.match(html, /<dt>覆盖完整度<\/dt><dd>75<\/dd>/);
  assert.match(html, /<dt>问题理解<\/dt><dd>暂无法判断<\/dd>/);
  assert.match(html, /q01：75，有限材料可证/);
  assert.match(html, /<ul aria-label="局部评分">/);
  assert.match(html, /查看评价依据/);
  assert.doesNotMatch(html, /新版总分：90|历史旧分/);
  const missing = note("80_AI分析/面试重评/2026-10-v3/缺证.md", { ...fm, dimension_scores: undefined, overall_score: 100 });
  assert.equal(reviewDisplayScore(entry("missing", missing, oldReview)).score, null);
  assert.ok(Object.values(interviewEvidenceScores(entry("missing", missing, oldReview)).dimensions).every(value => value === null));
});

test("v2和v3共存时入口、行动与全局严重问题只使用最新方法及每源最新报告", () => {
  const v2 = note("80_AI分析/面试重评/2026-10-v2/测试.md", { ...fm, method_version: "2026-10-v2", evaluation_mode: "evidence", generated_at: "2026-01-02", priority_issues: ["严重 · 未恢复 · 旧问题不能重复"] });
  const v3Earlier = note("80_AI分析/面试重评/2026-10-v3/较早.md", { ...fm, generated_at: "2026-01-02", priority_issues: ["严重 · 未恢复 · 同源早期不能重复"] });
  const index = note("80_AI分析/面试重评/2026-10-v3/index.md", { ...fm, report_role: "index" });
  const oldActions = note("old-actions.md", { ...fm, method_version: "2026-10-v2", report_role: "actions" });
  const earlierActions = note("earlier-actions.md", { ...fm, generated_at: "2026-01-02", report_role: "actions" });
  const latestActions = note("latest-actions.md", { ...fm, report_role: "actions" });
  const notes = [v2, v3Earlier, full, index, oldActions, earlierActions, latestActions];
  assert.equal(findInterviewReassessment(notes, sourcePath).path, full.path);
  const html = renderEntry("index", notes, null);
  const opened = [];
  const tree = InterviewReassessmentEntry({ notes, onOpenNote: n => opened.push(n.path) });
  function visit(element) {
    if (!element || typeof element !== "object") return;
    if (element.type === "button") element.props.onClick();
    for (const child of [element.props?.children].flat(Infinity)) visit(child);
  }
  visit(tree);
  assert.ok(opened.includes(latestActions.path));
  assert.ok(!opened.includes(oldActions.path) && !opened.includes(earlierActions.path));
  assert.match(html, /严重 · 未恢复 · q01 s001/);
  assert.doesNotMatch(html, /旧问题不能重复|同源早期不能重复/);
});

test("新版趋势只汇总新版可评分场次，旧高分与有限材料不成为新趋势点", () => {
  const second = note("80_AI分析/面试重评/2026-10-v3/第二.md", { ...fm, overall_score: 85, dimension_scores: Object.fromEntries(keys.map(key => [key, 85])) });
  const current = entry("current", full, oldReview);
  const newOnly = entry("new-only", second, null);
  const legacy = entry("legacy", null, oldReview);
  const limited = entry("limited", note("limited.md", { ...fm, assessment_scope: "memory" }), oldReview);
  assert.deepEqual(reviewScoreTimeline([legacy, current, newOnly, limited]).map(point => [point.key, point.score]), [["current", 60], ["new-only", 85]]);
  assert.deepEqual(historicalDimensionAverages([legacy, current, newOnly], "current"), Object.fromEntries(keys.map(key => [key, 85])));
  const trends = buildInterviewTrends([legacy, current, newOnly]);
  assert.equal(trends.interviews.find(item => item.key === "legacy").overall, null);
  assert.equal(trends.dimensionAverages.coverage, 68);
});

test("运行时有据账本保留严重性、恢复与正证，上限后的结果不能显示错误等式", () => {
  const review = { ...oldReview, evaluationMode: "scored_evidence", overallScore: 60, evaluation: { conclusionZh: "核心缺口", coverageZh: "全文", limitsZh: "无原音", materialScope: "full_available_text", scoringEligible: true }, scoring: { formulaZh: "均值经严重问题上限60", cap: 60, methodVersion: "2026-10-v3" }, dimensions: Object.fromEntries(keys.map(key => [key, { score: key === "riskControl" ? null : key === "coverage" ? 50 : 85, baseScore: key === "coverage" ? 95 : 85, level: key === "riskControl" ? "not_assessed" : "supported", rationaleZh: "可证判断", evidenceBlockIds: ["q01"], positiveEvidenceBlockIds: ["q02"], basisZh: key === "coverage" ? "95−25=70，上限50" : "正证参考线85", deductions: key === "coverage" ? [{ blockId: "q01", points: 25, severity: "major", recovery: "unresolved", labelZh: "时段漏答", detailZh: "核心时期未交付", fixZh: "确认时期后给职务", evidenceSentenceIds: ["s001"] }] : [] }])) };
  const html = htmls.runtime = renderToStaticMarkup(createElement(DeepReviewPanel, { review, queuedBlockIds: new Set(), feedbackByBlock: new Map(), practiceBusy: null, feedbackBusy: null, focusBlockId: null, focusDimension: null, onEvidenceClick() {}, onQueuePractice() {}, async onFeedback() { return true; } }));
  assert.match(html, /新版有据评分/);
  assert.match(html, /→ 上限后/);
  assert.match(html, /95−25=70，上限50/);
  assert.match(html, /未恢复/);
  assert.match(html, /正面依据/);
  assert.match(html, /s001/);
  assert.match(html, /本维未评估/);
  assert.doesNotMatch(html, /<span>100<\/span>/);
  const bounded = { ...review, dimensions: { ...review.dimensions, riskControl: { ...review.dimensions.riskControl, score: 100 } } };
  assert.equal(interviewEvidenceScores(entry("runtime", null, bounded)).dimensions.riskControl, null);
  assert.equal(interviewEvidenceScores(entry("limited-runtime", null, { ...review, evaluation: { ...review.evaluation, materialScope: "limited" } })).overall, null);
});

test("列表卡片读取新版FM分数，即使deepReview仍是历史旧报告", () => {
  const common = { company: "株式会社テスト", date: "2026-01-01", round: "一次面接" };
  const study = note(sourcePath, { ...common, type: "transcript-study" }, "# 整理稿\n## q01 テスト\n");
  const historical = note(sourcePath.replace("_整理稿", "_回答品質復盤"), { ...common, type: "interview-answer-review" }, "<!-- interview-answer-review-data -->\n```json\n" + JSON.stringify(oldReview) + "\n```\n");
  const html = htmls.cards = renderToStaticMarkup(createElement(InterviewReview, { notes: [study, historical, full], onVaultChanged() {}, onOpenEvidence() {}, onOpenInsights() {} }));
  assert.match(html, /新版有据评分/);
  assert.match(html, /60/);
  assert.match(html, /优先改进/);
  assert.match(html, /核心时段未交付/);
  assert.match(html, /下一步：先确认时期/);
  assert.match(html, /查看原文与评价/);
  assert.doesNotMatch(html, /q01 s001/, "一览保留可读摘要，编号在评价详情");
  assert.match(html, /<b>60<\/b><small>新版有据评分<\/small>/, "卡片用新版60而非旧95");
});

test("新版评分趋势与旧评分历史分别渲染，旧图默认折叠", () => {
  const makeRound = (day, report) => {
    const path = sourcePath.replace("2026-01-01", day);
    const common = { company: "株式会社テスト", date: day, round: "一次面接" };
    return [note(path, { ...common, type: "transcript-study" }, "# 整理稿\n## q01 テスト\n"), note(path.replace("_整理稿", "_回答品質復盤"), { ...common, type: "interview-answer-review" }, "<!-- interview-answer-review-data -->\n```json\n" + JSON.stringify(oldReview) + "\n```\n"), note("80_AI分析/面试重评/2026-10-v3/" + day + ".md", { ...report, source_path: path })];
  };
  const notes = [...makeRound("2026-01-01", fm), ...makeRound("2026-01-02", { ...fm, overall_score: 85, dimension_scores: Object.fromEntries(keys.map(key => [key, 85])) })];
  const html = htmls.trends = renderToStaticMarkup(createElement(InterviewReview, { notes, onVaultChanged() {}, onOpenEvidence() {}, onOpenInsights() {} }));
  assert.match(html, /aria-label="新版有据评分趋势"/);
  const listEnd = html.lastIndexOf('class="rv-company-round"');
  assert.ok(listEnd >= 0, "场次列表仍能打开复盘");
  assert.ok(html.indexOf("把不同公司的面谈放在一起看") > listEnd, "分析入口在场次列表之后");
  assert.ok(html.indexOf('aria-label="新版有据评分趋势"') > listEnd, "评分走势位于一览底部");
  assert.match(html, /<details><summary>旧评分历史（不同口径，不能比较能力涨跌）<\/summary>/);
  assert.doesNotMatch(html, /<details open/);
  const newSection = html.slice(html.indexOf('aria-label="新版有据评分趋势"'), html.indexOf('<details><summary>旧评分历史'));
  assert.match(newSection, /60/);
  assert.match(newSection, /85/);
  assert.doesNotMatch(newSection, /95 分|score:95/);
});

test.after(async () => {
  if (process.env.INTERVIEW_SSR_ARTIFACT) {
    await mkdir(new URL("./", "file://" + process.env.INTERVIEW_SSR_ARTIFACT), { recursive: true });
    await writeFile(process.env.INTERVIEW_SSR_ARTIFACT, JSON.stringify({ methodVersion: "2026-10-v3", fixtures: "fabricated-company-only", renders: htmls }, null, 2) + "\n");
  }
});
