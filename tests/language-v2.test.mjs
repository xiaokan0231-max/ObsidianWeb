import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLanguageCurriculum,
  deriveLanguageProgress,
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
---
- **a001｜s003｜裁定｜open｜2026-07-02**
    - 対象:: error:1
    - 我:: 誤1は学習者誤りで確定（実際にそう発話した）
`,
  11,
);

const deep = note(
  "20_求職/Test/2026-07-01_一次面接_回答品質復盤.md",
  "interview-answer-review",
  `---
type: interview-answer-review
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
