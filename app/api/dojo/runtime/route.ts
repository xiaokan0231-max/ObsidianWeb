import { getCodexRuntime } from "@/lib/server/codex-bridge";

export async function GET() {
  const runtime = await getCodexRuntime();
  return Response.json(runtime, {
    headers: { "Cache-Control": "no-store" },
  });
}
