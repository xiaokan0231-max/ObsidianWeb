import { readAllNotes } from "@/lib/server/obsidian";

export async function GET(request: Request) {
  try {
    // refresh=1 是页面 R 键的「我不信缓存」通道：跳过 mtime 增量，按旧行为全量爬取。
    const force = new URL(request.url).searchParams.get("refresh") === "1";
    const notes = await readAllNotes({ force });

    return Response.json(
      {
        connected: true,
        fetchedAt: Date.now(),
        notes,
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
