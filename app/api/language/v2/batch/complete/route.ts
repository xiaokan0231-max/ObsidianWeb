import type { LanguageBatchAction } from "@/lib/language/types";
import { errorResponse, readJson } from "@/lib/server/api";
import { invokeCodex } from "@/lib/server/codex-bridge";
import {
  batchVaultPath,
  languageCurriculumByFingerprint,
  loadLanguageV2State,
  mergeLanguageBatchCheckpoint,
  renderLanguageBatch,
  verifyLanguageBatch,
} from "@/lib/server/language-v2";
import { readAllNotes, writeNote } from "@/lib/server/obsidian";

type OpenGrade = {
  questionId: string;
  unitId: string;
  score: number;
  dimensions: Record<string, number>;
  criticalError: boolean;
  feedbackZh: string;
  improvedAnswerJa: string;
};

export async function POST(request: Request) {
  try {
    const body = await readJson<{ batchId?: string; actions?: LanguageBatchAction[] }>(request);
    const notes = await readAllNotes();
    const state = await loadLanguageV2State(notes);
    const batch = state.currentBatch;
    if (!batch || batch.id !== body.batchId) {
      const completed = state.history.find((entry) => entry.id === body.batchId && entry.completedAt);
      if (completed) return Response.json({ ok: true, state, history: completed });
      throw new Error("当前训练批次不存在。");
    }
    if (!(await verifyLanguageBatch(batch))) throw new Error("训练批次签名无效，请重新开始。");
    const curriculum = languageCurriculumByFingerprint(notes, batch.curriculumFingerprint);
    if (!curriculum) throw new Error("本批次对应的训练课程已不可用。");
    let next = mergeLanguageBatchCheckpoint(
      batch,
      curriculum,
      Array.isArray(body.actions) ? body.actions : [],
      "stress",
      batch.cursor,
    );
    const itemById = new Map(curriculum.items.map((item) => [item.id, item]));
    const openActions = next.actions.filter((action) =>
      action.phase === "stress" &&
      itemById.get(action.itemId)?.kind === "answer_strategy" &&
      action.answer?.trim(),
    ).slice(0, 5);
    if (openActions.length) {
      try {
        const result = await invokeCodex<{ grades: OpenGrade[] }>("grade_language_exam", {
          rule: "批改面试日语短回答：优先检查是否覆盖题意、结论先行、语法自然和事实安全。只依据附带证据，不得补全经历。",
          items: openActions.map((action) => ({
            question: {
              id: action.actionId,
              unitId: action.itemId,
              promptZh: itemById.get(action.itemId)?.promptZh,
              rubricZh: "覆盖题意、结论先行、日语自然、不得增加未经确认的事实。",
            },
            unit: itemById.get(action.itemId),
            answer: action.answer,
          })),
        });
        const grades = new Map((result.output.grades ?? []).map((grade) => [grade.questionId, grade]));
        next = {
          ...next,
          actions: next.actions.map((action) => {
            const grade = grades.get(action.actionId);
            if (!grade) return action;
            const values = Object.values(grade.dimensions ?? {}).filter(Number.isFinite);
            const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
            return { ...action, passed: !grade.criticalError && average >= 4 };
          }),
        };
      } catch {
        // Codex 离线不阻止本地训练完成；开放回答保留为未通过，下一批继续出现。
      }
    }
    next = mergeLanguageBatchCheckpoint(next, curriculum, [], "completed", 0);
    await writeNote(batchVaultPath(next), renderLanguageBatch(next));
    return Response.json({ ok: true, batch: next, state: await loadLanguageV2State() });
  } catch (error) {
    return errorResponse(error, "完成集中训练失败");
  }
}
