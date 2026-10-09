import type { LanguageBank, LanguageCategory } from "@/lib/language/types";
import { tokyoParts } from "@/lib/dojo/utils";
import { errorResponse, readJson } from "@/lib/server/api";
import { invokeCodex } from "@/lib/server/codex-bridge";
import { loadDojoState } from "@/lib/server/dojo-store";
import {
  buildLanguageSourceContext,
  languageBankContentFingerprint,
  latestLanguageBankEntry,
  loadLanguageState,
  normalizeLanguageBank,
  renderLanguageBank,
} from "@/lib/server/language-store";
import { supersedeCurrentArtifacts } from "@/lib/server/generated-artifact";
import { readAllNotes, uniquePath, writeNote } from "@/lib/server/obsidian";

const CATEGORY_GOALS: Record<LanguageCategory, number> = {
  numbers_reading: 12,
  vocabulary: 20,
  technical_vocabulary: 30,
  grammar: 20,
  particles_collocations: 16,
  interview_expression: 20,
  business_expression: 14,
  delivery_buffer: 14,
};

function isCategory(value: unknown): value is LanguageCategory {
  return typeof value === "string" && Object.hasOwn(CATEGORY_GOALS, value);
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{ category?: unknown }>(request);
    if (!isCategory(body.category)) throw new Error("请选择要扩充的日语训练分类。");

    const notes = await readAllNotes();
    const source = buildLanguageSourceContext(notes);
    const [state, dojoState] = await Promise.all([
      loadLanguageState(notes),
      loadDojoState(notes),
    ]);
    if (!state.bank) throw new Error("请先建立基础日语训练库。");
    if (state.stale) throw new Error("Vault 已有新资料，请先重建训练库，再扩充分类。");

    const existingInCategory = state.bank.units.filter(
      (unit) => unit.category === body.category,
    );
    const requestedCount = Math.max(
      10,
      CATEGORY_GOALS[body.category] - existingInCategory.length,
    );
    const result = await invokeCodex<Record<string, unknown>>(
      "expand_language_category",
      {
        category: body.category,
        requestedCount,
        sourceContext: source.sourceContext,
        existingUnits: state.bank.units.map((unit) => ({
          id: unit.id,
          canonicalKey: unit.canonicalKey,
          category: unit.category,
          titleZh: unit.titleZh,
          targetJa: unit.targetJa,
        })),
        dojoItems: dojoState.items.map((item) => ({
          id: item.id,
          category: item.category,
          titleZh: item.titleZh,
          targetJa: item.targetJa,
        })),
        sourceTrustPolicy: {
          authority: "self 为本人确认事实",
          evidence: "transcript/review/company/policy 可作为直接证据",
          reference: "study/material/ai-report 只用于通用语言线索",
        },
      },
    );
    const generated = normalizeLanguageBank(
      result.output,
      {
        generatedAt: new Date().toISOString(),
        model: result.model,
        sourceFingerprint: source.sourceFingerprint,
        sourceCount: source.sourceCount,
      },
      state.bank.units,
      notes,
    );
    const existingKeys = new Set(state.bank.units.map((unit) => unit.canonicalKey));
    const existingTargets = new Set(
      state.bank.units.map((unit) => `${unit.category}|${unit.targetJa.normalize("NFKC").trim()}`),
    );
    const additions = generated.units.filter(
      (unit) =>
        unit.category === body.category &&
        !existingKeys.has(unit.canonicalKey) &&
        !existingTargets.has(`${unit.category}|${unit.targetJa.normalize("NFKC").trim()}`),
    );
    const minimum = Math.min(8, requestedCount);
    if (additions.length < minimum) {
      throw new Error(
        `Codex 只生成了 ${additions.length} 个不重复单元，低于本次最低 ${minimum} 个；训练库没有修改。`,
      );
    }

    const addedIds = new Set(additions.map((unit) => unit.id));
    const nextBank: LanguageBank = {
      ...state.bank,
      generatedAt: new Date().toISOString(),
      model: result.model,
      sourceFingerprint: source.sourceFingerprint,
      sourceCount: source.sourceCount,
      summaryZh: `当前共有 ${state.bank.units.length + additions.length} 个日语训练单元；本次新增 ${additions.length} 个分类内容。`,
      immediateAdviceZh: generated.immediateAdviceZh || state.bank.immediateAdviceZh,
      units: [...state.bank.units, ...additions],
      questionBank: [
        ...state.bank.questionBank,
        ...generated.questionBank.filter((question) => addedIds.has(question.unitId)),
      ],
    };
    const bank: LanguageBank = {
      ...nextBank,
      contentFingerprint: languageBankContentFingerprint(nextBank),
    };
    const latest = latestLanguageBankEntry(notes);
    if (latest?.bank.contentFingerprint === bank.contentFingerprint) {
      return Response.json({
        ok: true,
        unchanged: true,
        path: latest.note.path,
        added: 0,
        state,
      });
    }
    const parts = tokyoParts();
    const path = await uniquePath(
      `80_AI分析/日本語訓練/${parts.date}_${parts.fileTime}_${body.category}_拡充.md`,
    );
    await writeNote(path, renderLanguageBank(bank));
    await supersedeCurrentArtifacts(notes, "language-bank");
    return Response.json({
      ok: true,
      path,
      added: additions.length,
      state: await loadLanguageState(),
    });
  } catch (error) {
    return errorResponse(error, "扩充日语训练分类失败");
  }
}
