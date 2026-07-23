import { appendNote, readNote } from "@/lib/server/obsidian";
import { parseAnnotations } from "@/lib/review";

// 批注ノートは事実層・追記のみ。ここは「新エントリを末尾に足す」以外の操作を持たない。
// 既存エントリの書き換え・削除は Web からはできない仕様（撤回も新エントリで表現する）。

const KINDS = new Set(["批注", "裁定", "聴解"]);

type AnnotateRequest = {
  notePath?: string;
  sentenceId?: string;
  kind?: string;
  text?: string;
  target?: string;
};

// REST API の追記は原子的でも、「読む→採番→追記」は原子的ではない。
// 連打や二重送信が同時に来ても a 番号と事実を重複させないため、短い直列区間にする。
let annotationQueue = Promise.resolve();

async function inAnnotationQueue<T>(operation: () => Promise<T>): Promise<T> {
  const previous = annotationQueue;
  let release = () => {};
  annotationQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function todayInTokyo() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export async function POST(request: Request) {
  let body: AnnotateRequest;
  try {
    body = (await request.json()) as AnnotateRequest;
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const notePath = body.notePath ?? "";
  const sentenceId = body.sentenceId ?? "";
  const kind = body.kind ?? "";
  const target = body.target ?? "";
  const text = (body.text ?? "").replace(/\s*\n\s*/g, "；").trim();

  if (!notePath.startsWith("20_求職/") || !notePath.endsWith("_批注.md") || notePath.includes("..")) {
    return Response.json({ error: "notePath 不是批注笔记" }, { status: 400 });
  }
  if (!/^s\d+[a-z]?$/.test(sentenceId)) {
    return Response.json({ error: "sentenceId 格式不对" }, { status: 400 });
  }
  if (!KINDS.has(kind)) {
    return Response.json({ error: "kind 必须是 批注/裁定/聴解" }, { status: 400 });
  }
  if (target && !/^(?:speaker|error:\d+)$/.test(target)) {
    return Response.json({ error: "target 格式不对" }, { status: 400 });
  }
  if (!text || text.length > 2000) {
    return Response.json({ error: "text 为空或超长" }, { status: 400 });
  }

  try {
    const result = await inAnnotationQueue(async () => {
      const note = await readNote(notePath);
      const duplicate = parseAnnotations(note.content).find(
        (annotation) =>
          annotation.sentenceId === sentenceId &&
          annotation.kind === kind &&
          annotation.mine === text &&
          (!target || !annotation.target || annotation.target === target),
      );
      if (duplicate) return { id: duplicate.id, deduplicated: true };

      let maxId = 0;
      for (const match of note.content.matchAll(/\*\*a(\d+)｜/g)) {
        maxId = Math.max(maxId, Number(match[1]));
      }
      const id = `a${String(maxId + 1).padStart(3, "0")}`;
      const targetLine = target ? `    - 対象:: ${target}\n` : "";
      const entry = `\n- **${id}｜${sentenceId}｜${kind}｜open｜${todayInTokyo()}**\n${targetLine}    - 我:: ${text}\n`;
      await appendNote(notePath, entry);
      return { id, deduplicated: false };
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Obsidian 写入失败";
    const status = message.includes("returned 404") ? 404 : 502;
    return Response.json({ error: message }, { status });
  }
}
