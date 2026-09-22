import { JOB_CASE_ROOT, JOB_CASE_TYPE } from "@/lib/jobs";
import { WAITING_FOR_VALUES } from "@/lib/job-case-schema";
import { errorResponse, parseRequiredText, readJson } from "@/lib/server/api";
import { patchFrontmatterScalars } from "@/lib/server/frontmatter-patch";
import { readNote, writeNote } from "@/lib/server/obsidian";
import { createKeyedSerialQueue } from "@/lib/server/serial-queue";

type Body = {
  path?: string;
  waitingFor?: string | null;
  followUpAt?: string | null;
  nextEventAt?: string | null;
};

const DATE = /^20\d{2}-\d{2}-\d{2}$/;
const DATE_TIME = /^20\d{2}-\d{2}-\d{2}(?: (?:[01]\d|2[0-3]):[0-5]\d)?$/;
const inFollowUpQueue = createKeyedSerialQueue();

function normalized(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const text = value?.trim() ?? "";
  return text || null;
}

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    const path = parseRequiredText(body.path, "path");
    if (!path.startsWith(JOB_CASE_ROOT) || !path.toLowerCase().endsWith(".md") || path.includes("..")) {
      throw new Error(`只允许修改 ${JOB_CASE_ROOT} 下的应募案件。`);
    }

    const waitingFor = normalized(body.waitingFor);
    const followUpAt = normalized(body.followUpAt);
    const nextEventAt = normalized(body.nextEventAt);
    if (waitingFor === undefined && followUpAt === undefined && nextEventAt === undefined) {
      throw new Error("没有提交可更新的跟进字段。");
    }
    if (waitingFor && !WAITING_FOR_VALUES.includes(waitingFor)) throw new Error(`未知的等待对象：${waitingFor}`);
    if (followUpAt && !DATE.test(followUpAt)) throw new Error("follow_up_at 必须是 YYYY-MM-DD。");
    if (nextEventAt && !DATE_TIME.test(nextEventAt)) throw new Error("next_event_at 必须是 YYYY-MM-DD 或 YYYY-MM-DD HH:MM。");

    return await inFollowUpQueue(path, async () => {
      const note = await readNote(path);
      if (note.frontmatter.type !== JOB_CASE_TYPE) throw new Error("这条笔记不是应募案件，拒绝写入。");
      const effectiveWaitingFor = waitingFor === undefined
        ? String(note.frontmatter.waiting_for ?? "").trim() || null
        : waitingFor;
      const effectiveFollowUp = followUpAt === undefined
        ? String(note.frontmatter.follow_up_at ?? "").trim() || null
        : followUpAt;
      if (effectiveFollowUp && !effectiveWaitingFor) throw new Error("设置跟进日期前必须选择等待对象。");

      const updates: Record<string, string | null> = {};
      if (waitingFor !== undefined) updates.waiting_for = waitingFor;
      if (followUpAt !== undefined) updates.follow_up_at = followUpAt;
      if (nextEventAt !== undefined) updates.next_event_at = nextEventAt;
      if (waitingFor === null && followUpAt === undefined) updates.follow_up_at = null;
      const content = patchFrontmatterScalars(note.content, updates);
      await writeNote(path, content);
      const frontmatter = { ...note.frontmatter };
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) delete frontmatter[key];
        else frontmatter[key] = value;
      }
      return Response.json({
        ok: true,
        path,
        note: {
          ...note,
          content,
          stat: { ...note.stat, mtime: Date.now(), size: content.length },
          frontmatter,
        },
      });
    });
  } catch (error) {
    return errorResponse(error, "更新案件跟进失败");
  }
}
