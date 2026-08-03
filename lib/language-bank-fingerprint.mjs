import { stableId } from "./dojo/utils.ts";

/** generatedAt / model を除き、練習内容そのものだけで版を識別する。 */
export function bankContentFingerprint(bank) {
  return stableId(
    "lbankcontent",
    JSON.stringify({
      units: (bank.units ?? []).map((unit) => ({
        id: unit.id,
        canonicalKey: unit.canonicalKey,
        category: unit.category,
        targetJa: unit.targetJa,
        reading: unit.reading,
        priority: unit.priority,
      })),
      questions: (bank.questionBank ?? []).map((question) => ({
        id: question.id,
        unitId: question.unitId,
        type: question.type,
        correctAnswer: question.correctAnswer,
        acceptedAnswers: question.acceptedAnswers,
        correctOrder: question.correctOrder,
      })),
    }),
  );
}
