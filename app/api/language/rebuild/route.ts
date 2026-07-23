import { tokyoParts } from "@/lib/dojo/utils";
import { errorResponse } from "@/lib/server/api";
import { invokeCodex } from "@/lib/server/codex-bridge";
import { loadDojoState } from "@/lib/server/dojo-store";
import {
  buildLanguageSourceContext,
  loadLanguageState,
  normalizeLanguageBank,
  renderLanguageBank,
} from "@/lib/server/language-store";
import { readAllNotes, uniquePath, writeNote } from "@/lib/server/obsidian";

export async function POST() {
  try {
    const notes = await readAllNotes();
    const source = buildLanguageSourceContext(notes);
    if (!source.sourceCount) throw new Error("Vault 中没有可用于训练库的资料。");
    const [previousState, dojoState] = await Promise.all([
      loadLanguageState(notes),
      loadDojoState(notes),
    ]);
    const result = await invokeCodex<Record<string, unknown>>("rebuild_language_bank", {
      sourceTrustPolicy: {
        authority: "self 为本人确认事实",
        evidence: "transcript/review/company/policy 可作为直接证据",
        reference: "study/material 只用于语言线索，不能自动成为本人事实",
        hypothesis: "ai-report 只作为待验证线索",
      },
      sourceContext: source.sourceContext,
      previousUnits:
        previousState.bank?.units.map((unit) => ({
          id: unit.id,
          canonicalKey: unit.canonicalKey,
          category: unit.category,
          titleZh: unit.titleZh,
          targetJa: unit.targetJa,
        })) ?? [],
      dojoItems: dojoState.items.map((item) => ({
        id: item.id,
        category: item.category,
        titleZh: item.titleZh,
        targetJa: item.targetJa,
        masteryStatus: item.masteryStatus,
        latestScore: item.latestScore,
      })),
      history: {
        recentTraining: previousState.trainingEvents.slice(-300),
        recentExams: previousState.examReports.slice(0, 40).map((report) => ({
          submittedAt: report.submittedAt,
          unitResults: report.unitResults,
          feedback: report.grades.map((grade) => ({
            unitId: grade.unitId,
            score: grade.score,
            feedbackZh: grade.feedbackZh,
          })),
        })),
      },
    });
    const bank = normalizeLanguageBank(
      result.output,
      {
        generatedAt: new Date().toISOString(),
        model: result.model,
        sourceFingerprint: source.sourceFingerprint,
        sourceCount: source.sourceCount,
      },
      previousState.bank?.units ?? [],
      notes,
    );
    if (bank.units.length < 36) {
      throw new Error(
        `Codex 只生成了 ${bank.units.length} 个有效单元，低于最低36个；训练库没有写入，请重试。`,
      );
    }
    const parts = tokyoParts();
    const path = await uniquePath(
      `80_AI分析/日本語訓練/${parts.date}_${parts.fileTime}_日本語訓練バンク.md`,
    );
    await writeNote(path, renderLanguageBank(bank));
    return Response.json({ ok: true, path, state: await loadLanguageState() });
  } catch (error) {
    return errorResponse(error, "建立日语训练库失败");
  }
}
