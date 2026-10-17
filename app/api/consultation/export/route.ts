import { loadConsultationNotes } from "@/lib/server/consultation-library";
import { buildConsultationCatalog, findConsultationTranscript } from "@/lib/consultation-library";
import { exportConsultationCompanies, exportConsultationTranscript } from "@/lib/consultation-export";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const companies = params.get("format") === "companies";
    const session = params.get("session");
    if (!companies && !session) {
      return Response.json({ error: "ダウンロードする資料を選んでください。" }, { status: 400, headers });
    }
    const notes = await loadConsultationNotes();
    let bytes: Uint8Array;
    let filename: string;
    if (companies) {
      bytes = exportConsultationCompanies(buildConsultationCatalog(notes));
      filename = "応募企業一覧.docx";
    } else {
      const transcript = findConsultationTranscript(notes, session!);
      if (!transcript) return Response.json({ error: "この面接記録は見つかりません。" }, { status: 404, headers });
      const view = params.get("view") === "raw" ? "raw" : "readable";
      if (view === "raw" ? !transcript.hasRaw : !transcript.hasReadable) {
        return Response.json({ error: "この形式の原稿はまだ登録されていません。" }, { status: 404, headers });
      }
      bytes = exportConsultationTranscript(transcript, view);
      const kind = transcript.recordKind === "memory" ? "記憶から再構成" : view === "raw" ? "原始転写" : "可読整理稿";
      filename = `${transcript.date || "日付未確認"}_${transcript.company}_${kind}.docx`;
    }
    return new Response(new Uint8Array(bytes), { headers: {
      ...headers,
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="consultation.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    } });
  } catch {
    return Response.json({ error: "資料を作成できませんでした。少し待ってから、もう一度お試しください。" }, { status: 503, headers });
  }
}
