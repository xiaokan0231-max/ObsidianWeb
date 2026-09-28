import { noteInVaultScope, type VaultScope } from "./vault-scope.ts";
import type { Note } from "./notes.ts";

/**
 * 按 scope 拉回来的笔记怎么并进手里的全量。
 *
 * 以前只做「新来的覆盖同路径」，从不删除：在 Obsidian 里删掉或改名的笔记会一直留在页面上，
 * 直到下一次 scope=all。现在响应附带该 scope 现存的全部路径，合并时把
 * 「属于这个 scope、却不在现存路径里」的笔记去掉——只动本 scope 的笔记，别的 scope 的照旧。
 */
export function mergeScopedNotes(current: Note[], incoming: Note[], scope: VaultScope, paths?: readonly string[]): Note[] {
  if (scope === "all" || current.length === 0) return incoming;
  const merged = new Map(current.map((note) => [note.path, note]));
  if (paths) {
    const alive = new Set(paths);
    for (const [path, note] of merged) {
      if (noteInVaultScope(note, scope) && !alive.has(path)) merged.delete(path);
    }
  }
  incoming.forEach((note) => merged.set(note.path, note));
  return [...merged.values()].sort((left, right) => right.stat.mtime - left.stat.mtime);
}

/** 弱 ETag 的素材：scope 内的路径与最新 mtime。删除、改名、修改都会改变它。 */
export function vaultEtag(scope: string, notes: readonly Pick<Note, "path" | "stat">[]) {
  let hash = 2166136261;
  const feed = (text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  };
  feed(scope);
  let latest = 0;
  for (const note of notes) {
    feed(note.path);
    feed("\n");
    if (note.stat.mtime > latest) latest = note.stat.mtime;
  }
  feed(String(latest));
  return `W/"${notes.length.toString(36)}-${hash.toString(36)}"`;
}
