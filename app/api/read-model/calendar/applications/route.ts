import { calendarApplication } from "../../../../read-model-calendar";
import { readModelFailure } from "../../../../read-model-server";
export async function GET(request: Request) {
  try { return Response.json(await calendarApplication(new URL(request.url).searchParams), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return readModelFailure(error); }
}
