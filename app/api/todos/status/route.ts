import { TODO_STATUS } from "@/lib/memory-atlas-data";
import { errorResponse, parseExpectedMtime, parseRequiredText, readJson } from "@/lib/server/api";
import { patchFrontmatterScalars } from "@/lib/server/frontmatter-patch";
import { readNote, readNoteOrNull, writeNote } from "@/lib/server/obsidian";
import { createKeyedSerialQueue } from "@/lib/server/serial-queue";

type Body = {
  path?: string;
  status?: string;
  /** 上一次已知的笔记 mtime；有值时用来做并发保护。 */
  expectedMtime?: number;
};

const TODO_ROOT = "20_求職/_TODO/";
const inTodoQueue = createKeyedSerialQueue();

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    const path = parseRequiredText(body.path, "path");
    const status = parseRequiredText(body.status, "status");
    const expectedMtime = parseExpectedMtime(body.expectedMtime);
    if (!path.startsWith(TODO_ROOT) || !path.toLowerCase().endsWith(".md") || path.includes("..")) {
      throw new Error(`只允许修改 ${TODO_ROOT} 下的行动笔记。`);
    }
    if (!TODO_STATUS.includes(status)) throw new Error(`未知的行动状态：${status || "(空)"}`);

    return await inTodoQueue(path, async () => {
      const note = await readNote(path);
      if (note.frontmatter.type !== "todo") throw new Error("这条笔记不是 todo，拒绝写入。");
      if (expectedMtime !== undefined && note.stat.mtime !== expectedMtime) {
        const conflict = new Error("状态已更新，版本不一致。请刷新后重试。");
        (conflict as { status?: number }).status = 409;
        throw conflict;
      }
      if (note.frontmatter.status === status) {
        return Response.json({ ok: true, path, status, unchanged: true, note });
      }
      const content = patchFrontmatterScalars(note.content, { status });
      await writeNote(path, content);
      // mtime は楽観ロックの版そのもの。Date.now() を返すと次のクリックが必ず 409 になるので、
      // 書いた直後にディスクの stat を読み直して返す（内容と frontmatter は手元の値を使う）。
      const written = await readNoteOrNull(path);
      return Response.json({
        ok: true,
        path,
        status,
        note: {
          ...note,
          content,
          stat: written?.stat ?? { ...note.stat, mtime: Date.now(), size: content.length },
          frontmatter: { ...note.frontmatter, status },
        },
      });
    });
  } catch (error) {
    return errorResponse(error, "更新行动状态失败");
  }
}
