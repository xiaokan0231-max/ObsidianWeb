import { errorResponse } from "@/lib/server/api";
import { loadLanguageState } from "@/lib/server/language-store";

export async function GET() {
  try {
    return Response.json(await loadLanguageState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "无法读取日语训练状态");
  }
}
