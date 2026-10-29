import { readModelFailure, readModelRuntime } from "../../../read-model-server";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const { model, revision } = await readModelRuntime(params.get("revision"));
    return Response.json(await model.resolve(revision, params.get("target") ?? "", params.get("section") ?? undefined), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return readModelFailure(error); }
}
