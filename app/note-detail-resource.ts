import type { Note } from "../lib/notes.ts";
import type { NoteResolution } from "../lib/read-model.ts";
import { readReadModelJSON, ReadModelFetchError, type ReadModelFetcher } from "./read-model-resource.ts";

export async function readNoteDetail(path: string, revision: string | undefined, signal: AbortSignal, fetcher: ReadModelFetcher = fetch) {
  const read = async (version?: string) => {
    const params = new URLSearchParams({ path, ...(version ? { revision: version } : {}) });
    const { note } = await readReadModelJSON<{ note: Note }>(`/api/note?${params}`, signal, fetcher);
    if (note?.path !== path || typeof note.content !== "string") throw new Error("笔记读取失败");
    return { note, revision: version };
  };

  try {
    return await read(revision);
  } catch (error) {
    if (!revision || !(error instanceof ReadModelFetchError) || error.status !== 409) throw error;
    // 旧版可能已回收。仅重定向到同一完整路径，并和原请求共享超时与取消。
    const params = new URLSearchParams({ target: path });
    const target = await readReadModelJSON<NoteResolution>(`/api/read-model/resolve?${params}`, signal, fetcher);
    if (target.kind !== "resolved" || target.path !== path || !target.revision || target.revision === revision) throw error;
    return read(target.revision);
  }
}
