import { getString, getType } from "@/lib/notes";
import { buildUserActions } from "@/lib/user-actions";
import { tokyoParts } from "@/lib/dojo/utils";
import { assertExpectedMtime, badRequestError, errorResponse, parseExpectedMtime, parseRequiredText, readJson } from "@/lib/server/api";
import { patchFrontmatterScalars } from "@/lib/server/frontmatter-patch";
import { readAllNotes, readNote, readNoteOrNull, writeNote } from "@/lib/server/obsidian";
import { withTodoWrite } from "@/lib/server/todo-write-queue";

type Body = { path?: unknown; resolution?: unknown; resolutionNote?: unknown; expectedMtime?: unknown };

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequestError("请求必须是对象。");
    const path = parseRequiredText(body.path, "path");
    const resolution = parseRequiredText(body.resolution, "resolution");
    const reason = parseRequiredText(body.resolutionNote, "resolutionNote");
    const expectedMtime = parseExpectedMtime(body.expectedMtime);
    if (!path.startsWith("20_求職/") || !path.endsWith(".md") || path.includes("..") || /[\\\r\n]/.test(path)) throw badRequestError("只能更新求职待办笔记。");
    if (!["completed", "cancelled"].includes(resolution)) throw badRequestError("未知的处理结果。");
    if (expectedMtime === undefined) throw badRequestError("必须提供笔记版本，请刷新后重试。");
    if (reason.length > 500 || /[\r\n]/.test(reason)) throw badRequestError("处理说明限500字的单行文字。");

    return await withTodoWrite(path, async () => {
      const note = await readNote(path);
      if (getType(note) !== "todo") throw badRequestError("这条笔记不是待办。");
      assertExpectedMtime(expectedMtime, note.stat.mtime);
      const { date: today } = tokyoParts();
      // 只记录本人对现行具体行动的处理；阅读、等待与可选建议不会被写成完成。
      const notes = await readAllNotes();
      const current = buildUserActions([...notes.filter((item) => item.path !== path), note], today).current;
      if (!current.some((item) => item.note.path === path)) throw badRequestError("此项不是经核实的当前本人行动，请先核对来源和现状。");
      const updates = {
        status: resolution === "completed" ? "完了" : "保留",
        ...(resolution === "cancelled" ? { action_kind: "history" } : {}),
        action_resolution: resolution,
        action_resolved_at: today,
        action_resolution_note: JSON.stringify(reason),
        updated: today,
        focus: null,
        focus_until: null,
      };
      await writeNote(path, patchFrontmatterScalars(note.content, updates));
      const written = await readNoteOrNull(path);
      if (!written || getString(written.frontmatter.action_resolution) !== resolution || getString(written.frontmatter.status) !== updates.status || getString(written.frontmatter.action_resolution_note) !== reason
        || getString(written.frontmatter.action_resolved_at) !== today || getString(written.frontmatter.updated) !== today
        || (resolution === "cancelled" && written.frontmatter.action_kind !== "history")
        || written.frontmatter.focus !== undefined || written.frontmatter.focus_until !== undefined) {
        throw new Error("写入后回读未确认，刷新原笔记核对后再操作。");
      }
      return Response.json({ ok: true, note: written });
    });
  } catch (error) {
    return errorResponse(error, "记录待办处理结果失败");
  }
}
