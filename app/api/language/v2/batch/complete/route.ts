import type { LanguageBatch, LanguageBatchAction, LanguageCurriculum } from "@/lib/language/types";
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

/**
 * 開放回答の採点。**キューの外で呼ぶ**こと——外部プロセス（Codex Bridge）待ちで、
 * 相手が接続だけ受けて黙り込むと undici の既定（約 300 秒）まで返らない。
 * これをキューの中で待つと、その間 自動保存・「保存して総覧へ」・beforeunload の
 * keepalive まで同じ直列区間に積まれて全部固まる。
 */
async function gradeOpenAnswers(
  batch: LanguageBatch,
  curriculum: LanguageCurriculum,
): Promise<Map<string, boolean>> {
  const itemById = new Map(curriculum.items.map((item) => [item.id, item]));
  const openActions = batch.actions.filter((action) =>
    action.phase === "stress" &&
    itemById.get(action.itemId)?.kind === "answer_strategy" &&
    action.answer?.trim(),
  ).slice(0, LANGUAGE_OPEN_STRESS_LIMIT);
  if (!openActions.length) return new Map();

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
    const passed = new Map<string, boolean>();
    for (const grade of result.output.grades ?? []) {
      const values = Object.values(grade.dimensions ?? {}).filter(Number.isFinite);
      const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      passed.set(grade.questionId, !grade.criticalError && average >= 4);
    }
    return passed;
  } catch {
    // Codex 离线不阻止本地训练完成；开放回答保留为未通过，下一批继续出现。
    return new Map();
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{ batchId?: string; actions?: LanguageBatchAction[] }>(request);

    // ① キュー内：読む・検証・本人のアクションを取り込んで**一旦保存する**。
    //    ここで書いておけば、この後の採点が遅くても・落ちても、本人の回答は残る。
    const staged = await languageBatchWriteQueue(async () => {
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
      const merged = mergeLanguageBatchCheckpoint(
        trustedBatch,
        curriculum,
        Array.isArray(body.actions) ? body.actions : [],
        "stress",
        trustedBatch.cursor,
      );
      await writeNote(batchVaultPath(merged), renderLanguageBatch(merged));
      return { kind: "staged" as const, batch: merged, curriculum };
    });
    if (staged.kind === "history") {
      return Response.json({ ok: true, state: staged.state, history: staged.history });
    }

    // ② キューの外：採点（外部プロセス待ち）。ここを握らないのが要点。
    const passedByActionId = await gradeOpenAnswers(staged.batch, staged.curriculum);

    // ③ キュー内：最新の批次を読み直してから採点を反映し、完了させる。
    //    ②の間に自動保存が走って新しいアクションが増えている可能性があるので、
    //    ①で手元にあった批次ではなく、その時点の正本に対して適用する。
    const finished = await languageBatchWriteQueue(async () => {
      const state = await loadLanguageV2State();
      const current = state.currentBatch?.id === staged.batch.id ? state.currentBatch : staged.batch;
      const graded = passedByActionId.size === 0
        ? current
        : {
            ...current,
            actions: current.actions.map((action) => {
              const passed = passedByActionId.get(action.actionId);
              return passed === undefined ? action : { ...action, passed };
            }),
          };
      const next = mergeLanguageBatchCheckpoint(graded, staged.curriculum, [], "completed", 0);
      await writeNote(batchVaultPath(next), renderLanguageBatch(next));
      return next;
    });

    return Response.json({ ok: true, batch: finished, state: await loadLanguageV2State() });
  } catch (error) {
    return errorResponse(error, "完成集中训练失败");
  }
}
