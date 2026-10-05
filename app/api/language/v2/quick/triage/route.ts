import { errorResponse } from "@/lib/server/api";
import { buildQuickContext, parseQuickTriageQuery, quickContextTriage } from "@/lib/server/language-quick";
import { readAllNotes } from "@/lib/server/obsidian";

// 「一屏过一遍」的下一批（只读）。判断由 POST answer 以 action=triage 落盘，这里不写任何东西：
// 中途关页不留半屏记录，重复取同一份数据得到同一批。
export async function GET(request: Request) {
  try {
    const query = parseQuickTriageQuery(new URL(request.url).searchParams);
    const context = await buildQuickContext(await readAllNotes());
    return Response.json(quickContextTriage(context, query), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "无法取得分流条目");
  }
}
