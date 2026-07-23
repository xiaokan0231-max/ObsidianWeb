import type { LanguageCategory, LanguageExamKind } from "@/lib/language/types";
import { errorResponse, readJson } from "@/lib/server/api";
import { createLanguageExam } from "@/lib/server/language-engine";
import { loadLanguageState } from "@/lib/server/language-store";

type Body = {
  kind?: LanguageExamKind;
  category?: LanguageCategory;
  includeUntrained?: boolean;
  unitIds?: string[];
};

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    const exam = await createLanguageExam(await loadLanguageState(), body);
    return Response.json({ ok: true, exam });
  } catch (error) {
    return errorResponse(error, "生成日语考试失败");
  }
}
