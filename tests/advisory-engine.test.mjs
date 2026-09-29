import assert from "node:assert/strict";
import test from "node:test";
import { createAdvisoryEngine } from "../lib/server/advisory-engine.ts";
import { buildAdvisoryInput, advisoryFingerprint, INSIGHTS_PATH, ADVISORY_STATE_PATH } from "../lib/advisory-input.ts";
import { parseInterviewAnswerReview } from "../lib/review-deep.ts";
import { INSIGHT_MODULE_KEYS, mergeAdvisoryIntoReview } from "../lib/interview-advisory.ts";

const A = "20_求職/テスト/2026-01-01_一次面接_整理稿.md";
const B = "20_求職/サンプル/2026-01-01_一次面接_整理稿.md";
const reviewPath = (path) => path.replace("_整理稿", "_回答品質復盤");
const ref = (path) => ({ sourcePath: path, blockId: "q01", sentenceIds: ["s001", "s002"] });
function note(path, type, content, company = "株式会社テスト") {
  return { path, content, frontmatter: { type, company, date: "2026-01-01", round: "一次面接" }, tags: [], stat: { ctime: 0, mtime: 0, size: content.length } };
}
function source(path, company) {
  return note(path, "transcript-study", "## q01 経験\n\n- **s001｜面**\n    - 正:: 経験を教えてください。\n- **s002｜私**\n    - 正:: 開発経験があります。\n", company);
}
const core = { generatedAt: "2026-01-01T00:00:00Z", model: "old", overallScore: 87, summaryZh: "原评价", strengths: [], weaknesses: [], priorityBlockIds: [], blocks: [], unknownField: "保留" };
function review(path) { return note(reviewPath(path), "interview-answer-review", `## 全体評価\n\n旧正文\n\n<!-- interview-answer-review-data -->\n\`\`\`json\n${JSON.stringify(core)}\n\`\`\``); }
function advisory(path) {
  return { stage: "matching", commentaryZh: "公司在确认合作范围。", fitZh: "有相关开发经验。", recommendationZh: "进一步了解职责。", changeConditionsZh: "具体项目明确后再判断。", evidence: [ref(path)], contextPaths: [],
    observations: [{ id: "o1", titleZh: "职责确认", observationZh: "询问开发经验。", interpretationZh: "可能确认岗位适配。", alternativeZh: "也可能只是初步了解。", implicationZh: "准备对应案例。", evidence: [ref(path)], contextPaths: [] }], answerOptions: [], nextSteps: [] };
}
function insights() {
  return { overviewZh: "在相似问题中比较双方关注点。", modules: INSIGHT_MODULE_KEYS.map((key) => ({ key, titleZh: key, commentaryZh: "观察范围有限。", findings: key === "employerPriorities" ? [{ id: "i1", titleZh: "开发经验", bodyZh: "两场都询问经验。", boundaryZh: "不代表录用决定。", evidence: [ref(A), ref(B)], contextPaths: [] }] : [] })) };
}
function setup(invoke) {
  const notes = new Map([source(A, "株式会社テスト"), review(A), source(B, "株式会社サンプル"), review(B)].map((n) => [n.path, n]));
  const calls = [];
  const deps = { readAll: async () => [...notes.values()].map((n) => structuredClone(n)), read: async (path) => structuredClone(notes.get(path) ?? null),
    write: async (path, content) => { notes.set(path, { ...(notes.get(path) ?? note(path, path === INSIGHTS_PATH ? "interview-insights" : "interview-advisory-state", content)), content }); },
    invoke: async (task, payload) => { calls.push({ task, payload }); return { output: invoke ? await invoke(task, payload, notes) : task === "review_interview_advisory" ? advisory(payload.sourcePath) : insights(), model: "test" }; } };
  return { notes, calls, deps, engine: createAdvisoryEngine(deps) };
}

test("逐场补齐后统一生成横向；指纹去重、旧核心和未知字段保留", async () => {
  const { engine, notes, calls } = setup();
  const initial = await engine.state();
  assert.equal(initial.pending, true);
  assert.equal(initial.coverage.length, 2);
  assert.equal((await engine.generateInsights({ refreshSources: true })).done, false);
  assert.equal(notes.has(INSIGHTS_PATH), false);
  assert.equal((await engine.generateInsights({ refreshSources: true })).done, false);
  const final = await engine.generateInsights({ refreshSources: true });
  assert.equal(final.done, true);
  assert.equal(final.insightsStatus, "ready");
  assert.equal(final.pending, false);
  assert.equal(calls.length, 3);
  const { advisory: added, ...savedCore } = parseInterviewAnswerReview(notes.get(reviewPath(A)).content);
  assert.deepEqual(savedCore, core);
  assert.equal(added.stage, "matching");
  await engine.generateInsights({ refreshSources: true });
  await engine.generateSource(A);
  assert.equal(calls.length, 3);
});

test("无效引用拒绝落盘并保留旧报告；失败跨重启可见且不自动重试", async () => {
  const { engine, notes, deps, calls } = setup((_task, payload) => ({ ...advisory(payload.sourcePath), evidence: [{ ...ref(payload.sourcePath), sentenceIds: ["s999"] }] }));
  const before = notes.get(reviewPath(A)).content;
  await assert.rejects(engine.generateSource(A), /不属于/);
  assert.equal(notes.get(reviewPath(A)).content, before);
  assert.ok(notes.has(ADVISORY_STATE_PATH));
  const restarted = createAdvisoryEngine(deps);
  assert.match((await restarted.sourceState(A)).lastError, /不属于/);
  await assert.rejects(restarted.generateSource(A), /请点击重试/);
  assert.equal(calls.length, 1);
});

test("同一来源并发只调用一次模型，生成时事实改变不覆盖旧稿", async () => {
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const { engine, notes, calls } = setup(async (_task, payload) => { await gate; return advisory(payload.sourcePath); });
  const first = engine.generateSource(A);
  const second = engine.generateSource(A);
  while (!calls.length) await new Promise((resolve) => setImmediate(resolve));
  notes.get(A).content += "\n- **s003｜私**\n    - 正:: 補足です。\n";
  finish();
  const results = await Promise.allSettled([first, second]);
  assert.equal(calls.length, 1);
  assert.ok(results.every((result) => result.status === "rejected" && /依据已更新/.test(result.reason.message)));
  assert.equal(parseInterviewAnswerReview(notes.get(reviewPath(A)).content).advisory, undefined);
  const current = await engine.sourceState(A);
  assert.equal(current.pending, true);
  assert.equal(current.lastError, undefined);
});

test("本人反馈和后续企业事实使相关顾问层失效；统计/旧评分不构成循环输入", async () => {
  const { engine, notes } = setup();
  await engine.generateSource(A);
  await engine.generateSource(B);
  const initial = await advisoryFingerprint(buildAdvisoryInput([...notes.values()], A).payload);
  notes.get(reviewPath(A)).content = notes.get(reviewPath(A)).content.replace('"overallScore": 87', '"overallScore": 91');
  assert.equal(await advisoryFingerprint(buildAdvisoryInput([...notes.values()], A).payload), initial);
  const feedbackPath = A.replace("_整理稿", "_回答品質批注");
  notes.set(feedbackPath, note(feedbackPath, "interview-answer-feedback", "- **f001｜q01｜context｜2026-01-02**\n    - 我:: 我愿意考虑这个工作方式。\n"));
  assert.equal((await engine.sourceState(A)).status, "stale");
  assert.equal((await engine.sourceState(B)).status, "ready");
  await engine.generateSource(A);
  const outcome = note("20_求職/テスト/案件.md", "job-case", "企业于次日明确安排第二轮。", "株式会社テスト");
  notes.set(outcome.path, outcome);
  assert.equal((await engine.sourceState(A)).status, "stale");
  assert.equal((await engine.sourceState(B)).status, "ready");
});

test("未裁定来源单列为blocked，不调用模型也不拿未知作失败结论", async () => {
  const { engine, notes, calls } = setup();
  notes.get(A).content = notes.get(A).content.replace("s001｜面", "s001｜面?");
  const before = await engine.state();
  assert.equal(before.coverage.find((entry) => entry.sourcePath === A).status, "blocked");
  await assert.rejects(engine.generateSource(A), /裁定/);
  assert.equal(calls.length, 0);
  await engine.generateInsights({ refreshSources: true });
  const final = await engine.generateInsights({ refreshSources: true });
  assert.equal(final.insightsStatus, "blocked");
  assert.equal(final.report, null);
  assert.equal(calls.length, 1);
});

test("force单场刷新必须回读新值，相同输入指纹不能掩盖静默写失败", async () => {
  let generation = 0;
  const { engine, notes, deps } = setup((_task, payload) => ({ ...advisory(payload.sourcePath), commentaryZh: `第${++generation}版判断` }));
  await engine.generateSource(A);
  const before = notes.get(reviewPath(A)).content;
  const write = deps.write;
  deps.write = async (path, content) => {
    if (path !== reviewPath(A)) await write(path, content);
  };
  await assert.rejects(engine.generateSource(A, true), /保存后回读不一致/);
  assert.equal(notes.get(reviewPath(A)).content, before);
  assert.equal(parseInterviewAnswerReview(before).advisory.commentaryZh, "第1版判断");
  assert.equal(generation, 2);
});

test("force横向刷新必须回读新全文，旧报告的同一指纹不能冒充保存成功", async () => {
  let generation = 0;
  const { engine, notes, deps } = setup((task, payload) => task === "review_interview_advisory" ? advisory(payload.sourcePath)
    : { ...insights(), overviewZh: `第${++generation}版横向观察` });
  await engine.generateSource(A);
  await engine.generateSource(B);
  await engine.generateInsights();
  const before = notes.get(INSIGHTS_PATH).content;
  const write = deps.write;
  deps.write = async (path, content) => {
    if (path !== INSIGHTS_PATH) await write(path, content);
  };
  await assert.rejects(engine.generateInsights({ force: true }), /保存后回读不一致/);
  assert.equal(notes.get(INSIGHTS_PATH).content, before);
  assert.equal(generation, 2);
});

test("横向拒绝猜中原稿里存在但本次模型未见的问题句", async () => {
  const { engine, notes, calls } = setup((task, payload) => {
    if (task === "review_interview_advisory") return advisory(payload.sourcePath);
    const result = insights();
    result.modules[0].findings[0].evidence[0] = { sourcePath: A, blockId: "q02", sentenceIds: ["s003"] };
    return result;
  });
  notes.get(A).content += "\n## q02 未引用的话题\n- **s003｜私**\n    - 正:: 今回の横断入力には渡していません。\n";
  await engine.generateSource(A);
  await engine.generateSource(B);
  await assert.rejects(engine.generateInsights(), /不存在的来源或问题/);
  const input = calls.find((call) => call.task === "review_interview_insights").payload.interviews.find((item) => item.sourcePath === A);
  assert.deepEqual(input.blocks.map((block) => block.id), ["q01"]);
  assert.equal(notes.has(INSIGHTS_PATH), false);
});

test("生成期间新增的人工复核顾问版本不能被同指纹旧任务覆盖", async () => {
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const { engine, notes, calls } = setup(async (_task, payload) => { await gate; return advisory(payload.sourcePath); });
  const running = engine.generateSource(A);
  while (!calls.length) await new Promise((resolve) => setImmediate(resolve));
  const reviewed = {
    ...advisory(A), version: 1, generatedAt: "2026-01-02T00:00:00Z", model: "reviewed",
    sourceFingerprint: await advisoryFingerprint(buildAdvisoryInput([...notes.values()], A).payload),
    commentaryZh: "此版本已经人工复核。",
  };
  const latest = mergeAdvisoryIntoReview(notes.get(reviewPath(A)).content, reviewed);
  notes.get(reviewPath(A)).content = latest;
  finish();
  await assert.rejects(running, /已由其他操作更新/);
  assert.equal(notes.get(reviewPath(A)).content, latest);
  assert.deepEqual(parseInterviewAnswerReview(latest).advisory, reviewed);
  const state = await engine.sourceState(A);
  assert.equal(state.status, "ready");
  assert.equal(state.lastError, undefined);
});

test("记忆重构的来源限制同时透传到单场和横向模型，并参与指纹", async () => {
  const { engine, notes, calls } = setup();
  notes.get(A).frontmatter.reconstruction = "memory";
  notes.get(A).frontmatter.verbatim = false;
  await engine.generateSource(A);
  await engine.generateSource(B);
  await engine.generateInsights();
  const single = calls.find((call) => call.task === "review_interview_advisory" && call.payload.sourcePath === A).payload;
  const cross = calls.find((call) => call.task === "review_interview_insights").payload;
  assert.equal(single.provenance.reconstruction, "memory");
  assert.equal(single.provenance.verbatim, false);
  assert.match(single.provenance.boundary, /不作逐字原话、语速或措辞证据/);
  assert.deepEqual(cross.interviews.find((item) => item.sourcePath === A).provenance, single.provenance);
  assert.equal(cross.interviews.find((item) => item.sourcePath === B).provenance, undefined);
  notes.get(A).frontmatter.reconstruction = "memory-with-new-confirmation";
  assert.equal((await engine.sourceState(A)).status, "stale");
  assert.equal((await engine.sourceState(B)).status, "ready");
});
