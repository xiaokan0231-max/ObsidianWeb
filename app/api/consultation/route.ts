import { loadConsultationNotes } from "@/lib/server/consultation-library";
import { buildConsultationCatalog, findConsultationTranscript } from "@/lib/consultation-library";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    // 使用与复盘相同的来源集合，线上从发布快照读取，老师无需连接本人的电脑。
    const notes = await loadConsultationNotes(params.get("refresh") === "1");
    const session = params.get("session");
    if (session !== null) {
      const transcript = findConsultationTranscript(notes, session);
      return transcript
        ? Response.json(transcript, { headers })
        : Response.json({ error: "この面接記録は見つかりません。一覧から選び直してください。" }, { status: 404, headers });
    }
    return Response.json(buildConsultationCatalog(notes), { headers });
  } catch {
    // 连接失败不能伪装成空列表；异常也可能包含内部路径，统一返回可重试的日文提示。
    return Response.json({ error: "資料を読み込めませんでした。少し待ってから、もう一度お試しください。" }, { status: 503, headers });
  }
}

export function POST() {
  return Response.json({ error: "このページは閲覧専用です。" }, { status: 405, headers: { ...headers, Allow: "GET, HEAD" } });
}
