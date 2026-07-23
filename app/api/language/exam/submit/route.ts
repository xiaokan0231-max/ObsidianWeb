import type { LanguageAnswer, LanguageExamDefinition } from "@/lib/language/types";
import { sanitizeFilename, tokyoParts } from "@/lib/dojo/utils";
import { errorResponse, readJson } from "@/lib/server/api";
import { gradeLanguageExam } from "@/lib/server/language-engine";
import {
  loadLanguageState,
  renderLanguageExamReport,
} from "@/lib/server/language-store";
import { uniquePath, writeNote } from "@/lib/server/obsidian";

type Body = { exam?: LanguageExamDefinition; answers?: LanguageAnswer[] };

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    if (!body.exam || !Array.isArray(body.answers)) {
      throw new Error("考试提交内容不完整。");
    }
    if (body.exam.questions.length > 20 || body.answers.length > 20) {
      throw new Error("一场考试最多允许20题。");
    }
    const state = await loadLanguageState();
    const report = await gradeLanguageExam(state, body.exam, body.answers);
    const parts = tokyoParts();
    const path = await uniquePath(
      `30_日本語学習/言語試験ログ/${parts.date}_${parts.fileTime}_${sanitizeFilename(
        report.examName,
      )}.md`,
    );
    await writeNote(path, renderLanguageExamReport(report));
    return Response.json({
      ok: true,
      path,
      report,
      state: await loadLanguageState(),
    });
  } catch (error) {
    return errorResponse(error, "提交日语考试失败");
  }
}
