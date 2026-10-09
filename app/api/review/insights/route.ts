import { errorResponse, readJson } from "@/lib/server/api";
import { interviewAdvisory } from "@/lib/server/interview-advisory";

export async function GET() {
  try {
    return Response.json(await interviewAdvisory.state(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, "读取横向分析状态失败"); }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{ force?: boolean; refreshSources?: boolean }>(request);
    return Response.json(await interviewAdvisory.generateInsights({ force: body.force === true, refreshSources: body.refreshSources === true }));
  } catch (error) { return errorResponse(error, "更新横向分析失败"); }
}
