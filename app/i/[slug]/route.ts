import { INTERVIEW_RECORDS, isInterviewShareSlug, type InterviewShare } from "@/lib/interview-read-model";
import { appViewHref } from "../../app-route";
import { readModelFailure, readModelRuntime, ReadModelError } from "../../read-model-server";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const notFound = () => Response.json({ error: "找不到这条面试链接" }, { status: 404, headers });
  if (!isInterviewShareSlug(slug)) return notFound();
  try {
    const { model, revision, syncState } = await readModelRuntime();
    // 新版可能新增或撤回短链；旧版索引不用于决定它是否还有效。
    if (syncState !== "ready") throw new ReadModelError("资料索引正在同步，请稍候", 503, syncState === "building");
    const target = await model.readRecord<InterviewShare>(revision, INTERVIEW_RECORDS.share, slug);
    if (typeof target?.prepPath !== "string" || !target.prepPath.endsWith(".md")) return notFound();
    const query = new URLSearchParams({ prep: target.prepPath });
    if (new URL(request.url).searchParams.get("kitSection") === "anticipated") {
      query.set("prepTab", "kit");
      query.set("kitSection", "anticipated");
    }
    const location = appViewHref("session", query);
    return new Response(null, { status: 307, headers: { ...headers, Location: location } });
  } catch (error) {
    return readModelFailure(error);
  }
}
