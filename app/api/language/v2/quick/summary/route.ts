import { quickDay } from "@/lib/language/quick-log";
import { errorResponse } from "@/lib/server/api";
import { buildQuickContext, parseQuickSetQuery, quickContextSummary } from "@/lib/server/language-quick";
import { readAllNotes } from "@/lib/server/obsidian";

// 总览数字。没有课程时也返回（ready:false），単語文法帳的解析条数仍有参考价值。
export async function GET(request: Request) {
  try {
    const { size, typing } = parseQuickSetQuery(new URL(request.url).searchParams);
    const context = await buildQuickContext(await readAllNotes());
    return Response.json(
      quickContextSummary(context, { day: quickDay(new Date().toISOString()), size, typing }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, "无法读取快练总览");
  }
}
