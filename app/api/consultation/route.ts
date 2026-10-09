import { readNote, readNoteOrNull, writeNote } from "@/lib/server/obsidian";
import { createConsultationStore } from "@/lib/server/consultation-store";
import { readJson } from "@/lib/server/api";
import type { ConsultationDraft } from "@/lib/consultation";

const store = createConsultationStore({ readNote, readNoteOrNull, writeNote });
const headers = { "Cache-Control": "no-store" };
function unavailable(request: Request) {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  // 这版只供本机面谈，不能因以后正常部署其他页面而顺带开放个人材料。
  return process.env.NODE_ENV === "production" || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    || ["cross-site", "same-site"].includes(request.headers.get("sec-fetch-site") ?? "");
}
function failure(error: unknown) {
  const status = (error as { status?: number })?.status;
  // Obsidian 错误可能含真实路径和正文，老师视图只接收经过筛选的错误。
  return Response.json({ error: status ? (error as Error).message : "相談資料を読み込めません。Obsidian の接続と本機の相談資料を確認してください。" }, { status: status ?? 503, headers });
}
export async function GET(request: Request) {
  if (unavailable(request)) return new Response(null, { status: 404, headers });
  try { return Response.json(await store.get(new URL(request.url).searchParams.get("names") === "1"), { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (unavailable(request)) return new Response(null, { status: 404, headers });
  try {
    const input = await readJson<{ draft: ConsultationDraft; revision: string; materialRevision: string }>(request);
    if (!input || typeof input.revision !== "string" || typeof input.materialRevision !== "string" || JSON.stringify(input).length > 130000) return Response.json({ error: "保存内容を確認してください。" }, { status: 400, headers });
    return Response.json(await store.save(input), { headers });
  } catch (error) { return failure(error); }
}
