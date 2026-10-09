import type { Note } from "./notes.ts";

/** 局部 scope 未载入的来源可以按完整相对路径补读；短名和外部路径不能猜。 */
export function explicitNoteLink(input: string, section?: string) {
  const inner = input.trim().replace(/^!?\[\[([\s\S]*)\]\]$/, "$1").split(/\\?\|/)[0];
  const marker = inner.indexOf("#");
  const target = (marker < 0 ? inner : inner.slice(0, marker)).trim();
  const heading = section || (marker < 0 ? "" : inner.slice(marker + 1).trim());
  if (!target.includes("/") || target.startsWith("/") || /[:\\\0]/.test(target)
    || target.split("/").some((part) => !part || part === "." || part === "..")
    || (/\.[^./]+$/.test(target) && !/\.md$/i.test(target))) return null;
  return { path: /\.md$/i.test(target) ? target : `${target}.md`, section: heading || null };
}

export type NoteLinkResult =
  | { kind: "resolved"; note: Note; section: string | null }
  | { kind: "missing" | "ambiguous" };

/** 局部索引缺失与全库重名需要不同提示，不能一起当作「打不开」。 */
export function resolveNoteLinkResult(notes: readonly Note[], input: string, section?: string): NoteLinkResult {
  const inner = input.trim().replace(/^!?\[\[([\s\S]*)\]\]$/, "$1").split(/\\?\|/)[0];
  const marker = inner.indexOf("#");
  const target = (marker < 0 ? inner : inner.slice(0, marker)).trim().replace(/\.md$/i, "");
  const heading = section || (marker < 0 ? "" : inner.slice(marker + 1).trim());
  const normalized = (note: Note) => note.path.replace(/\.md$/i, "");
  const exact = notes.filter((note) => normalized(note) === target);
  const matches = exact.length ? exact : notes.filter((note) => normalized(note).endsWith(`/${target}`));
  if (!target || matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "ambiguous" };
  return { kind: "resolved", note: matches[0], section: heading || null };
}

/** 来源既可能是完整路径，也可能是带章节的双链；同名短链不能默默打开另一份证据。 */
export function resolveNoteLink(notes: readonly Note[], input: string, section?: string) {
  const result = resolveNoteLinkResult(notes, input, section);
  return result.kind === "resolved" ? { note: result.note, section: result.section } : null;
}
