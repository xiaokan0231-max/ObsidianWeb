import type { Note } from "./notes.ts";

/** 来源既可能是完整路径，也可能是带章节的双链；同名短链不能默默打开另一份证据。 */
export function resolveNoteLink(notes: Note[], input: string, section?: string) {
  const inner = input.trim().replace(/^!?\[\[([\s\S]*)\]\]$/, "$1").split(/\\?\|/)[0];
  const marker = inner.indexOf("#");
  const target = (marker < 0 ? inner : inner.slice(0, marker)).trim().replace(/\.md$/i, "");
  const heading = section || (marker < 0 ? "" : inner.slice(marker + 1).trim());
  const normalized = (note: Note) => note.path.replace(/\.md$/i, "");
  const exact = notes.filter((note) => normalized(note) === target);
  const matches = exact.length ? exact : notes.filter((note) => normalized(note).endsWith(`/${target}`));
  return target && matches.length === 1 ? { note: matches[0], section: heading || null } : null;
}
