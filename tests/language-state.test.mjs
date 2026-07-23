import assert from "node:assert/strict";
import test from "node:test";
import { deriveLanguageState } from "../lib/language/state.ts";
import { gradeLanguageDrills } from "../lib/language/grading.ts";

const baseUnit = {
  id: "lu_stable",
  canonicalKey: "conclusion-phrase",
  category: "interview_expression",
  titleZh: "结论先行",
  targetJa: "結論から申し上げます。",
  reading: "けつろんからもうしあげます",
  meaningZh: "先说结论",
  usageZh: "面试长回答的开头",
  register: "interview",
  exampleKind: "general",
  exampleJa: "結論から申し上げますと、転職理由は二点あります。",
  alternativesJa: [],
  commonErrorJa: "",
  correctedJa: "",
  errorReasonZh: "",
  cautionZh: "",
  evidence: [],
  factSensitive: false,
  factSourcePaths: [],
  relatedDojoItemIds: ["ti_structure"],
  priority: 90,
  drills: [
    {
      id: "ld_1",
      unitId: "lu_stable",
      type: "text",
      promptZh: "输入目标表达",
      choices: [],
      correctAnswer: "結論から申し上げます。",
      acceptedAnswers: ["結論から申し上げます"],
      correctOrder: [],
      explanationZh: "先说结论",
    },
    {
      id: "ld_2",
      unitId: "lu_stable",
      type: "choice",
      promptZh: "选择自然表达",
      choices: ["結論から申し上げます。", "結論を言います。"],
      correctAnswer: "結論から申し上げます。",
      acceptedAnswers: [],
      correctOrder: [],
      explanationZh: "面试语域",
    },
  ],
};

const factUnit = {
  ...baseUnit,
  id: "lu_fact",
  canonicalKey: "daily-volume",
  category: "numbers_reading",
  titleZh: "成果数字",
  targetJa: "一日約十億件",
  factSensitive: true,
  factSourcePaths: ["10_关于我/项目.md"],
};

const bank = {
  version: 1,
  generatedAt: "2026-07-19T00:00:00.000Z",
  model: "fake-sol",
  sourceFingerprint: "src_old",
  sourceCount: 2,
  summaryZh: "test",
  immediateAdviceZh: "test",
  units: [baseUnit, factUnit],
  questionBank: [],
};

const trained = {
  id: "event-1",
  unitId: "lu_stable",
  action: "trained",
  at: "2026-07-19T01:00:00.000Z",
};

function report(id, at, score, passed, assessed = true) {
  return {
    id,
    examId: `exam-${id}`,
    examName: "日语考试",
    submittedAt: at,
    model: "program",
    bankFingerprint: "src_old",
    score,
    categoryScores: { interview_expression: score },
    questions: [],
    grades: [],
    unitResults: [
      {
        unitId: "lu_stable",
        score,
        passed,
        assessed,
        criticalError: !passed && assessed,
      },
    ],
    newlyMastered: passed && assessed ? ["lu_stable"] : [],
    stillUnmastered: !passed && assessed ? ["lu_stable"] : [],
  };
}

test("language training is independent from language mastery", () => {
  const state = deriveLanguageState(bank, [trained], [], [], [], "src_old");
  const unit = state.units.find((item) => item.id === "lu_stable");
  assert.equal(unit.trainingStatus, "trained");
  assert.equal(unit.masteryStatus, "unassessed");
});

test("a later assessed failure demotes mastery and keeps training", () => {
  const state = deriveLanguageState(
    bank,
    [trained],
    [],
    [],
    [
      report("pass", "2026-07-19T02:00:00.000Z", 92, true),
      report("informational", "2026-07-19T03:00:00.000Z", 100, false, false),
      report("fail", "2026-07-19T04:00:00.000Z", 60, false),
    ],
    "src_old",
  );
  const unit = state.units.find((item) => item.id === "lu_stable");
  assert.equal(unit.trainingStatus, "trained");
  assert.equal(unit.masteryStatus, "failed");
  assert.equal(unit.bestScore, 92);
  assert.equal(unit.latestScore, 60);
  assert.equal(unit.examCount, 2);
});

test("stale source blocks only fact-sensitive units", () => {
  const state = deriveLanguageState(bank, [], [], [], [], "src_new");
  assert.equal(state.stale, true);
  assert.equal(state.units.find((item) => item.id === "lu_stable").available, true);
  assert.equal(state.units.find((item) => item.id === "lu_fact").available, false);
});

test("fixed language drills are graded locally", () => {
  const result = gradeLanguageDrills(baseUnit.drills, [
    { questionId: "ld_1", answer: "結論から申し上げます" },
    { questionId: "ld_2", answer: "結論から申し上げます。" },
  ]);
  assert.equal(result.score, 100);
  assert.equal(result.grades.every((grade) => grade.passed), true);
});

test("reading drills accept natural input without display separators", () => {
  const readingDrill = {
    ...baseUnit.drills[0],
    correctAnswer: "けいけん・を・つむ",
    acceptedAnswers: ["けいけん・を・つむ"],
  };
  const result = gradeLanguageDrills(
    [readingDrill],
    [{ questionId: readingDrill.id, answer: "けいけんをつむ" }],
  );
  assert.equal(result.score, 100);
});
