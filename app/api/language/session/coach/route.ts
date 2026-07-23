import type {
  LanguageCoachFeedback,
  LanguageCoachSentence,
  LanguageCoachUnitFeedback,
  LanguageSession,
} from "@/lib/language/types";
import { sanitizeFilename, tokyoParts } from "@/lib/dojo/utils";
import { errorResponse, readJson } from "@/lib/server/api";
import { invokeCodex } from "@/lib/server/codex-bridge";
import { verifyLanguageSession } from "@/lib/server/language-engine";
import {
  loadLanguageState,
  renderLanguageCoachFeedback,
} from "@/lib/server/language-store";
import { uniquePath, writeNote } from "@/lib/server/obsidian";

type Body = {
  session?: LanguageSession;
  sentences?: LanguageCoachSentence[];
  submissionId?: string;
};

function score(value: unknown) {
  return Math.max(1, Math.min(5, typeof value === "number" && Number.isFinite(value) ? value : 1));
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    if (!body.session || !Array.isArray(body.sentences) || !body.submissionId) {
      throw new Error("造句检查内容不完整。");
    }
    if (!(await verifyLanguageSession(body.session))) {
      throw new Error("训练内容签名无效，请重新开始训练。");
    }
    const state = await loadLanguageState();
    if (!state.bank || state.bank.sourceFingerprint !== body.session.bankFingerprint) {
      throw new Error("训练库已更新，请重新开始训练。");
    }
    const duplicate = state.coachFeedbacks.find(
      (feedback) => feedback.submissionId === body.submissionId,
    );
    if (duplicate) return Response.json({ ok: true, feedback: duplicate });
    const allowedUnitIds = new Set(body.session.unitIds);
    const sentences = body.sentences
      .filter(
        (sentence) =>
          allowedUnitIds.has(sentence.unitId) &&
          typeof sentence.text === "string" &&
          sentence.text.trim(),
      )
      .slice(0, 10)
      .map((sentence) => ({ ...sentence, text: sentence.text.trim().slice(0, 1200) }));
    if (!sentences.length) throw new Error("请至少输入一个日语造句。");
    const units = sentences.map((sentence) => ({
      sentence,
      unit: state.bank!.units.find((unit) => unit.id === sentence.unitId),
    }));
    const result = await invokeCodex<{
      summaryZh?: string;
      factualRisk?: boolean;
      unitFeedbacks?: Array<Record<string, unknown>>;
    }>("coach_language_output", { units });
    const byUnit = new Map(
      (result.output.unitFeedbacks ?? []).map((item) => [text(item.unitId), item]),
    );
    const unitFeedbacks: LanguageCoachUnitFeedback[] = sentences.map((sentence) => {
      const item = byUnit.get(sentence.unitId) ?? {};
      return {
        unitId: sentence.unitId,
        meaning: score(item.meaning),
        grammar: score(item.grammar),
        naturalness: score(item.naturalness),
        register: score(item.register),
        speakability: score(item.speakability),
        factSafety: score(item.factSafety),
        criticalError: Boolean(item.criticalError),
        feedbackZh: text(item.feedbackZh) || "Codex 未返回具体点评。",
        correctedJa: text(item.correctedJa),
      };
    });
    const feedback: LanguageCoachFeedback = {
      id: crypto.randomUUID(),
      submissionId: body.submissionId,
      sessionId: body.session.id,
      submittedAt: new Date().toISOString(),
      bankFingerprint: body.session.bankFingerprint,
      model: result.model,
      summaryZh: text(result.output.summaryZh),
      factualRisk:
        Boolean(result.output.factualRisk) || unitFeedbacks.some((item) => item.criticalError),
      unitFeedbacks,
    };
    const parts = tokyoParts();
    const path = await uniquePath(
      `30_日本語学習/瞬発訓練ログ/${parts.date}_${parts.fileTime}_${sanitizeFilename(
        body.session.kind,
      )}_教练.md`,
    );
    await writeNote(path, renderLanguageCoachFeedback(feedback));
    return Response.json({ ok: true, path, feedback });
  } catch (error) {
    return errorResponse(error, "Codex 造句检查失败");
  }
}
