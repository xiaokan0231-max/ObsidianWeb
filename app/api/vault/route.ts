import { readAllNotes } from "@/lib/server/obsidian";
import { vaultEtag } from "@/lib/vault-merge";
import { normalizeVaultScope, noteInVaultScope } from "@/lib/vault-scope";

export async function GET(request: Request) {
  try {
    // refresh=1 是页面 R 键的「我不信缓存」通道：跳过 mtime 增量，按旧行为全量爬取。
    const params = new URL(request.url).searchParams;
    const force = params.get("refresh") === "1";
    const scope = normalizeVaultScope(params.get("scope"));
    const notes = await readAllNotes({ force });
    const scopedNotes = notes.filter((note) => noteInVaultScope(note, scope));
    // 焦点回来时的照合：路径集合与最新 mtime 没变就 304，省掉每次十几 MB 的 JSON。
    const etag = vaultEtag(scope, scopedNotes);
    if (!force && request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "no-store" } });
    }

    return Response.json(
      {
        connected: true,
        fetchedAt: Date.now(),
        notes: scopedNotes,
        // 该 scope 现存的全部路径：客户端据此删掉在 Obsidian 里删除／改名后残留的笔记。
        paths: scopedNotes.map((note) => note.path),
        scope,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          ETag: etag,
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
