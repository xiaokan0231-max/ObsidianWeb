import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, mkdir, writeFile, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  INSIGHT_MODULE_KEYS,
  mergeAdvisoryIntoReview,
  mergeInterviewInsights,
  normalizeInterviewAdvisory,
  normalizeInterviewInsights,
  parseInterviewInsights,
  renderInterviewInsights,
  validateInterviewAdvisory,
} from "../lib/interview-advisory.ts";
import { carryOverSections, parseInterviewAnswerReview, renderInterviewAnswerReview } from "../lib/review-deep.ts";

const SOURCE = "20_求職/株式会社テスト/2026-01-01_一次面接_整理稿.md";
const OTHER = "20_求職/株式会社サンプル/2026-01-01_一次面接_整理稿.md";
const CONTEXT = "20_求職/_素材/技術スタック.md";
const META = { generatedAt: "2026-01-02T00:00:00.000Z", model: "test-model", sourceFingerprint: "test-fingerprint" };
const evidence = [{ sourcePath: SOURCE, blockId: "q01", sentenceIds: ["s001", "s002"] }];
const context = {
  sources: new Map([[SOURCE, new Map([["q01", new Set(["s001", "s002"])]] )], [OTHER, new Map([["q02", new Set(["s003"])]] )]]),
  contextPaths: new Set([CONTEXT]),
};
function rawAdvisory() {
  return {
    stage: "matching", commentaryZh: "双方在确认可合作条件。", fitZh: "技术方向初步相符。",
    recommendationZh: "等待具体项目。", changeConditionsZh: "收到明确下一步后更新判断。",
    evidence, contextPaths: [CONTEXT],
    observations: [{ id: "o01", titleZh: "继续匹配", observationZh: "对方说会寻找项目。", interpretationZh: "有条件的推进意愿。", alternativeZh: "也可能尚未确定可匹配项目。", implicationZh: "尚无下一轮。", evidence, contextPaths: [] }],
    answerOptions: [{ id: "a01", titleZh: "明确工作方式", situationZh: "对方确认团队参与方式时。", whyZh: "先给结论便于匹配。", answerJa: "お客様のチームで働くことも考えています。", scope: "company", evidence, contextPaths: [] }],
    nextSteps: [{ id: "n01", titleZh: "确认任务", detailZh: "了解实际职责与团队。", triggerZh: "对方给出具体项目时。", evidence, contextPaths: [] }],
  };
}
function advisory() { return normalizeInterviewAdvisory(rawAdvisory(), META, context); }
function rawInsights() {
  return {
    overviewZh: "两场均涉及工作方式，但所处阶段不同。",
    modules: INSIGHT_MODULE_KEYS.map((key, index) => ({
      key, titleZh: key, commentaryZh: index === 0 ? "当前证据支持比较。" : "暂缺可比较的证据。",
      findings: index === 0 ? [{ id: "i01", titleZh: "职责确认", bodyZh: "两次都询问了希望职责。", boundaryZh: "不能由提问次数推出录用意向。", evidence: [...evidence, { sourcePath: OTHER, blockId: "q02", sentenceIds: ["s003"] }], contextPaths: [] }] : [],
    })),
  };
}

test("横向更新保留生成区外人工内容和自定义元数据，异常标记拒绝覆盖", () => {
  const original = normalizeInterviewInsights(rawInsights(), META, context);
  const content = renderInterviewInsights(original).replace("schema_version: 1", "schema_version: 1\npersonal_tag: keep") + "\n## 本人补充\n这段需要保留。\n";
  const next = { ...original, generatedAt: "2026-01-03T00:00:00Z", overviewZh: "最新判断" };
  const merged = mergeInterviewInsights(content, next);
  assert.match(merged, /personal_tag: keep/);
  assert.match(merged, /本人补充\n这段需要保留/);
  assert.deepEqual(parseInterviewInsights(merged), next);
  assert.equal(mergeInterviewInsights(merged, next), merged);
  assert.throws(() => mergeInterviewInsights(content.replace("<!-- interview-insights:end -->", ""), next), /生成区/);
});

test("顾问与横向洞察严格验证路径、q/s归属和背景来源，不静默删证据", () => {
  const valid = advisory();
  assert.equal(valid.version, 1);
  assert.equal(valid.sourceFingerprint, META.sourceFingerprint);
  assert.deepEqual(valid.observations[0].evidence, evidence);
  const wrongSentence = rawAdvisory();
  wrongSentence.observations[0].evidence = [{ sourcePath: SOURCE, blockId: "q01", sentenceIds: ["s003"] }];
  assert.throws(() => normalizeInterviewAdvisory(wrongSentence, META, context), /不属于/);
  const wrongPath = rawAdvisory();
  wrongPath.evidence = [{ sourcePath: "2026-01-01_一次面接_整理稿.md", blockId: "q01", sentenceIds: ["s001"] }];
  assert.throws(() => normalizeInterviewAdvisory(wrongPath, META, context), /完整/);
  const unknownContext = rawAdvisory();
  unknownContext.contextPaths = ["20_求職/不存在.md"];
  assert.throws(() => normalizeInterviewAdvisory(unknownContext, META, context), /未提供/);
  const duplicate = rawAdvisory();
  duplicate.nextSteps[0].id = "o01";
  assert.throws(() => normalizeInterviewAdvisory(duplicate, META, context), /重复/);
  const noAlternative = rawAdvisory();
  noAlternative.observations[0].alternativeZh = null;
  assert.throws(() => normalizeInterviewAdvisory(noAlternative, META, context), /alternativeZh/);
  const unnecessaryRewrite = rawAdvisory();
  unnecessaryRewrite.observations[0].alternativeZh = "";
  unnecessaryRewrite.answerOptions[0].answerJa = "";
  assert.doesNotThrow(() => normalizeInterviewAdvisory(unnecessaryRewrite, META, context));
});

test("横向五模块不可缺少，一场或同一文件两句不构成跨场证据", () => {
  const result = normalizeInterviewInsights(rawInsights(), META, context);
  assert.deepEqual(parseInterviewInsights(renderInterviewInsights(result)), result);
  const missing = rawInsights();
  missing.modules.pop();
  assert.throws(() => normalizeInterviewInsights(missing, META, context), /五个模块/);
  const single = rawInsights();
  single.modules[0].findings[0].evidence = evidence;
  assert.throws(() => normalizeInterviewInsights(single, META, context), /两个不同场次/);
  const duplicateModule = rawInsights();
  duplicateModule.modules[1].key = duplicateModule.modules[0].key;
  assert.throws(() => normalizeInterviewInsights(duplicateModule, META, context), /重复横向模块/);
});

test("只补顾问层不改旧分数、JSON未知字段、原逐题文本和手写章节", () => {
  const original = {
    generatedAt: "2025-01-01T00:00:00Z", model: "old", overallScore: 83,
    summaryZh: "旧评分摘要。", strengths: ["旧强项"], weaknesses: [], priorityBlockIds: [],
    blocks: [], legacyExtension: { keep: true, exactScore: 82.6 },
  };
  const prefix = "---\ntype: interview-answer-review\ncustom: keep\n---\n# 原标题\n\n## 全体評価\n\n原评分正文 83。\n\n## 人工补充\n\n必须逐字保留。\n\n## q01 原题\n\n旧回答。\n\n";
  const source = `${prefix}<!-- interview-answer-review-data -->\n\`\`\`json\n${JSON.stringify(original)}\n\`\`\`\n尾部保留\n`;
  const merged = mergeAdvisoryIntoReview(source, advisory());
  const parsed = parseInterviewAnswerReview(merged);
  const { advisory: added, ...core } = parsed;
  assert.deepEqual(core, original);
  assert.deepEqual(added, advisory());
  assert.ok(merged.includes("## 人工补充\n\n必须逐字保留。\n\n## q01 原题\n\n旧回答。"));
  assert.ok(merged.startsWith("---\ntype: interview-answer-review\ncustom: keep\n---"));
  assert.ok(merged.endsWith("尾部保留\n"));
  const updated = { ...advisory(), commentaryZh: "更新顾问判断。" };
  const second = mergeAdvisoryIntoReview(merged, updated);
  assert.equal(second.split("<!-- interview-advisory:start -->").length, 2);
  assert.doesNotMatch(second, /双方在确认可合作条件。/);
  assert.equal(parseInterviewAnswerReview(second).overallScore, 83);
  assert.throws(() => mergeAdvisoryIntoReview(source.replace("## 全体評価", "<!-- interview-advisory:start -->\n## 全体評価"), advisory()), /不完整/);
});

test("回答质量重生成保留顾问JSON一次并保留未知前置章节", () => {
  const review = { generatedAt: META.generatedAt, model: "new", overallScore: 92, summaryZh: "新评分。", strengths: [], weaknesses: [], priorityBlockIds: [], blocks: [] };
  const previous = mergeAdvisoryIntoReview(`## 全体評価\n\n旧评价。\n\n## 人工补充\n\n留存。\n\n<!-- interview-answer-review-data -->\n\`\`\`json\n${JSON.stringify(review)}\n\`\`\``, advisory());
  const kept = carryOverSections(previous);
  assert.match(kept, /人工补充/);
  assert.doesNotMatch(kept, /顾问视角|继续匹配/);
  const regenerated = renderInterviewAnswerReview(review, { company: "株式会社テスト", date: "2026-01-01", round: "一次面接", sourceName: "源稿", annotationName: null, carriedSections: kept, preservedAdvisory: advisory() });
  assert.deepEqual(parseInterviewAnswerReview(regenerated).advisory, advisory());
  assert.equal(regenerated.split("<!-- interview-advisory:start -->").length, 2);
  assert.match(regenerated, /人工补充/);
  validateInterviewAdvisory(parseInterviewAnswerReview(regenerated).advisory, context);
});

test("skill独立校验器副本与Web契约保持同值", async () => {
  for (const filename of ["interview-advisory.ts", "interview-advisory-contract.mjs"]) {
    assert.equal(await readFile(`.agents/skills/review-interview-answers/scripts/${filename}`, "utf8"), await readFile(`lib/${filename}`, "utf8"), `${filename} 的独立技能副本需要同步`);
  }
});

test("独立校验器搬离仓库后仍验证跨场引用，并拒绝错误归属", async () => {
  const dir = await mkdtemp(join(tmpdir(), "interview-advisory-test-"));
  try {
    const scripts = join(dir, "skill");
    await mkdir(scripts);
    for (const file of ["validate-review.mjs", "review-contract.mjs", "interview-advisory.ts", "interview-advisory-contract.mjs"]) {
      await copyFile(`.agents/skills/review-interview-answers/scripts/${file}`, join(scripts, file));
    }
    const vault = join(dir, "vault");
    for (const [path, content] of [[SOURCE, "## q01 体制\n- **s001｜面**\n- **s002｜私**\n"], [OTHER, "## q02 希望\n- **s003｜私**\n"], [CONTEXT, "# 確認済み事実\n"]]) {
      await mkdir(dirname(join(vault, path)), { recursive: true });
      await writeFile(join(vault, path), content);
    }
    const output = join(dir, "insights.json");
    const valid = normalizeInterviewInsights(rawInsights(), META, context);
    await writeFile(output, JSON.stringify(valid));
    const run = () => spawnSync(process.execPath, [join(scripts, "validate-review.mjs"), "--review", output, "--vault", vault], { encoding: "utf8", cwd: dir });
    const accepted = run();
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
    assert.equal(JSON.parse(accepted.stdout).kind, "interview-insights");
    valid.modules[0].findings[0].evidence[1].sentenceIds = ["s001"];
    await writeFile(output, JSON.stringify(valid));
    const rejected = run();
    assert.equal(rejected.status, 1);
    assert.match(rejected.stdout, /不属于/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
