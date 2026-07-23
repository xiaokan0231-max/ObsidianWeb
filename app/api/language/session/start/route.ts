import type { LanguageCategory, LanguageSessionKind } from "@/lib/language/types";
import { errorResponse, readJson } from "@/lib/server/api";
import { createLanguageSession } from "@/lib/server/language-engine";
import { loadLanguageState } from "@/lib/server/language-store";

type Body = {
  kind?: LanguageSessionKind;
  category?: LanguageCategory;
  relatedDojoItemId?: string;
  unitIds?: string[];
};

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    const session = await createLanguageSession(await loadLanguageState(), body);
    return Response.json({ ok: true, session });
  } catch (error) {
    return errorResponse(error, "开始日语训练失败");
  }
}
