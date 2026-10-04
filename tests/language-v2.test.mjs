import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLanguageCurriculum,
  deriveLanguageProgress,
  legacyScanJudgments,
  mergeLanguageBatchCheckpoint,
  selectLanguageBatchItems,
} from "../lib/server/language-v2.ts";

function note(path, type, content, mtime = 1, extra = {}) {
  return {
    path,
    stat: { ctime: mtime, mtime, size: content.length },
    tags: [],
    frontmatter: { type, ...extra },
    content,
  };
}

const study = note(
  "20_求職/Test/2026-07-01_一次面接_整理稿.md",
  "transcript-study",
  `---
type: transcript-study
company: Test
date: 2026-07-01
round: 一次面接
---
## q01 志望理由
- **s001｜面**
    - 正:: 志望理由をお伺いしてもよろしいでしょうか。
    - 訳:: 可以说说应聘理由吗？
    - 語:: お伺いしてもよろしいでしょうか（おうかがい）＝可以请教吗
- **s002｜私**
    - 正:: 経験を«活かせるだ»と考えています。
    - 訳:: 我认为能够发挥经验。
    - 誤1:: «活かせるだ» → 活かせる ｜学習者｜型:: い形だと
- **s003｜私**
    - 正:: 御社«を»応募しました。
    - 訳:: 我应聘了贵公司。
    - 誤1:: «を» → に ｜疑（転写か助詞か）｜型:: 助詞
- **s004｜私**
    - 正:: 正しく話しました。
    - 誤1:: «話し» → 話し ｜転写｜型:: 語形
`,
  10,
  { company: "Test", date: "2026-07-01", round: "一次面接" },
);

const annotation = note(
  "20_求職/Test/2026-07-01_一次面接_批注.md",
  "study-annotation",
  `---
type: study-annotation
company: Test
date: 2026-07-01
---
- **a001｜s003｜裁定｜open｜2026-07-02**
    - 対象:: error:1
    - 我:: 誤1は学習者誤りで確定（実際にそう発話した）
`,
  11,
  { company: "Test", date: "2026-07-01" },
);

const deep = note(
  "20_求職/Test/2026-07-01_一次面接_回答品質復盤.md",
  "interview-answer-review",
  `---
type: interview-answer-review
company: Test
date: 2026-07-01
round: 一次面接
---
<!-- interview-answer-review-data -->
\`\`\`json
${JSON.stringify({
  generatedAt: "2026-07-03T00:00:00.000Z",
  model: "test",
  overallScore: 70,
  summaryZh: "test",
  strengths: [],
  weaknesses: [],
  priorityBlockIds: ["q01"],
  blocks: [{
    blockId: "q01",
    questionTitle: "志望理由",
    interviewerIntentZh: "确认动机",
    askedPoints: ["动机"],
    answeredPoints: [],
    missedPoints: ["为什么是这家公司"],
    comprehension: "partial",
    relevance: "partial",
    quality: "mixed",
    strategyTags: ["no-conclusion-first"],
    evidenceSentenceIds: ["s002"],
    evaluationZh: "结论较晚",
    improvementZh: "先给结论",
    improvedAnswerJa: "結論から申し上げます。",
  }],
})}
\`\`\`
`,
  12,
  { company: "Test", date: "2026-07-01", round: "一次面接" },
);

test("v2 curriculum keeps confirmed learner errors and excludes transcript errors", () => {
  const curriculum = buildLanguageCurriculum([study, annotation, deep]);
  assert.equal(curriculum.profile.interviewCount, 1);
  assert.equal(curriculum.profile.learnerErrorCount, 2);
  assert.equal(curriculum.profile.reviewedBlockCount, 1);
  assert.equal(curriculum.profile.listeningGapCount, 0);
  assert.equal(curriculum.items.filter((item) => item.kind === "error_patch").length, 2);
  assert.ok(curriculum.items.some((item) => item.targetJa === "活かせるだ → 活かせる"));
  assert.equal(
    curriculum.items.some((item) => item.kind === "active_chunk" && item.pattern === "助詞"),
    false,
  );
  assert.equal(curriculum.items.some((item) => item.originalJa === "正しく話しました。"), false);
  assert.ok(curriculum.items.some((item) => item.kind === "interviewer_phrase"));
  assert.ok(curriculum.items.some((item) => item.kind === "answer_strategy"));
  assert.ok(curriculum.items
    .filter((item) => item.kind === "answer_strategy")
    .every((item) => item.targetJa.length <= 30));
  assert.ok(curriculum.items
    .filter((item) => item.pattern === "表达升级")
    .every((item) => item.targetJa.length <= 36));
  assert.equal(
    curriculum.profile.topIssues.find((issue) => issue.key === "助詞")?.occurrenceCount,
    1,
  );
});

test("newer human feedback makes a deep review stale", () => {
  const feedback = note(
    "20_求職/Test/2026-07-01_一次面接_回答品質批注.md",
    "interview-answer-feedback",
    "---\ntype: interview-answer-feedback\n---\n",
    13,
    { company: "Test", date: "2026-07-01", round: "一次面接" },
  );
  const curriculum = buildLanguageCurriculum([study, annotation, deep, feedback]);
  assert.deepEqual(curriculum.profile.staleReviewPaths, [deep.path]);
  assert.equal(curriculum.profile.reviewedBlockCount, 0);
});

test("v2 curriculum merges equivalent error variants and splits glossary entries", () => {
  const source = note(
    "20_求職/Test/2026-07-05_一次面接_整理稿.md",
    "transcript-study",
    `---
type: transcript-study
company: Test
date: 2026-07-05
round: 一次面接
---
## q01 確認
- **s001｜面**
    - 正:: 差別化について教えてください。
    - 語:: 差別化（さべつか）＝差异化／〜にしかならない＝只能是……／理由ってあるんですか（って＝は的口语）
- **s002｜私**
    - 正:: «正直と言うと»難しいです。
    - 誤1:: «正直と言うと» → 正直に言うと ｜学習者｜型:: 語法
- **s003｜私**
    - 正:: «正直というと»難しいです。
    - 誤1:: «正直というと» → 正直に言うと ｜学習者｜型:: 語法
`,
    20,
    { company: "Test", date: "2026-07-05", round: "一次面接" },
  );
  const curriculum = buildLanguageCurriculum([source]);
  const patches = curriculum.items.filter((item) => item.kind === "error_patch");
  assert.equal(patches.length, 1);
  assert.equal(patches[0].evidence.length, 2);
  assert.deepEqual(
    curriculum.items
      .filter((item) => item.kind === "interviewer_phrase")
      .map((item) => [item.targetJa, item.meaningZh]),
    [["差別化", "差异化"], ["〜にしかならない", "只能是……"]],
  );
});

function fakeItem(kind, index) {
  return {
    id: `${kind}-${index}`,
    canonicalKey: `${kind}-${index}`,
    kind,
    titleZh: `${kind} ${index}`,
    targetJa: `答え${index}`,
    reading: "",
    meaningZh: "含义",
    promptZh: "问题",
    originalJa: "",
    correctedJa: `答え${index}`,
    pattern: kind === "error_patch" ? "助詞" : "",
    sourceInterviewKeys: [],
    evidence: [],
    factSensitive: false,
    factSourcePaths: [],
    basePriority: 50 + index % 40,
    strategyTags: [],
  };
}

const kinds = ["active_chunk", "error_patch", "interviewer_phrase", "answer_strategy", "technical_term", "fact_anchor"];
const bigCurriculum = {
  version: 2,
  generatedAt: "2026-07-01T00:00:00.000Z",
  sourceFingerprint: "src",
  sourceCount: 3,
  summaryZh: "test",
  items: kinds.flatMap((kind) => Array.from({ length: 80 }, (_, index) => fakeItem(kind, index))),
  profile: { interviewCount: 3, learnerErrorCount: 1, reviewedBlockCount: 1, listeningGapCount: 0, staleReviewPaths: [], topIssues: [] },
};

test("batch selector returns exact adjustable sizes without duplicate scan items", () => {
  for (const size of [100, 150, 200]) {
    const selected = selectLanguageBatchItems(bigCurriculum, [], size, "2026-07-22T00:00:00.000Z");
    assert.equal(selected.length, size);
    assert.equal(new Set(selected.map((item) => item.id)).size, size);
  }
});

test("checkpoint actions are idempotent and compile/stress lists stay bounded", () => {
  const selected = selectLanguageBatchItems(bigCurriculum, [], 100);
  const batch = {
    id: "batch",
    date: "2026-07-22",
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    curriculumFingerprint: "src",
    targetSize: 100,
    phase: "scan",
    cursor: 0,
    scanItemIds: selected.map((item) => item.id),
    compileItemIds: [],
    stressItemIds: [],
    actions: [],
    signature: "test",
  };
  const scans = selected.map((item, index) => ({
    actionId: `a-${index}`,
    itemId: item.id,
    phase: "scan",
    judgment: index < 70 ? "unknown" : "known",
    at: `2026-07-22T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
  }));
  const compile = mergeLanguageBatchCheckpoint(batch, bigCurriculum, [...scans, ...scans], "compile", 0);
  assert.equal(compile.actions.length, scans.length);
  assert.equal(compile.compileItemIds.length, 20);
  const stress = mergeLanguageBatchCheckpoint(compile, bigCurriculum, [], "stress", 0);
  assert.equal(stress.stressItemIds.length, 15);
  assert.ok(stress.stressItemIds.filter((id) =>
    bigCurriculum.items.find((item) => item.id === id)?.kind === "answer_strategy"
  ).length <= 3);
});

test("self-reported knowledge never becomes stable and later failure demotes stability", () => {
  const item = bigCurriculum.items[0];
  const scanBatch = {
    id: "scan",
    date: "2026-07-01",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    curriculumFingerprint: "src",
    targetSize: 100,
    phase: "completed",
    cursor: 0,
    scanItemIds: [item.id], compileItemIds: [], stressItemIds: [], signature: "x",
    actions: [{ actionId: "known", itemId: item.id, phase: "scan", judgment: "known", at: "2026-07-01T00:00:00.000Z" }],
  };
  assert.equal(deriveLanguageProgress(bigCurriculum, [scanBatch], new Set())[0].stage, "recognized");
  const successBatches = ["2026-07-01", "2026-07-05", "2026-07-09"].map((date, index) => ({
    ...scanBatch,
    id: `pass-${index}`,
    date,
    createdAt: `${date}T00:00:00.000Z`,
    actions: [{ actionId: `pass-${index}`, itemId: item.id, phase: "compile", answer: item.targetJa, passed: true, at: `${date}T00:00:00.000Z` }],
  }));
  assert.equal(deriveLanguageProgress(bigCurriculum, successBatches, new Set())[0].stage, "stable");
  const failed = {
    ...scanBatch,
    id: "fail",
    date: "2026-07-10",
    createdAt: "2026-07-10T00:00:00.000Z",
    actions: [{ actionId: "fail", itemId: item.id, phase: "stress", answer: "错", passed: false, at: "2026-07-10T00:00:00.000Z" }],
  };
  assert.equal(deriveLanguageProgress(bigCurriculum, [...successBatches, failed], new Set())[0].stage, "retrievable");
});

// ── 快练改造：语:: 切分与清洗、改错括注、构建器指纹 ───────────────────────────
// 全部是虚构句子；公司名一律「株式会社テスト」。

function glossaryStudy(goLine, patternLine = "語法（丁寧形は名詞修飾に使わない）", path = "20_求職/株式会社テスト/2026-08-01_一次面接_整理稿.md") {
  return note(
    path,
    "transcript-study",
    `---
type: transcript-study
company: 株式会社テスト
date: 2026-08-01
round: 一次面接
---
## q01 進め方
- **s001｜面**
    - 正:: 段取りについて伺えますか。
    - 訳:: 能说说安排吗？
    - 語:: ${goLine}
- **s002｜私**
    - 正:: «大きいです»画面を作りました。
    - 誤1:: «大きいです» → 大きい ｜学習者｜型:: ${patternLine}
`,
    30,
    { company: "株式会社テスト", date: "2026-08-01", round: "一次面接" },
  );
}

function phrases(curriculum) {
  return curriculum.items
    .filter((item) => item.kind === "interviewer_phrase")
    .map((item) => [item.targetJa, item.reading, item.meaningZh]);
}

test("语:: 按「；」「｜」切出多个词条，前一条的释义不再吞掉后一条", () => {
  const curriculum = buildLanguageCurriculum([glossaryStudy(
    "段取り（だんどり）＝安排步骤；根回し（ねまわし）＝事先疏通｜落とし所（おとしどころ）＝妥协点",
  )]);
  // 课程按优先级与 id 排序，与原文顺序无关。
  assert.deepEqual(phrases(curriculum).toSorted((left, right) => left[1].localeCompare(right[1])), [
    ["落とし所", "おとしどころ", "妥协点"],
    ["段取り", "だんどり", "安排步骤"],
    ["根回し", "ねまわし", "事先疏通"],
  ]);
});

test("语:: 释义里的「；」用法补充保留，转写注记删除，转写订正整条丢弃", () => {
  const curriculum = buildLanguageCurriculum([glossaryStudy(
    "見積もり（みつもり）＝报价。「積もり」は転写の揺れ／目処＝头绪；多用于否定（めど）／「ていうか」＝「というか」の転写",
  )]);
  const rows = phrases(curriculum);
  assert.deepEqual(rows.find(([target]) => target === "見積もり"), ["見積もり", "みつもり", "报价"]);
  // 读音只从＝左侧取：释义里的（めど）不是目标的注音。
  assert.deepEqual(rows.find(([target]) => target === "目処"), ["目処", "", "头绪；多用于否定（めど）"]);
  assert.equal(rows.some(([target]) => target.includes("ていうか")), false);
  assert.equal(rows.some(([, , meaning]) => /転写/u.test(meaning)), false);
});

test("改错条目保存 型:: 括注为 noteJa，登记标记被过滤，合并时去重拼接", () => {
  const plain = buildLanguageCurriculum([glossaryStudy("段取り＝安排", "語法")]);
  const plainPatch = plain.items.find((item) => item.kind === "error_patch");
  assert.equal("noteJa" in plainPatch, false, "没有括注时不写空键");

  const noted = buildLanguageCurriculum([glossaryStudy("段取り＝安排")]);
  assert.equal(noted.items.find((item) => item.kind === "error_patch").noteJa, "丁寧形は名詞修飾に使わない");

  const meta = buildLanguageCurriculum([glossaryStudy("段取り＝安排", "語法（[[誤用辞典]]既載）")]);
  assert.equal("noteJa" in meta.items.find((item) => item.kind === "error_patch"), false);

  const merged = buildLanguageCurriculum([
    glossaryStudy("段取り＝安排", "語法（丁寧形は名詞修飾に使わない）"),
    glossaryStudy("段取り＝安排", "語法（い形容詞はそのまま名詞を修飾する。s012 と同一の誤り）", "20_求職/株式会社テスト/2026-08-02_二次面接_整理稿.md"),
    glossaryStudy("段取り＝安排", "語法（丁寧形は名詞修飾に使わない）", "20_求職/株式会社テスト/2026-08-03_三次面接_整理稿.md"),
  ]);
  const patches = merged.items.filter((item) => item.kind === "error_patch");
  assert.equal(patches.length, 1);
  assert.equal(patches[0].noteJa, "丁寧形は名詞修飾に使わない；い形容詞はそのまま名詞を修飾する");
});

test("只有 noteJa 不同的两份课程，内容指纹也不同（否则 rebuild 判为未变化不落盘）", () => {
  const left = buildLanguageCurriculum([glossaryStudy("段取り＝安排", "語法（甲）")]);
  const right = buildLanguageCurriculum([glossaryStudy("段取り＝安排", "語法（乙）")]);
  assert.deepEqual(left.items.map((item) => item.id), right.items.map((item) => item.id));
  assert.notEqual(left.contentFingerprint, right.contentFingerprint);
  assert.equal(left.contentFingerprint, buildLanguageCurriculum([glossaryStudy("段取り＝安排", "語法（甲）")]).contentFingerprint);
});

// ── 快练事件回放 ────────────────────────────────────────────────────────────

function patchItem(id, pattern, interviewDays) {
  return {
    ...fakeItem("error_patch", 0),
    id,
    canonicalKey: id,
    pattern,
    evidence: interviewDays.map((day) => ({
      path: `20_求職/株式会社テスト/${day}_面接_整理稿.md`,
      interviewKey: `${day}|株式会社テスト|一次面接`,
      excerpt: "虚构的句子",
    })),
  };
}

function curriculumOf(items) {
  return { ...bigCurriculum, items };
}

let eventSeq = 0;
function quickEvent(itemId, at, passed, extra = {}) {
  eventSeq += 1;
  return {
    eventId: `e-${eventSeq}`,
    setId: "set-1",
    setSize: 20,
    itemId,
    type: "cloze_choice",
    action: "answer",
    response: passed ? "に" : "を",
    passed,
    first: true,
    at,
    ...extra,
  };
}

function batchWith(actions, date = "2026-07-01") {
  return {
    id: `batch-${date}`,
    date,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
    curriculumFingerprint: "src",
    targetSize: 100,
    phase: "completed",
    cursor: 0,
    scanItemIds: [], compileItemIds: [], stressItemIds: [], signature: "x",
    actions,
  };
}

test("第四参为空时与三参回放结果相同；extraItemIds 也建初始进度", () => {
  const items = [patchItem("p1", "助詞", ["2026-07-01"])];
  const batches = [batchWith([{ actionId: "a", itemId: "p1", phase: "scan", judgment: "known", at: "2026-07-01T00:00:00.000Z" }])];
  const three = deriveLanguageProgress(curriculumOf(items), batches, new Set());
  const four = deriveLanguageProgress(curriculumOf(items), batches, new Set(), { events: [] });
  assert.deepEqual(four, three);
  const withExtra = deriveLanguageProgress(curriculumOf(items), [], new Set(), { events: [], extraItemIds: ["nb_x"] });
  assert.deepEqual(withExtra.map((state) => [state.itemId, state.stage]), [["p1", "unseen"], ["nb_x", "unseen"]]);
});

test("快练与批次动作的成功日都按 JST 归日", () => {
  const items = [patchItem("p1", "助詞", []), patchItem("p2", "助詞", [])];
  const progress = deriveLanguageProgress(
    curriculumOf(items),
    [batchWith([{ actionId: "b", itemId: "p2", phase: "compile", answer: "x", passed: true, at: "2026-07-01T20:00:00.000Z" }])],
    new Set(),
    { events: [quickEvent("p1", "2026-07-01T16:00:00.000Z", true)] },
  );
  const byId = new Map(progress.map((state) => [state.itemId, state]));
  assert.deepEqual(byId.get("p1").successDates, ["2026-07-02"]);
  assert.equal(byId.get("p1").nextDueAt, "2026-07-04T15:00:00.000Z");
  assert.deepEqual(byId.get("p2").successDates, ["2026-07-02"]);
});

test("批次动作与快练事件按时间交错回放：之后的批次失败会把快练升上去的 stable 拉回", () => {
  const items = [patchItem("p1", "語法", [])];
  const events = ["2026-07-02", "2026-07-05", "2026-07-10"].map((day) => quickEvent("p1", `${day}T01:00:00.000Z`, true));
  const fail = batchWith([{ actionId: "f", itemId: "p1", phase: "stress", answer: "x", passed: false, at: "2026-07-11T01:00:00.000Z" }]);
  const early = batchWith([{ actionId: "f0", itemId: "p1", phase: "stress", answer: "x", passed: false, at: "2026-07-01T01:00:00.000Z" }]);
  assert.equal(deriveLanguageProgress(curriculumOf(items), [], new Set(), { events })[0].stage, "stable");
  assert.equal(deriveLanguageProgress(curriculumOf(items), [fail], new Set(), { events })[0].stage, "retrievable");
  assert.equal(deriveLanguageProgress(curriculumOf(items), [early], new Set(), { events })[0].stage, "stable");
});

test("只有二选一的条目按 binaryOnly 提高 stable 门槛；非首答与不在题库的事件不计成败", () => {
  const items = [patchItem("p1", "語法", [])];
  const events = ["2026-07-02", "2026-07-05", "2026-07-10"].map((day) => quickEvent("p1", `${day}T01:00:00.000Z`, true));
  const binary = deriveLanguageProgress(curriculumOf(items), [], new Set(), { events, binaryOnly: new Set(["p1"]) });
  assert.equal(binary[0].stage, "retrievable");
  const retry = deriveLanguageProgress(curriculumOf(items), [], new Set(), {
    events: [quickEvent("p1", "2026-07-02T01:00:00.000Z", false), quickEvent("p1", "2026-07-02T01:01:00.000Z", true, { first: false }), quickEvent("gone", "2026-07-02T01:02:00.000Z", true)],
  });
  assert.equal(retry.length, 1);
  assert.equal(retry[0].stage, "unseen");
  assert.equal(retry[0].failureCount, 1);
  assert.equal(retry[0].seenCount, 2);
  assert.deepEqual(retry[0].successDates, []);
});

test("同型别的条目在之后的面试再出现，不会让已稳定的条目被降级（旧规则会每次推导都打回并立刻到期）", () => {
  const items = [
    patchItem("p1", "助詞", ["2026-07-01"]),
    patchItem("p2", "助詞", ["2026-08-20"]),
  ];
  const events = ["2026-07-02", "2026-07-05", "2026-07-10"].map((day) => quickEvent("p1", `${day}T01:00:00.000Z`, true));
  const first = deriveLanguageProgress(curriculumOf(items), [], new Set(), { events });
  const again = deriveLanguageProgress(curriculumOf(items), [], new Set(), { events });
  assert.deepEqual(again, first, "推导与当前时间无关");
  const p1 = first.find((state) => state.itemId === "p1");
  assert.equal(p1.stage, "stable");
  assert.equal(p1.nextDueAt, "2026-08-08T15:00:00.000Z");
  // 画像用的次数仍按型统计。
  assert.equal(p1.postTrainingOccurrences, 1);
});

test("条目自己在最后成功日之后的面试里再出现才降级，到期日是那场面试的次日；之后再答对即恢复", () => {
  const items = [patchItem("p1", "助詞", ["2026-07-01", "2026-07-20"])];
  const events = ["2026-07-02", "2026-07-05", "2026-07-10"].map((day) => quickEvent("p1", `${day}T01:00:00.000Z`, true));
  const demoted = deriveLanguageProgress(curriculumOf(items), [], new Set(), { events })[0];
  assert.equal(demoted.stage, "retrievable");
  assert.equal(demoted.nextDueAt, "2026-07-20T15:00:00.000Z");
  const recovered = deriveLanguageProgress(curriculumOf(items), [], new Set(), {
    events: [...events, quickEvent("p1", "2026-07-22T01:00:00.000Z", true)],
  })[0];
  assert.equal(recovered.stage, "stable");
  assert.equal(recovered.nextDueAt, "2026-08-20T15:00:00.000Z");
});

test("legacyScanJudgments 取每题最后一次 scan 判断，忽略非 scan 动作", () => {
  const judgments = legacyScanJudgments([
    batchWith([
      { actionId: "1", itemId: "a", phase: "scan", judgment: "unknown", at: "2026-07-01T00:00:00.000Z" },
      { actionId: "2", itemId: "b", phase: "scan", judgment: "uncertain", at: "2026-07-01T00:01:00.000Z" },
      { actionId: "3", itemId: "b", phase: "compile", answer: "x", passed: true, at: "2026-07-01T00:02:00.000Z" },
    ]),
    batchWith([
      { actionId: "4", itemId: "a", phase: "scan", judgment: "known", at: "2026-07-02T00:00:00.000Z" },
    ], "2026-07-02"),
  ]);
  assert.deepEqual([...judgments.entries()], [["a", "known"], ["b", "uncertain"]]);
});
