import { readModelFailure, readModelRuntime } from "../../../read-model-server";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const { model, revision, syncState } = await readModelRuntime(params.get("revision"));
    return Response.json({ ...await model.search(revision, params.get("q") ?? "", Number(params.get("limit") ?? 8), params.getAll("recent")), syncState }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return readModelFailure(error); }
}
