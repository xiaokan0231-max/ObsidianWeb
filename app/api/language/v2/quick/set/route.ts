import { quickDay } from "@/lib/language/quick-log";
import { errorResponse } from "@/lib/server/api";
import { buildQuickContext, parseQuickSetQuery, quickContextSet, quickContextSummary } from "@/lib/server/language-quick";
import { readAllNotes } from "@/lib/server/obsidian";

// 只读：取一组卡片不写任何东西。作答落盘在 answer 路由，所以中途关页不留半组记录。
export async function GET(request: Request) {
  try {
    const query = parseQuickSetQuery(new URL(request.url).searchParams);
    const context = await buildQuickContext(await readAllNotes());
    const headers = { "Cache-Control": "no-store" };
    if (!context.curriculum) return Response.json({ ready: false }, { headers });
    const day = quickDay(new Date().toISOString());
    return Response.json({
      ready: true,
      set: quickContextSet(context, { day, ...query }),
      summary: quickContextSummary(context, { day, size: query.size, typing: query.typing }),
    }, { headers });
  } catch (error) {
    return errorResponse(error, "无法取得快练题组");
  }
}
