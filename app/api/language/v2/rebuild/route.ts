import { tokyoParts } from "@/lib/dojo/utils";
import { errorResponse } from "@/lib/server/api";
import {
  batchVaultPath,
  buildLanguageCurriculum,
  loadLanguageV2State,
  migrateScanningBatchToCurriculum,
  renderLanguageBatch,
  renderLanguageCurriculum,
} from "@/lib/server/language-v2";
import { readAllNotes, uniquePath, writeNote } from "@/lib/server/obsidian";

export async function POST() {
  try {
    const notes = await readAllNotes();
    const previousState = await loadLanguageV2State(notes);
    const curriculum = buildLanguageCurriculum(notes);
    if (!curriculum.profile.interviewCount) throw new Error("没有可用的面试整理稿。");
    if (!curriculum.items.length) throw new Error("没有提取到已确认的日语训练项目。");
    const parts = tokyoParts();
    const path = await uniquePath(
      `80_AI分析/日本語訓練/${parts.date}_${parts.fileTime}_集中訓練カリキュラム.md`,
    );
    await writeNote(path, renderLanguageCurriculum(curriculum));
    if (previousState.currentBatch?.phase === "scan") {
      const migrated = await migrateScanningBatchToCurriculum(
        previousState.currentBatch,
        curriculum,
        previousState.progress,
        previousState.curriculum,
      );
      await writeNote(batchVaultPath(migrated), renderLanguageBatch(migrated));
    }
    return Response.json({ ok: true, path, state: await loadLanguageV2State() });
  } catch (error) {
    return errorResponse(error, "重建集中训练课程失败");
  }
}
