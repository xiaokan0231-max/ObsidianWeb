import { getString, type Note } from "./notes.ts";

/** 次回予定は専用フィールドだけを読む。status_updated や自由文の日付は履歴であって予定ではない。 */
export function explicitNextEventDate(note: Note) {
  return getString(note.frontmatter.next_event_at)
    .match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] ?? "";
}

export function explicitNextEventTime(note: Note) {
  return getString(note.frontmatter.next_event_at)
    .match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)?.[0] ?? "";
}
