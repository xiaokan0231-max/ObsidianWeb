import { readModelFailure, readModelRuntime } from "../../../read-model-server";
import type { LibraryQuery } from "@/lib/read-model";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const { model, revision, syncState } = await readModelRuntime(params.get("revision"));
    const query = { query: params.get("q") ?? "", group: params.get("group") ?? "all", scope: params.get("scope") ?? "all", tags: params.getAll("tags"), sort: params.get("sort") ?? "auto", cursor: params.get("cursor"), limit: Number(params.get("limit") ?? 24) } as LibraryQuery;
    return Response.json({ ...await model.library(revision, query), syncState }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return readModelFailure(error); }
}
