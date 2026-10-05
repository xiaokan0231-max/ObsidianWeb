import type { QuickEvent } from "@/lib/language/quick-types";
import { appendQuickEvents, parseQuickEvents, quickLogFrontmatter, quickLogPath } from "@/lib/language/quick-log";
import { errorResponse, obsidianErrorResponse, readJson } from "@/lib/server/api";
import {
  buildQuickContext,
  parseQuickAnswerBody,
  planQuickAnswers,
  settleQuickAnswers,
} from "@/lib/server/language-quick";
import { languageBatchWriteQueue } from "@/lib/server/language-v2";
import { upsertAppendNote } from "@/lib/server/note-append";
import { readAllNotes } from "@/lib/server/obsidian";

function conflict(message: string) {
  // 普通 Error 里含「没有/请先」会被 errorResponse 映成 400；没有课程是状态问题，要显式给 409。
  return Object.assign(new Error(message), { status: 409 });
}

export async function POST(request: Request) {
  try {
    const body = parseQuickAnswerBody(await readJson<unknown>(request));
    // 与课程重建、旧批次保存同一条车道：「全库去重→追加」之间不能插进别的写入，
    // 否则两次重发同一条会各自判成新事件，重建也可能在判分后换掉题库。
    const outcome = await languageBatchWriteQueue(async () => {
      const notes = await readAllNotes();
      const context = await buildQuickContext(notes);
      if (!context.curriculum) throw conflict("还没有训练课程，请先在训练页更新训练画像。");
      // 作答时刻只认服务端：练习日（日本时间 04:00 起算）、首答与间隔都从它算，客户端时钟偏了也不影响。
      // 作答之外的动作（不再出 / 撤销排除 / 太简单 / 分流）同走这一条：同一套去重、同一条写入车道。
      const at = new Date().toISOString();
      const plan = planQuickAnswers(context, body, at);
      let written: QuickEvent[] = [];
      let path: string | undefined;
      if (plan.events.length) {
        path = quickLogPath(plan.day);
        // 整份笔记组好后一次 PUT：写失败时什么都不留，不会出现半条事件。
        const appended = await upsertAppendNote<QuickEvent[]>({
          path,
          plan: (existing) => {
            // 队列外的写入者（另一台机器的同步、手动粘贴）可能刚写过同一条；落盘前在本文件里再查一次。
            const present = new Set(existing ? parseQuickEvents(existing.content).map((event) => event.eventId) : []);
            const fresh = plan.events.filter((event) => !present.has(event.eventId));
            if (!fresh.length) return { duplicate: [] };
            return {
              nextContent: appendQuickEvents(existing?.content ?? null, plan.day, fresh),
              value: fresh,
              frontmatterForNew: quickLogFrontmatter(plan.day.slice(0, 7)),
            };
          },
        });
        written = appended.value;
      }
      return { path, ...settleQuickAnswers(context, plan, written) };
    });
    return Response.json({ ok: true, ...outcome });
  } catch (error) {
    if (error instanceof Error && Number.isInteger((error as { status?: number }).status)) {
      return errorResponse(error, "快练作答保存失败");
    }
    return obsidianErrorResponse(error, "快练作答保存失败");
  }
}
