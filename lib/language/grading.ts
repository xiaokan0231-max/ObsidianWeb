import type {
  LanguageAnswer,
  LanguageDrill,
  LanguageDrillGrade,
  LanguageExamQuestion,
} from "./types";

function normalizeAnswer(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ja")
    .replace(/[\s、。,.!?！？「」『』（）()・･:：;；/／\-‐‑–—~〜～]/g, "");
}

function orderingAnswer(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function gradeLanguageQuestion(
  question: LanguageDrill | LanguageExamQuestion,
  answer: string,
): LanguageDrillGrade {
  const explanation = "explanationZh" in question ? question.explanationZh : "";
  if (question.type === "ordering") {
    const order = orderingAnswer(answer);
    const expected = question.correctOrder;
    const passed =
      expected.length > 0 &&
      order.length === expected.length &&
      expected.every(
        (part, index) => normalizeAnswer(part) === normalizeAnswer(order[index] ?? ""),
      );
    return {
      questionId: question.id,
      unitId: question.unitId,
      score: passed ? 100 : 0,
      passed,
      userAnswer: order.join(" → "),
      correctAnswer: expected.join(" → "),
      feedbackZh: passed ? "顺序正确。" : explanation || "顺序不正确。",
    };
  }
  const accepted = [question.correctAnswer, ...question.acceptedAnswers]
    .filter((value): value is string => Boolean(value))
    .map(normalizeAnswer);
  const passed = Boolean(normalizeAnswer(answer)) && accepted.includes(normalizeAnswer(answer));
  return {
    questionId: question.id,
    unitId: question.unitId,
    score: passed ? 100 : 0,
    passed,
    userAnswer: answer,
    correctAnswer: question.correctAnswer ?? question.acceptedAnswers[0] ?? "",
    feedbackZh: passed
      ? "回答正确。"
      : explanation || "答案与本单元的目标表达不一致。",
  };
}

export function gradeLanguageDrills(
  questions: Array<LanguageDrill | LanguageExamQuestion>,
  answers: LanguageAnswer[],
) {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.answer]));
  const grades = questions.map((question) =>
    gradeLanguageQuestion(question, answerMap.get(question.id) ?? ""),
  );
  const score = grades.length
    ? Math.round(grades.reduce((sum, grade) => sum + grade.score, 0) / grades.length)
    : 0;
  return { score, grades };
}
