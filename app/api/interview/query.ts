import { readModelFailure, readModelRuntime } from "@/app/read-model-server";
import { interviewQuery } from "@/lib/server/interview-read-model";

export async function interviewGET(request: Request) {
  try {
    const url = new URL(request.url);
    const { revision, model, syncState } = await readModelRuntime(url.searchParams.get("revision"));
    const value = await interviewQuery(model, revision, url);
    return value ? Response.json({ ...value, ...(syncState ? { syncState } : {}) }, { headers: { "Cache-Control": "no-store", "X-Data-Revision": revision } })
      : Response.json({ error: "找不到这场资料，请核对原始路径" }, { status: 404 });
  } catch (error) {
    return readModelFailure(error);
  }
}
