import { calendarSummary } from "../../../read-model-calendar";
import { readModelFailure } from "../../../read-model-server";

export async function GET(request: Request) {
  try {
    const result = await calendarSummary(new URL(request.url).searchParams);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return readModelFailure(error);
  }
}
