import { errorResponse, readJson } from "@/lib/server/api";
import { interviewAdvisory } from "@/lib/server/interview-advisory";

export async function GET(request: Request) {
  try {
    return Response.json(await interviewAdvisory.sourceState(new URL(request.url).searchParams.get("notePath") ?? ""), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error, "读取顾问分析状态失败"); }
}

export async function POST(request: Request) {
  try {
    const body = await readJson<{ notePath?: string; force?: boolean }>(request);
    return Response.json(await interviewAdvisory.generateSource(body.notePath ?? "", body.force === true));
  } catch (error) { return errorResponse(error, "生成顾问分析失败"); }
}
