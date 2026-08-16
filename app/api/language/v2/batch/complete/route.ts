import type { LanguageBatchAction } from "@/lib/language/types";
import { LANGUAGE_OPEN_STRESS_LIMIT } from "@/lib/language/types";
import { errorResponse, readJson } from "@/lib/server/api";
import { invokeCodex } from "@/lib/server/codex-bridge";
import {
  batchVaultPath,
  languageBatchWriteQueue,
  languageCurriculumByFingerprint,
  loadLanguageV2State,
  mergeLanguageBatchCheckpoint,
  refreshLanguageBatchSignature,
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
    // 完了処理も批次ノートへの「読む→マージ→書き戻し」なので、checkpoint と同じ
    // 共有キューを通す。完了と自動保存が同時に走ると、後勝ちで採点結果か
    // 直前のアクションのどちらかが消える。
    const outcome = await languageBatchWriteQueue(async () => {
      const notes = await readAllNotes();
      const state = await loadLanguageV2State(notes);
      const batch = state.currentBatch;
      if (!batch || batch.id !== body.batchId) {
        const completed = state.history.find((entry) => entry.id === body.batchId && entry.completedAt);
        if (completed) return { kind: "history" as const, state, history: completed };
        throw new Error("当前训练批次不存在。");
      }
      const curriculum = languageCurriculumByFingerprint(notes, batch.curriculumFingerprint);
      if (!curriculum) throw new Error("本批次对应的训练课程已不可用。");
      const trustedBatch = await verifyLanguageBatch(batch)
        ? batch
        : await refreshLanguageBatchSignature(batch, curriculum);
      let next = mergeLanguageBatchCheckpoint(
        trustedBatch,
        curriculum,
        Array.isArray(body.actions) ? body.actions : [],
        "stress",
        trustedBatch.cursor,
      );
      const itemById = new Map(curriculum.items.map((item) => [item.id, item]));
      const openActions = next.actions.filter((action) =>
        action.phase === "stress" &&
        itemById.get(action.itemId)?.kind === "answer_strategy" &&
        action.answer?.trim(),
      ).slice(0, LANGUAGE_OPEN_STRESS_LIMIT);
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
      return { kind: "done" as const, batch: next };
    });
    if (outcome.kind === "history") {
      return Response.json({ ok: true, state: outcome.state, history: outcome.history });
    }
    return Response.json({ ok: true, batch: outcome.batch, state: await loadLanguageV2State() });
  } catch (error) {
    return errorResponse(error, "完成集中训练失败");
  }
}
