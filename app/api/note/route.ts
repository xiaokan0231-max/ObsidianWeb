import { isOperationalPath } from "@/lib/vault-boundary.mjs";
import { isMissingNoteError, readNote } from "@/lib/server/obsidian";
import { readModelFailure, readModelNote } from "../../read-model-server";

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!path.endsWith(".md") || path.startsWith("/") || /[\\\u0000]/.test(path)
    || path.split("/").some((part) => part === "." || part === "..") || !isOperationalPath(path)) {
    return Response.json({ error: "笔记路径无效" }, { status: 400 });
  }
  try {
    const revision = new URL(request.url).searchParams.get("revision");
    if (revision) return Response.json({ note: await readModelNote(path, revision) }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ note: await readNote(path) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (new URL(request.url).searchParams.has("revision")) return readModelFailure(error);
    return Response.json({ error: isMissingNoteError(error) ? "找不到这篇笔记" : "笔记读取失败，请重试" }, {
      status: isMissingNoteError(error) ? 404 : 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
