import type { LanguageAnswer, LanguageSession } from "@/lib/language/types";
import { sanitizeFilename, tokyoParts } from "@/lib/dojo/utils";
import { errorResponse, readJson } from "@/lib/server/api";
import { completeLanguageSession } from "@/lib/server/language-engine";
import {
  loadLanguageState,
  renderLanguageSession,
} from "@/lib/server/language-store";
import { uniquePath, writeNote } from "@/lib/server/obsidian";

type Body = {
  session?: LanguageSession;
  answers?: LanguageAnswer[];
  submissionId?: string;
};

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    if (!body.session || !Array.isArray(body.answers) || !body.submissionId) {
      throw new Error("训练提交内容不完整。");
    }
    const state = await loadLanguageState();
    const duplicate = state.sessionAttempts.find(
      (attempt) => attempt.submissionId === body.submissionId,
    );
    if (duplicate) {
      return Response.json({ ok: true, attempt: duplicate, state });
    }
    const { attempt, events } = await completeLanguageSession(
      state,
      body.session,
      body.answers,
      body.submissionId,
    );
    const parts = tokyoParts();
    const path = await uniquePath(
      `30_日本語学習/瞬発訓練ログ/${parts.date}_${parts.fileTime}_${sanitizeFilename(
        body.session.kind,
      )}.md`,
    );
    await writeNote(path, renderLanguageSession(attempt, events, state.bank!));
    return Response.json({
      ok: true,
      path,
      attempt,
      state: await loadLanguageState(),
    });
  } catch (error) {
    return errorResponse(error, "记录日语训练失败");
  }
}
