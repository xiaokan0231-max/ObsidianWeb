import { calendarProjection } from "../../calendar-server";
import { readModelFailure } from "../../read-model-server";
import { etagMatches, selectEncoding } from "@/lib/server/published-vault-response";

async function handle(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const projection = await calendarProjection(params.get("revision"));
    const etag = `W/"${projection.revision}"`;
    const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8",
      ETag: etag, Vary: "Accept-Encoding", "X-Obsidian-Read-Model": "d1" });
    if (params.get("refresh") !== "1" && etagMatches(request.headers.get("If-None-Match"), etag)) return new Response(null, { status: 304, headers });
    const encoding = selectEncoding(request, { etag, file: "", gzip: "gzip" });
    if (!encoding) return new Response(null, { status: 406, headers });
    if (encoding === "gzip") headers.set("Content-Encoding", "gzip");
    const options = { headers, encodeBody: "manual" as const };
    if (request.method === "HEAD") return new Response(null, options);
    const body = Response.json({ connected: true, calendar: await projection.snapshot() }).body!;
    return new Response(encoding === "gzip" ? body.pipeThrough(new CompressionStream("gzip")) : body, options);
  } catch (error) {
    const failure = readModelFailure(error);
    if (request.method === "HEAD") return new Response(null, { status: failure.status, headers: failure.headers });
    return Response.json({ ...await failure.json() as object, connected: false }, { status: failure.status, headers: failure.headers });
  }
}

export const GET = handle;
export const HEAD = handle;
