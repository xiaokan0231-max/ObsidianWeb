import { errorResponse } from "@/lib/server/api";
import { loadLanguageV2State } from "@/lib/server/language-v2";

export async function GET() {
  try {
    return Response.json(await loadLanguageV2State(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "无法读取集中训练状态");
  }
}
