import { quickDay } from "@/lib/language/quick-log";
import { errorResponse } from "@/lib/server/api";
import {
  buildQuickContext,
  parseQuickSetQuery,
  quickContextSet,
  quickContextSummary,
  quickFocusEmpty,
} from "@/lib/server/language-quick";
import { readAllNotes } from "@/lib/server/obsidian";

// 只读：取一组卡片不写任何东西。作答落盘在 answer 路由，所以中途关页不留半组记录。
// focus＝错误型时只在该型里出题；取不到卡也回 200，用 emptyReason 说明是没有这个型、没有可出题条目，还是现在没题。
export async function GET(request: Request) {
  try {
    const query = parseQuickSetQuery(new URL(request.url).searchParams);
    const context = await buildQuickContext(await readAllNotes());
    const headers = { "Cache-Control": "no-store" };
    if (!context.curriculum) return Response.json({ ready: false }, { headers });
    const day = quickDay(new Date().toISOString());
    const set = quickContextSet(context, { day, ...query });
    return Response.json({
      ready: true,
      set,
      summary: quickContextSummary(context, { day, size: query.size, typing: query.typing }),
      ...(query.focus && !set.cards.length ? quickFocusEmpty(context, query.focus, query.typing) : {}),
    }, { headers });
  } catch (error) {
    return errorResponse(error, "无法取得快练题组");
  }
}
