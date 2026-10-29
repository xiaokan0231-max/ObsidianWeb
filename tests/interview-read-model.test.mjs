import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildInterviewReadModelRecords, INTERVIEW_RECORDS, interviewBlockKey } from "../lib/interview-read-model.ts";
import { interviewQuery, InterviewRevisionError } from "../lib/server/interview-read-model.ts";
import { computeStats, parseSeirikou } from "../lib/review.ts";
import { joinReviewNotes } from "../lib/review-join.ts";
import { normalizeInterviewAnswerReview, renderInterviewAnswerReview } from "../lib/review-deep.ts";
import { loadAppModule } from "./helpers/render-tsx.mjs";

const today = "2026-10-29";
const note = (path, frontmatter, content = "") => ({ path, frontmatter, content, tags: [], stat: { ctime: 0, mtime: 1, size: content.length } });
const root = "20_求職/株式会社テスト";
const study = (name, round = "一次面接", content = "## q01 経験\n- **s001｜私**\n    - 正:: 開発を担当しました。\n") => note(`${root}/${name}_整理稿.md`, {
  type: "transcript-study", company: "株式会社テスト", date: "2026-10-28", round,
}, content);
const key = (kind, path) => JSON.stringify([kind, path]);
function reader(records, revision = "r1") {
  const index = new Map(records.map((record) => [key(record.kind, record.key), record.value]));
  return { async readRecord(version, kind, path) { return version === revision ? index.get(key(kind, path)) ?? null : null; } };
}
const record = (records, kind, path) => records.find((item) => item.kind === kind && item.key === path)?.value;

test("本场依赖只包含明确案件、当前准备稿、对照稿和实际嵌入的共用素材", () => {
  const caseA = note(`${root}/岗位A/案件.md`, { type: "job-case", company: "株式会社テスト", case_id: "test-a", status: "面接中" });
  const caseB = note(`${root}/岗位B/案件.md`, { type: "job-case", company: "株式会社テスト", case_id: "test-b", status: "面接中" });
  const asset = note("20_求職/_素材/共有.md", { type: "material" }, "## 台本\n![[20_求職/_素材/参照]]\n");
  const child = note("20_求職/_素材/参照.md", { type: "material" }, "本人已确认的材料。\n");
  const prepA = note(`${root}/岗位A/准备.md`, { type: "interview-prep", company: "株式会社テスト", case: `[[${caseA.path}]]`, date: today, round: "一次面接" }, "# 面谈准备\n\n## 1. 要点\n![[20_求職/_素材/共有#台本]]\n");
  const prepB = note(`${root}/岗位B/准备.md`, { type: "interview-prep", company: "株式会社テスト", case: `[[${caseB.path}]]`, date: today, round: "一次面接" }, "# 另一岗位\n\n## 1. 要点\n其他岗位的准备。\n");
  const replay = note(`${root}/岗位A/对照.md`, { type: "interview-prep-replay", company: "株式会社テスト", replay_of: `[[${prepA.path.replace(/\.md$/, "")}]]`, prep_version: 2 }, "# 对照稿\n");
  const records = buildInterviewReadModelRecords([caseA, caseB, prepA, prepB, replay, asset, child], { today });
  const context = record(records, INTERVIEW_RECORDS.context, prepA.path);
  assert.deepEqual(new Set(context.paths), new Set([caseA.path, prepA.path, asset.path, child.path, replay.path]));
  assert.equal(context.contextPath, caseA.path);
  assert.ok(!context.paths.includes(prepB.path));
  const catalog = record(records, INTERVIEW_RECORDS.catalog, "root");
  assert.equal(catalog.preps.length, 2);
  assert.equal(catalog.preps.find((item) => item.path === prepB.path).contextPath, caseB.path);
  assert.equal(Object.hasOwn(catalog.preps[0], "content"), false);
});

test("长整理稿按问题保存，初始目录与统计不携带逐字稿正文", async () => {
  const longText = "正文专属标记" + "あ".repeat(800_000);
  const source = study("长稿", "一次面接", `## q01 経験\n- **s001｜私**\n    - 正:: ${longText}\n    - 誤1:: 誤り｜学習者｜型:: 助詞\n\n## q02 条件\n- **s002｜面**\n    - 正:: ご希望を教えてください。\n`);
  const records = buildInterviewReadModelRecords([source], { today });
  const catalog = record(records, INTERVIEW_RECORDS.catalog, "root");
  const projection = record(records, INTERVIEW_RECORDS.review, source.path);
  assert.ok(Buffer.byteLength(JSON.stringify(catalog)) < 100_000);
  assert.ok(Buffer.byteLength(JSON.stringify(projection)) < 100_000);
  assert.doesNotMatch(JSON.stringify(projection), /正文专属标记/);
  assert.equal(Object.hasOwn(projection.source, "content"), false);
  assert.deepEqual(projection.stats, { ...computeStats(parseSeirikou(source.content).sentences), patterns: [...computeStats(parseSeirikou(source.content).sentences).patterns] });
  const result = await interviewQuery(reader(records), "r1", new URL(`http://localhost/api/interview/review?${new URLSearchParams({ path: source.path, block: "q01" })}`));
  assert.equal(result.block.sourcePath, source.path);
  assert.equal(result.block.block.sentences[0].id, "s001");
  assert.equal(result.block.block.sentences[0].sei, longText);
  assert.equal(record(records, INTERVIEW_RECORDS.block, interviewBlockKey(source.path, "q02")).block.id, "q02");
});

test("质量目录与逐题评价分开，来源、评分和证据标识沿用原解析器", () => {
  const source = study("评分");
  const quality = normalizeInterviewAnswerReview({ overallScore: 72, summaryZh: "保持原有评分。", strengths: ["经验"], weaknesses: ["例证"], priorityBlockIds: ["q01"], blocks: [{
    blockId: "q01", questionTitle: "経験", interviewerIntentZh: "确认经验", askedPoints: ["経験"], answeredPoints: [], missedPoints: ["例证"],
    comprehension: "understood", relevance: "partial", quality: "weak", strategyTags: [], evidenceSentenceIds: ["s001"],
    evaluationZh: "逐题评价原文", improvementZh: "具体改进", improvedAnswerJa: "改善回答の本文。",
  }] }, { generatedAt: "2026-10-28T00:00:00Z", model: "test-model" }, new Map([["q01", new Set(["s001"])]]));
  const report = note(`${root}/评分_回答品质.md`, { type: "interview-answer-review", company: "株式会社テスト", date: "2026-10-28", round: "一次面接" }, renderInterviewAnswerReview(quality, {
    company: "株式会社テスト", date: "2026-10-28", round: "一次面接", sourceName: source.path, annotationName: "批注",
  }));
  const records = buildInterviewReadModelRecords([source, report], { today });
  const section = record(records, INTERVIEW_RECORDS.section, interviewBlockKey(source.path, "quality"));
  assert.equal(section.review.overallScore, quality.overallScore);
  assert.equal(section.blocks[0].missedCount, 1);
  assert.doesNotMatch(JSON.stringify(section), /逐题评价原文|改善回答の本文/);
  const block = record(records, INTERVIEW_RECORDS.section, interviewBlockKey(source.path, "q01"));
  assert.deepEqual(block, quality.blocks[0]);
  assert.deepEqual(block.evidenceSentenceIds, ["s001"]);
});

test("同公司同日多轮保持独立，旧版本不可用时拒绝拼接", async () => {
  const first = study("一面");
  const second = study("二面", "二次面接");
  const records = buildInterviewReadModelRecords([first, second], { today });
  const catalog = await interviewQuery(reader(records), "r1", new URL("http://localhost/api/interview/catalog?view=review"));
  assert.deepEqual(catalog.catalog.reviews.map((item) => item.path), [first.path, second.path]);
  assert.deepEqual(catalog.catalog.pickerGroups, []);
  const secondProjection = await interviewQuery(reader(records), "r1", new URL(`http://localhost/api/interview/review?${new URLSearchParams({ path: second.path })}`));
  assert.equal(secondProjection.review.source.round, "二次面接");
  await assert.rejects(interviewQuery(reader(records), "expired", new URL("http://localhost/api/interview/catalog")), InterviewRevisionError);
});

test("逐题请求复用同版本目录，版本间隔离并只保留最近三版，失败后可重试", async () => {
  const source = study("目录缓存");
  const records = buildInterviewReadModelRecords([source], { today });
  const catalog = record(records, INTERVIEW_RECORDS.catalog, "root");
  const block = record(records, INTERVIEW_RECORDS.block, interviewBlockKey(source.path, "q01"));
  const reads = new Map();
  let recover = false;
  const model = { async readRecord(revision, kind) {
    if (kind !== INTERVIEW_RECORDS.catalog) return block;
    reads.set(revision, (reads.get(revision) ?? 0) + 1);
    return revision === "failed" && !recover ? null : catalog;
  } };
  const url = new URL(`http://localhost/api/interview/review?${new URLSearchParams({ path: source.path, block: "q01" })}`);
  await Promise.all([interviewQuery(model, "r1", url), interviewQuery(model, "r1", url), interviewQuery(model, "r1", url)]);
  assert.equal(reads.get("r1"), 1);
  for (const revision of ["r2", "r3", "r4"]) await interviewQuery(model, revision, url);
  assert.equal(reads.get("r2"), 1);
  await interviewQuery(model, "r1", url);
  assert.equal(reads.get("r1"), 2);
  await assert.rejects(interviewQuery(model, "failed", url), InterviewRevisionError);
  recover = true;
  await interviewQuery(model, "failed", url);
  assert.equal(reads.get("failed"), 2);
});

test("接口先由运行时拒绝过期版本，不能借目录缓存越过版本保护", async () => {
  let requested;
  const { interviewGET } = await loadAppModule("app/api/interview/query.ts", { stubs: {
    "@/app/read-model-server": {
      async readModelRuntime(revision) { requested = revision; throw Object.assign(new Error("资料版本已过期"), { status: 409 }); },
      readModelFailure(error) { return Response.json({ error: error.message }, { status: error.status }); },
    },
  } });
  const response = await interviewGET(new Request("http://localhost/api/interview/review?revision=expired&path=20_求職/测试.md&block=q01"));
  assert.equal(requested, "expired");
  assert.equal(response.status, 409);
});

test("数百个案件的首屏目录与选择器每页均低于100KB，完整总数和已选路径保留", async () => {
  const notes = Array.from({ length: 345 }, (_, index) => note(`20_求職/测试${index}/案件.md`, {
    type: "job-case", company: `株式会社テスト${index}`, case_id: `fictional-${index}`,
    status: "不採用（" + "测试状态说明。".repeat(12) + "）",
  }, `# 株式会社テスト${index} — 测试岗位\n`));
  const records = buildInterviewReadModelRecords(notes, { today });
  const model = reader(records);
  for (const view of ["session", "insights"]) {
    const params = new URLSearchParams({ view, contextPath: notes.at(-1).path });
    params.append("selected", notes.at(-1).path);
    const page = await interviewQuery(model, "r1", new URL(`http://localhost/api/interview/catalog?${params}`));
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 100_000, view);
    assert.equal(page.catalog.comparisonTotal, 345);
    assert.equal(page.catalog.pickerTotal, 345);
    if (view === "session") assert.ok(page.catalog.pickerGroups.flatMap((group) => group.items).some((item) => item.id === `context:${notes.at(-1).path}`));
    else assert.ok(page.catalog.comparisons.some((item) => item.path === notes.at(-1).path));
  }
  for (const section of ["picker", "comparisons"]) {
    let offset = 0;
    let total = 0;
    do {
      const page = await interviewQuery(model, "r1", new URL(`http://localhost/api/interview/catalog?${new URLSearchParams({ section, offset: String(offset) })}`));
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 100_000, `${section}:${offset}`);
      total += section === "picker" ? page.groups.reduce((count, group) => count + group.items.length, 0) : page.items.length;
      offset = page.nextOffset;
    } while (offset !== null);
    assert.equal(total, 345);
  }
});

test("增量批注复用其他整理稿；同一对象内容改变也会正确重新解析", () => {
  const first = study("缓存一");
  const second = study("缓存二", "二次面接");
  const annotation = note(`${root}/批注.md`, { type: "study-annotation", company: "株式会社テスト", date: "2026-10-28" }, "");
  const before = joinReviewNotes([first, second, annotation]);
  annotation.content = "- **a001｜s001｜批注｜open｜2026-10-29**\n    - 我:: 本人新批注\n";
  const after = joinReviewNotes([first, second, annotation]);
  assert.equal(after[0].annotations[0].mine, "本人新批注");
  assert.equal(after[0].parsed, before[0].parsed);
  assert.equal(after[1].parsed, before[1].parsed);
  assert.equal(joinReviewNotes([first, second, annotation])[0], after[0]);
});

test("同公司同日同轮的不同岗位不串批注、评分和重练资料", () => {
  const first = { ...study("岗位A/同轮"), frontmatter: { ...study("unused").frontmatter, case_id: "role-a" } };
  const second = { ...study("岗位B/同轮"), frontmatter: { ...study("unused").frontmatter, case_id: "role-b" } };
  const quality = (source, id) => note(source.path.replace("_整理稿", "_评价"), {
    type: "interview-answer-review", company: "株式会社テスト", date: "2026-10-28", round: "一次面接", case_id: id,
    source_note: `[[${source.path.replace(/\.md$/, "")}]]`,
  });
  const a = quality(first, "role-a");
  const b = quality(second, "role-b");
  const annotation = note(first.path.replace("_整理稿", "_批注"), { type: "study-annotation", company: "株式会社テスト", date: "2026-10-28", case_id: "role-a" });
  const joined = joinReviewNotes([first, second, a, b, annotation]);
  assert.equal(joined.find((item) => item.key === first.path).deepReviewNote.path, a.path);
  assert.equal(joined.find((item) => item.key === second.path).deepReviewNote.path, b.path);
  assert.equal(joined.find((item) => item.key === second.path).annotationNote, undefined);
});

test("客户端按版本取完整正文；迟到的上一场请求不能覆盖当前场", async () => {
  const { createInterviewContextResource } = await loadAppModule("app/use-interview-context.ts");
  const first = study("远程一");
  const second = study("远程二", "二次面接");
  const records = buildInterviewReadModelRecords([first, second], { today });
  const model = reader(records);
  const requested = [];
  let release;
  const firstPending = new Promise((resolve) => { release = resolve; });
  const resource = createInterviewContextResource(async (url) => {
    requested.push(url);
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname.endsWith("/context") && parsed.searchParams.get("path") === first.path) await firstPending;
    return Response.json(await interviewQuery(model, "r1", parsed));
  });
  const old = resource.query("review", { sourcePath: first.path });
  await new Promise((resolve) => setImmediate(resolve));
  await resource.query("review", { sourcePath: second.path });
  release(); await old;
  assert.equal(resource.getState().review.projection.source.path, second.path);
  assert.equal(resource.getState().revision, "r1");
  assert.equal(resource.getState().notes.length, 0);
  assert.ok(requested.every((url) => !/\/api\/vault|scope=(?:all|interview)/.test(url)));
  await resource.getState().review.loadBlocks(["q01"]);
  assert.equal(resource.getState().review.blocks.q01.sentences[0].sei, "開発を担当しました。");
  resource.dispose();
});

test("同步分批进行时自动推进到新版本，保留已保存的本场批注", async () => {
  const { createInterviewContextResource } = await loadAppModule("app/use-interview-context.ts", { globals: {
    setTimeout: (callback) => setImmediate(callback), clearTimeout: clearImmediate,
  } });
  const source = study("同步");
  const annotation = note(`${root}/同步_批注.md`, { type: "study-annotation", company: "株式会社テスト", date: "2026-10-28" }, "- **a001｜s001｜批注｜open｜2026-10-29**\n    - 我:: 刚保存的批注\n");
  const before = reader(buildInterviewReadModelRecords([source], { today }), "r1");
  const after = reader(buildInterviewReadModelRecords([source, annotation], { today }), "r2");
  let changed = false;
  let attempts = 0;
  const resource = createInterviewContextResource(async (url) => {
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname === "/api/note") return Response.json({ note: annotation });
    const catalogRequest = parsed.pathname.endsWith("/catalog");
    if (catalogRequest && changed) attempts++;
    const revision = catalogRequest ? changed && attempts > 1 ? "r2" : "r1" : parsed.searchParams.get("revision");
    const result = await interviewQuery(revision === "r1" ? before : after, revision, parsed);
    return Response.json({ ...result, ...(catalogRequest && changed && attempts <= 1 ? { syncState: "building" } : {}) });
  });
  await resource.query("review", { sourcePath: source.path });
  changed = true;
  await resource.patchNote(annotation);
  assert.equal(resource.getState().notes.find((item) => item.path === annotation.path).content, annotation.content);
  for (let index = 0; index < 10 && resource.getState().revision !== "r2"; index++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resource.getState().revision, "r2");
  assert.equal(resource.getState().syncState, "ready");
  assert.equal(resource.getState().review.projection.annotations[0].mine, "刚保存的批注");
  resource.dispose();
});

test("切场清除上一场材料；同页更换对比选择保留选择器和旧完整目录", async () => {
  const { createInterviewContextResource } = await loadAppModule("app/use-interview-context.ts");
  const first = study("选择一");
  const second = study("选择二", "二次面接");
  const model = reader(buildInterviewReadModelRecords([first, second], { today }));
  let release;
  let pending = null;
  const resource = createInterviewContextResource(async (url) => {
    if (pending && new URL(url, "http://localhost").pathname.endsWith("/catalog")) await pending;
    return Response.json(await interviewQuery(model, "r1", new URL(url, "http://localhost")));
  });
  await resource.query("review", { sourcePath: first.path });
  pending = new Promise((resolve) => { release = resolve; });
  const switching = resource.query("review", { sourcePath: second.path });
  assert.equal(resource.getState().catalog, null);
  assert.deepEqual(resource.getState().notes, []);
  release(); await switching; pending = null;
  await resource.query("insights", {});
  const previous = resource.getState().catalog;
  pending = new Promise((resolve) => { release = resolve; });
  const selection = resource.select({ paths: [] });
  assert.equal(resource.getState().catalog, previous);
  release(); await selection;
  resource.dispose();
});

test("复盘目录使用统计投影，不解析传入正文，也不会把目录引用当完整笔记打开", async () => {
  const source = study("目录");
  const catalog = record(buildInterviewReadModelRecords([source], { today }), INTERVIEW_RECORDS.catalog, "root");
  const poisoned = Object.fromEntries(["content", "frontmatter", "path"].map((key) => [key, null]));
  for (const key of Object.keys(poisoned)) Object.defineProperty(poisoned, key, { get() { throw new Error("目录不能读取正文"); } });
  const { default: Review } = await loadAppModule("app/interview-review.tsx", { stubs: {
    "./ui-locale": { useUiLocale: () => ({ locale: "zh-CN", setLocale() {} }) },
  } });
  const html = renderToStaticMarkup(React.createElement(Review, { notes: [poisoned], catalog, revision: "r1", onVaultChanged() {}, onOpenEvidence() {}, onOpenInsights() {} }));
  assert.match(html, /株式会社テスト/);
  assert.match(html, /一次面接/);
  assert.doesNotMatch(html, /開発を担当しました/);
});
