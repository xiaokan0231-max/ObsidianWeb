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

/** 每个路径都参与指纹；只取最大 mtime 会漏掉时间较旧的同步文件被改写。 */
export function vaultSnapshotFingerprint(notes: readonly Pick<Note, "path" | "stat">[]): string {
  let hash = 2166136261;
  const feed = (text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  };
  // API 的排序不是数据变化；长度边界也避免路径中的换行与下一条记录混淆。
  const entries = notes.map((note) => [note.path, note.stat.mtime] as const)
    .sort(([leftPath, leftMtime], [rightPath, rightMtime]) =>
      leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : leftMtime - rightMtime);
  for (const [path, mtime] of entries) {
    feed(`${path.length}:${path}:${mtime};`);
  }
  return `W/"${notes.length.toString(36)}-${hash.toString(36)}"`;
}

/** scope 也参与验证器，不能把另一种投影的 304 当成本页的快照。 */
export function vaultEtag(scope: string, notes: readonly Pick<Note, "path" | "stat">[]) {
  const fingerprint = vaultSnapshotFingerprint(notes);
  let hash = 2166136261;
  for (const char of `${scope}:${fingerprint}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `W/"${notes.length.toString(36)}-${hash.toString(36)}"`;
}
