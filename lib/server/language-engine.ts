import type {
  LanguageAnswer,
  LanguageCategory,
  LanguageExamDefinition,
  LanguageExamGrade,
  LanguageExamKind,
  LanguageExamQuestion,
  LanguageExamReport,
  LanguageOpenDimensions,
  LanguageSession,
  LanguageSessionAttempt,
  LanguageSessionKind,
  LanguageState,
  LanguageTrainingEvent,
  LanguageUnitState,
} from "@/lib/language/types";
import { gradeLanguageDrills, gradeLanguageQuestion } from "@/lib/language/grading";
import { stableId } from "@/lib/dojo/utils";
import { invokeCodex } from "@/lib/server/codex-bridge";

const OBJECTIVE_CATEGORIES = new Set<LanguageCategory>([
  "numbers_reading",
  "vocabulary",
  "technical_vocabulary",
]);

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function signature(value: object) {
  const secret = process.env.CODEX_BRIDGE_TOKEN;
  if (!secret) throw new Error("训练签名密钥未配置，请通过 dev:obsidian 启动。");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(JSON.stringify(value));
  return bytesToBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, data)));
}

function unsignedSession(session: LanguageSession) {
  const unsigned = { ...session };
  delete unsigned.signature;
  return unsigned;
}

function unsignedExam(exam: LanguageExamDefinition) {
  const unsigned = { ...exam };
  delete unsigned.signature;
  return unsigned;
}

export async function verifyLanguageSession(session: LanguageSession) {
  return Boolean(session.signature) && (await signature(unsignedSession(session))) === session.signature;
}

export async function verifyLanguageExam(exam: LanguageExamDefinition) {
  return Boolean(exam.signature) && (await signature(unsignedExam(exam))) === exam.signature;
}

type StartSessionInput = {
  kind?: LanguageSessionKind;
  category?: LanguageCategory;
  relatedDojoItemId?: string;
  unitIds?: string[];
};

function comparableJapanese(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ja-JP").replace(/[\s\u3000・、。！？,.!?「」『』（）()]/gu, "");
}

function evenlySample<T>(values: T[], count: number) {
  if (values.length <= count) return values;
  return Array.from({ length: count }, (_, index) =>
    values[Math.floor((index * values.length) / count)],
  );
}

function usefulReadingQuestion(unit: LanguageUnitState) {
  const target = unit.targetJa.trim();
  const reading = unit.reading.trim();
  return Boolean(
    reading &&
    /[\u3400-\u9fff々]/u.test(target) &&
    target.length <= 16 &&
    reading.length <= 28 &&
    !/[、。！？,!?〜～]/u.test(target),
  );
}

function drillAnswers(drill: LanguageUnitState["drills"][number]) {
  return [drill.correctAnswer ?? "", ...drill.acceptedAnswers].map(comparableJapanese);
}

function selectPracticeDrill(unit: LanguageUnitState, index: number) {
  const reading = comparableJapanese(unit.reading);
  const target = comparableJapanese(unit.targetJa);
  const readingDrill = reading
    ? unit.drills.find((drill) => drillAnswers(drill).includes(reading))
    : undefined;
  const expressionDrill = target
    ? unit.drills.find((drill) =>
        drillAnswers(drill).includes(target) &&
        (target !== reading || drill !== readingDrill),
      )
    : undefined;

  // Short kanji terms benefit from pronunciation retrieval. Long answers,
  // katakana and sentence expressions must be tested by meaning/use instead.
  if (usefulReadingQuestion(unit) && index % 2 === 0 && readingDrill) return readingDrill;
  return expressionDrill ?? unit.drills.find((drill) => drill !== readingDrill) ?? readingDrill;
}

function practiceQuestionCount(kind: LanguageSessionKind, unitCount: number) {
  const requested = kind === "quick" ? 10 : kind === "intensive" ? 15 : 12;
  return Math.min(unitCount, requested);
}

export async function createLanguageSession(
  state: LanguageState,
  input: StartSessionInput,
) {
  if (!state.bank) throw new Error("请先建立日语训练库。");
  const kind = input.kind ?? "standard";
  const count = kind === "quick" ? 10 : kind === "intensive" ? 30 : kind === "special" ? 40 : 20;
  let candidates = state.units.filter((unit) => unit.available);
  const selectedIds = new Set((input.unitIds ?? []).slice(0, 40));
  if (selectedIds.size) {
    candidates = candidates.filter((unit) => selectedIds.has(unit.id));
  }
  if (input.category) {
    candidates = candidates.filter((unit) => unit.category === input.category);
  }
  if (input.relatedDojoItemId) {
    const linked = candidates.filter((unit) =>
      unit.relatedDojoItemIds.includes(input.relatedDojoItemId!),
    );
    if (linked.length) candidates = linked;
  }
  if (!candidates.length) {
    throw new Error("当前筛选条件下没有可用训练单元，请更新训练库或更换分类。");
  }
  const selectedUnits = candidates.slice(0, count);
  const practiceUnits = evenlySample(
    selectedUnits,
    practiceQuestionCount(kind, selectedUnits.length),
  );
  const session: LanguageSession = {
    id: crypto.randomUUID(),
    kind,
    createdAt: new Date().toISOString(),
    bankFingerprint: state.bank.sourceFingerprint,
    unitIds: selectedUnits.map((unit) => unit.id),
    drillIds: practiceUnits.flatMap((unit, index) => {
      const drill = selectPracticeDrill(unit, index);
      return drill ? [drill.id] : [];
    }),
    category: input.category,
  };
  session.signature = await signature(session);
  return session;
}

export async function completeLanguageSession(
  state: LanguageState,
  session: LanguageSession,
  answers: LanguageAnswer[],
  submissionId: string,
) {
  if (!state.bank) throw new Error("日语训练库不存在。");
  if (!(await verifyLanguageSession(session))) {
    throw new Error("训练内容签名无效，请重新开始训练。");
  }
  if (session.bankFingerprint !== state.bank.sourceFingerprint) {
    throw new Error("训练库已更新，请重新开始本次训练。");
  }
  if (!submissionId) throw new Error("训练提交标识缺失。");
  const unitSet = new Set(session.unitIds);
  const units = state.units.filter((unit) => unitSet.has(unit.id) && unit.available);
  if (units.length !== session.unitIds.length) {
    throw new Error("训练单元已失效，请重新开始训练。");
  }
  const drills = units.flatMap((unit) => unit.drills);
  const requestedDrills = new Set(session.drillIds ?? []);
  const selectedDrills = requestedDrills.size
    ? drills.filter((drill) => requestedDrills.has(drill.id))
    : drills;
  if (requestedDrills.size && selectedDrills.length !== requestedDrills.size) {
    throw new Error("训练题目已失效，请重新开始本次训练。");
  }
  if (selectedDrills.length > 60 || answers.length > 60) {
    throw new Error("一次训练最多允许60道固定练习。");
  }
  const graded = gradeLanguageDrills(selectedDrills, answers);
  const submittedAt = new Date().toISOString();
  const attempt: LanguageSessionAttempt = {
    id: crypto.randomUUID(),
    submissionId,
    sessionId: session.id,
    submittedAt,
    bankFingerprint: session.bankFingerprint,
    unitIds: session.unitIds,
    score: graded.score,
    grades: graded.grades,
  };
  const events: LanguageTrainingEvent[] = units.map((unit) => {
    const unitGrades = graded.grades.filter((grade) => grade.unitId === unit.id);
    const score = unitGrades.length
      ? Math.round(unitGrades.reduce((sum, grade) => sum + grade.score, 0) / unitGrades.length)
      : undefined;
    return {
      id: crypto.randomUUID(),
      unitId: unit.id,
      action: "trained",
      at: submittedAt,
      sessionId: session.id,
      score,
    };
  });
  return { attempt, events };
}

type StartExamInput = {
  kind?: LanguageExamKind;
  category?: LanguageCategory;
  includeUntrained?: boolean;
  unitIds?: string[];
};

function cloneQuestion(
  question: LanguageExamQuestion,
  examId: string,
  index: number,
) {
  return {
    ...question,
    id: stableId("lex", `${examId}|${question.id}|${index}`),
  };
}

function fallbackObjective(unit: LanguageUnitState, examId: string, index: number) {
  const drill = unit.drills[index % unit.drills.length];
  return {
    ...drill,
    id: stableId("lex", `${examId}|${unit.id}|objective|${index}`),
    category: unit.category,
  } satisfies LanguageExamQuestion;
}

function fallbackOpen(unit: LanguageUnitState, examId: string, index: number) {
  return {
    id: stableId("lex", `${examId}|${unit.id}|open|${index}`),
    unitId: unit.id,
    category: unit.category,
    type: "free_response",
    promptZh: `请在新的面试或商务语境中，用“${unit.targetJa}”写一句自然、可说出口的日语。`,
    choices: [],
    acceptedAnswers: [],
    correctOrder: [],
    rubricZh: "保持原意、语法自然、语域适合，不得增加未经确认的个人事实。",
  } satisfies LanguageExamQuestion;
}

function selectQuestions(
  state: LanguageState,
  candidates: LanguageUnitState[],
  examId: string,
  objectiveCount: number,
  openCount: number,
) {
  const bank = state.bank!;
  const questions: LanguageExamQuestion[] = [];
  const production = candidates.filter((unit) => !OBJECTIVE_CATEGORIES.has(unit.category));
  if (openCount > 0 && production.length === 0) {
    throw new Error("正式考试至少需要一个已训练的语法或表达单元。");
  }

  const objectiveUnits = [...production.slice(0, Math.min(openCount, production.length))];
  for (const unit of candidates) {
    if (!objectiveUnits.some((candidate) => candidate.id === unit.id)) objectiveUnits.push(unit);
  }
  for (let index = 0; index < objectiveCount; index += 1) {
    const unit = objectiveUnits[index % objectiveUnits.length];
    const source = bank.questionBank.filter(
      (question) => question.unitId === unit.id && question.type !== "free_response",
    );
    questions.push(
      cloneQuestion(source[Math.floor(index / objectiveUnits.length) % source.length] ?? fallbackObjective(unit, examId, index), examId, index),
    );
  }
  for (let index = 0; index < openCount; index += 1) {
    const unit = production[index % production.length];
    const source = bank.questionBank.filter(
      (question) => question.unitId === unit.id && question.type === "free_response",
    );
    questions.push(
      cloneQuestion(source[Math.floor(index / production.length) % source.length] ?? fallbackOpen(unit, examId, index), examId, objectiveCount + index),
    );
  }
  return questions;
}

export async function createLanguageExam(
  state: LanguageState,
  input: StartExamInput,
) {
  if (!state.bank) throw new Error("请先建立日语训练库。");
  const kind = input.kind ?? "quick";
  const selected = new Set(input.unitIds ?? []);
  let candidates = state.units.filter(
    (unit) => unit.available && (input.includeUntrained || unit.trainingStatus === "trained"),
  );
  if (selected.size) candidates = candidates.filter((unit) => selected.has(unit.id));
  if (input.category) candidates = candidates.filter((unit) => unit.category === input.category);
  if (kind === "special" && !input.category && selected.size === 0) {
    throw new Error("专项考试需要先选择一个分类或训练单元。");
  }
  if (!candidates.length) {
    throw new Error(
      input.includeUntrained
        ? "当前筛选条件下没有可考试单元。"
        : "还没有可考试的已训练单元；可先完成训练，或开启“包含未训练”。",
    );
  }
  const examId = crypto.randomUUID();
  const productionSpecial = kind === "special" && candidates.some(
    (unit) => !OBJECTIVE_CATEGORIES.has(unit.category),
  );
  const objectiveCount = kind === "formal" ? 12 : productionSpecial ? 8 : 10;
  const openCount = kind === "formal" ? 3 : productionSpecial ? 2 : 0;
  const questions = selectQuestions(
    state,
    candidates,
    examId,
    objectiveCount,
    openCount,
  );
  const name =
    kind === "quick"
      ? "日语快速检查"
      : kind === "formal"
        ? "日语正式考试"
        : `${input.category ?? "自选"}专项考试`;
  const exam: LanguageExamDefinition = {
    id: examId,
    name,
    kind,
    createdAt: new Date().toISOString(),
    bankFingerprint: state.bank.sourceFingerprint,
    questions,
  };
  exam.signature = await signature(exam);
  return exam;
}

type OpenGrade = {
  questionId: string;
  unitId: string;
  score: number;
  dimensions: LanguageOpenDimensions;
  criticalError: boolean;
  feedbackZh: string;
  improvedAnswerJa: string;
};

function finite(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export async function gradeLanguageExam(
  state: LanguageState,
  exam: LanguageExamDefinition,
  answers: LanguageAnswer[],
) {
  if (!state.bank) throw new Error("日语训练库不存在。");
  if (!(await verifyLanguageExam(exam))) throw new Error("考试签名无效，请重新开始考试。");
  if (exam.bankFingerprint !== state.bank.sourceFingerprint) {
    throw new Error("考试对应的训练库已更新，请重新开始考试。");
  }
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.answer]));
  const objective = exam.questions
    .filter((question) => question.type !== "free_response")
    .map((question) => ({
      ...gradeLanguageQuestion(question, answerMap.get(question.id) ?? ""),
      criticalError: false,
    } satisfies LanguageExamGrade));
  const openQuestions = exam.questions.filter((question) => question.type === "free_response");
  let open: LanguageExamGrade[] = [];
  let model = "program";
  if (openQuestions.length) {
    const payload = openQuestions.map((question) => ({
      question,
      unit: state.bank!.units.find((unit) => unit.id === question.unitId),
      answer: answerMap.get(question.id) ?? "",
    }));
    const result = await invokeCodex<{ grades: OpenGrade[] }>("grade_language_exam", {
      rule: "只依据附带训练单元与已确认事实评分，不得补全经历；一次性批改全部开放题。",
      items: payload,
    });
    model = result.model;
    const byQuestion = new Map(
      (result.output.grades ?? []).map((grade) => [grade.questionId, grade]),
    );
    open = openQuestions.map((question) => {
      const source = byQuestion.get(question.id);
      if (!source) {
        return {
          questionId: question.id,
          unitId: question.unitId,
          score: 0,
          passed: false,
          criticalError: true,
          userAnswer: answerMap.get(question.id) ?? "",
          correctAnswer: "",
          feedbackZh: "Codex 未返回本题评分，请重新考试。",
        };
      }
      const dimensions = Object.fromEntries(
        Object.entries(source.dimensions).map(([key, value]) => [
          key,
          finite(value, 1, 5),
        ]),
      ) as LanguageOpenDimensions;
      const average = Object.values(dimensions).reduce((sum, value) => sum + value, 0) /
        Object.values(dimensions).length;
      const passed = !source.criticalError && average >= 4 && dimensions.factSafety >= 4;
      return {
        questionId: question.id,
        unitId: question.unitId,
        score: finite(source.score, 0, 100),
        passed,
        criticalError: Boolean(source.criticalError),
        dimensions,
        feedbackZh: source.feedbackZh,
        improvedAnswerJa: source.improvedAnswerJa,
        userAnswer: answerMap.get(question.id) ?? "",
        correctAnswer: "",
      };
    });
  }
  const grades = [...objective, ...open].sort(
    (left, right) =>
      exam.questions.findIndex((question) => question.id === left.questionId) -
      exam.questions.findIndex((question) => question.id === right.questionId),
  );
  const unitResults = [...new Set(grades.map((grade) => grade.unitId))].map((unitId) => {
    const unit = state.units.find((candidate) => candidate.id === unitId)!;
    const objectiveGrades = objective.filter((grade) => grade.unitId === unitId);
    const openGrades = open.filter((grade) => grade.unitId === unitId);
    const objectiveScore = objectiveGrades.length
      ? objectiveGrades.reduce((sum, grade) => sum + grade.score, 0) / objectiveGrades.length
      : 0;
    const openScore = openGrades.length
      ? openGrades.reduce((sum, grade) => sum + grade.score, 0) / openGrades.length
      : 0;
    const criticalError = [...objectiveGrades, ...openGrades].some(
      (grade) => grade.criticalError,
    );
    if (OBJECTIVE_CATEGORIES.has(unit.category)) {
      return {
        unitId,
        score: Math.round(objectiveScore),
        passed: objectiveScore >= 80 && !criticalError,
        assessed: objectiveGrades.length > 0,
        criticalError,
      };
    }
    const assessed = objectiveScore < 80 || openGrades.length > 0;
    return {
      unitId,
      score: Math.round(openGrades.length ? (objectiveScore + openScore) / 2 : objectiveScore),
      passed:
        objectiveScore >= 80 &&
        openGrades.length > 0 &&
        openGrades.some((grade) => grade.passed) &&
        !criticalError,
      assessed,
      criticalError,
    };
  });
  const categoryScores: Partial<Record<LanguageCategory, number>> = {};
  for (const category of [...new Set(exam.questions.map((question) => question.category))]) {
    const questionIds = new Set(
      exam.questions.filter((question) => question.category === category).map((question) => question.id),
    );
    const categoryGrades = grades.filter((grade) => questionIds.has(grade.questionId));
    categoryScores[category] = Math.round(
      categoryGrades.reduce((sum, grade) => sum + grade.score, 0) / categoryGrades.length,
    );
  }
  const previous = new Map(state.units.map((unit) => [unit.id, unit.masteryStatus]));
  const report: LanguageExamReport = {
    id: crypto.randomUUID(),
    examId: exam.id,
    examName: exam.name,
    submittedAt: new Date().toISOString(),
    model,
    bankFingerprint: exam.bankFingerprint,
    score: Math.round(grades.reduce((sum, grade) => sum + grade.score, 0) / grades.length),
    categoryScores,
    questions: exam.questions,
    grades,
    unitResults,
    newlyMastered: unitResults
      .filter(
        (result) => result.assessed && result.passed && previous.get(result.unitId) !== "mastered",
      )
      .map((result) => result.unitId),
    stillUnmastered: unitResults
      .filter((result) => result.assessed && !result.passed)
      .map((result) => result.unitId),
  };
  return report;
}
