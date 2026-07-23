import { readAllNotes } from "@/lib/server/obsidian";

export async function GET() {
  try {
    const notes = await readAllNotes();

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
