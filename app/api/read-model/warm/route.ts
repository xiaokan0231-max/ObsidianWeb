import { readModelFailure, warmReadModel } from "../../../read-model-server";
export async function GET() {
  try { return Response.json(await warmReadModel(2), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return readModelFailure(error); }
}
