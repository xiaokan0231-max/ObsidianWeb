import { readAllNotes } from "@/lib/server/obsidian";
import { normalizeVaultScope, noteInVaultScope } from "@/lib/vault-scope";

export async function GET(request: Request) {
  try {
    // refresh=1 是页面 R 键的「我不信缓存」通道：跳过 mtime 增量，按旧行为全量爬取。
    const params = new URL(request.url).searchParams;
    const force = params.get("refresh") === "1";
    const scope = normalizeVaultScope(params.get("scope"));
    const notes = await readAllNotes({ force });
    const scopedNotes = notes.filter((note) => noteInVaultScope(note, scope));

    return Response.json(
      {
        connected: true,
        fetchedAt: Date.now(),
        notes: scopedNotes,
        scope,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Obsidian error";

    return Response.json(
      {
        connected: false,
        error: message,
        notes: [],
      },
      { status: 503 },
    );
  }
}
