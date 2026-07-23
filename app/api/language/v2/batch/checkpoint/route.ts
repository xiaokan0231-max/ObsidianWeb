import type { LanguageBatchAction, LanguageBatchPhase } from "@/lib/language/types";
import { errorResponse, readJson } from "@/lib/server/api";
import {
  batchVaultPath,
  languageCurriculumByFingerprint,
  loadLanguageV2State,
  mergeLanguageBatchCheckpoint,
  renderLanguageBatch,
  verifyLanguageBatch,
} from "@/lib/server/language-v2";
import { readAllNotes, writeNote } from "@/lib/server/obsidian";

type Body = {
  batchId?: string;
  actions?: LanguageBatchAction[];
  nextPhase?: LanguageBatchPhase;
  cursor?: number;
};

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    const notes = await readAllNotes();
    const state = await loadLanguageV2State(notes);
    const batch = state.currentBatch;
    if (!batch || batch.id !== body.batchId) throw new Error("当前训练批次不存在或已经完成。");
    if (!(await verifyLanguageBatch(batch))) throw new Error("训练批次签名无效，请重新开始。");
    const curriculum = languageCurriculumByFingerprint(notes, batch.curriculumFingerprint);
    if (!curriculum) throw new Error("本批次对应的训练课程已不可用。");
    const next = mergeLanguageBatchCheckpoint(
      batch,
      curriculum,
      Array.isArray(body.actions) ? body.actions : [],
      body.nextPhase,
      Number.isFinite(body.cursor) ? Number(body.cursor) : batch.cursor,
    );
    await writeNote(batchVaultPath(next), renderLanguageBatch(next));
    return Response.json({ ok: true, batch: next, state: await loadLanguageV2State() });
  } catch (error) {
    return errorResponse(error, "自动保存集中训练失败");
  }
}
