import { tokyoParts } from "@/lib/dojo/utils";
import {
  isJobStatus,
  JOB_CASE_ROOT,
  JOB_CASE_TYPE,
  statusRequiresChannel,
} from "@/lib/jobs";
import { errorResponse, readJson } from "@/lib/server/api";
import { readNote, writeNote } from "@/lib/server/obsidian";

type Body = {
  path?: string;
  status?: string;
};

const FRONTMATTER = /^---\n([\s\S]*?)\n---(\r?\n|$)/;

/** 只改 status / status_updated 两行，笔记正文和其他 frontmatter 原样保留。 */
function applyStatus(content: string, status: string, date: string) {
  const matched = content.match(FRONTMATTER);
  if (!matched) throw new Error("这条岗位笔记没有 frontmatter，无法安全改写。");

  const lines = matched[1].split("\n");
  const replaceOrAppend = (key: string, value: string) => {
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (index >= 0) lines[index] = `${key}: ${value}`;
    else lines.push(`${key}: ${value}`);
  };
  replaceOrAppend("status", status);
  replaceOrAppend("status_updated", date);

  return `---\n${lines.join("\n")}\n---${matched[2] || "\n"}${content.slice(matched[0].length)}`;
}

export async function POST(request: Request) {
  try {
    const body = await readJson<Body>(request);
    const path = (body.path ?? "").trim();
    const status = (body.status ?? "").trim();

    if (!path.startsWith(JOB_CASE_ROOT) || !path.toLowerCase().endsWith(".md") || path.includes("..")) {
      throw new Error(`只允许修改 ${JOB_CASE_ROOT} 下的应募案件。`);
    }
    if (!isJobStatus(status)) {
      throw new Error(`未知的应募状态：${status || "(空)"}`);
    }

    const note = await readNote(path);
    if (note.frontmatter.type !== JOB_CASE_TYPE) {
      throw new Error("这条笔记不是应募案件，拒绝写入。");
    }
    if (statusRequiresChannel(status) && !String(note.frontmatter.channel ?? "").trim()) {
      throw new Error("进入応募后的状态必须先记录实际投递渠道 channel，不能用求人来源代替。");
    }
    if (note.frontmatter.status === status) {
      return Response.json({ ok: true, path, status, unchanged: true });
    }

    const { date } = tokyoParts();
    await writeNote(path, applyStatus(note.content, status, date));
    return Response.json({ ok: true, path, status, statusUpdated: date });
  } catch (error) {
    return errorResponse(error, "更新应募状态失败");
  }
}
