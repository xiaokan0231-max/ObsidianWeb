import { tokyoParts } from "@/lib/dojo/utils";
import {
  composeJobStatus,
  isJobStatus,
  JOB_CASE_ROOT,
  JOB_CASE_TYPE,
  jobStatusNoteError,
  statusRequiresChannel,
} from "@/lib/jobs";
import { errorResponse, readJson } from "@/lib/server/api";
import { readNote, writeNote } from "@/lib/server/obsidian";

type Body = {
  path?: string;
  status?: string;
  /** 括弧に入る注記。空なら括弧ごと落ちる＝前の理由が新しい状態に居残らない。 */
  statusNote?: string;
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
    const statusNote = (body.statusNote ?? "").trim();

    if (!path.startsWith(JOB_CASE_ROOT) || !path.toLowerCase().endsWith(".md") || path.includes("..")) {
      throw new Error(`只允许修改 ${JOB_CASE_ROOT} 下的应募案件。`);
    }
    if (!isJobStatus(status)) {
      throw new Error(`未知的应募状态：${status || "(空)"}`);
    }
    const noteError = jobStatusNoteError(statusNote);
    if (noteError) throw new Error(noteError);

    const value = composeJobStatus(status, statusNote);

    const note = await readNote(path);
    if (note.frontmatter.type !== JOB_CASE_TYPE) {
      throw new Error("这条笔记不是应募案件，拒绝写入。");
    }
    // channel を要求するのは台帳が経路別の面接到達率をこの値で集計しているから
    // （scripts/vault-stats.mjs）。空の channel を通すと集計に無名のバケツが生えて、
    // generated 区块の数字が静かに壊れる。だから緩めず、代わりに逃げ道を文言で示す。
    if (statusRequiresChannel(status) && !String(note.frontmatter.channel ?? "").trim()) {
      throw new Error(
        `「${status}」是応募之后的状态，必须有 channel 记录实际投递渠道（source 是求人来源，不能代替）。` +
          `这条案件还没有 channel＝系统里没有应募记录。真投过就先在笔记里补 channel；` +
          `没投过（例如募集終了・取扱終了）就选「保留」，把理由写进括号。`,
      );
    }
    if (note.frontmatter.status === value) {
      return Response.json({ ok: true, path, status: value, unchanged: true });
    }

    const { date } = tokyoParts();
    await writeNote(path, applyStatus(note.content, value, date));
    return Response.json({ ok: true, path, status: value, statusUpdated: date });
  } catch (error) {
    return errorResponse(error, "更新应募状态失败");
  }
}
