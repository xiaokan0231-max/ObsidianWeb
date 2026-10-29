import type { CalendarSnapshot } from "../calendar-snapshot.ts";
import { companyIdentity, getString, getType, type Note } from "../notes.ts";

type Database = Pick<D1Database, "prepare" | "batch">;
type RevisionRow = {
  revision: string;
  schema_version: number;
  note_count: number;
  event_count: number;
  selection_count: number;
};
type NoteRow = {
  path: string;
  ordinal: number;
  type: string;
  status: string;
  case_id: string;
  company_key: string;
  applied_on: string;
  projection_json: string;
};
type EventRow = { id: string; ordinal: number; event_date: string; projection_json: string };

const invalid = () => new Error("日历数据库投影不完整或格式无效");
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validNote(value: unknown): value is Note {
  return object(value) && typeof value.path === "string" && Boolean(value.path)
    && object(value.frontmatter) && typeof value.content === "string" && Array.isArray(value.tags)
    && object(value.stat) && typeof value.stat.mtime === "number";
}

function validEvent(value: unknown): value is CalendarSnapshot["events"][number] {
  return object(value) && object(value.event) && typeof value.event.id === "string" && Boolean(value.event.id)
    && typeof value.event.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.event.date)
    && validNote(value.event.note) && object(value.upcoming) && object(value.past)
    && object(value.destinations) && object(value.origin);
}

function assertSnapshot(value: unknown): asserts value is CalendarSnapshot {
  if (!object(value) || value.schemaVersion !== 1 || !count(value.selectionCount)
    || !Array.isArray(value.applicationNotes) || !Array.isArray(value.events)
    || !value.applicationNotes.every((note) => validNote(note) && ["job-case", "todo"].includes(getType(note)))
    || !value.events.every(validEvent)
    || new Set(value.applicationNotes.map((note) => note.path)).size !== value.applicationNotes.length
    || new Set(value.events.map(({ event }) => event.id)).size !== value.events.length) throw invalid();
}

function noteFields(note: Note) {
  return {
    type: getType(note), status: getString(note.frontmatter.status), case_id: getString(note.frontmatter.case_id),
    company_key: companyIdentity(getString(note.frontmatter.company)), applied_on: getString(note.frontmatter.applied_on),
  };
}

function requireRevision(revision: string) {
  if (typeof revision !== "string" || !revision.trim()) throw new Error("日历发布版本不能为空");
}

function rows<T>(result: D1Result<unknown>): T[] {
  if (!result?.success || !Array.isArray(result.results)) throw new Error("日历数据库读取失败");
  return result.results as T[];
}

/**
 * 每份发布版本独立存储，旧 Worker 只能读到它所带 manifest 的版本。
 * 只接受已压缩为显示字段的 CalendarSnapshot，不读 vault 正文或老师信箱。
 */
export function createCalendarReadModel(db: Database) {
  const inflight = new Map<string, Promise<CalendarSnapshot>>();

  async function read(revision: string): Promise<CalendarSnapshot | null> {
    requireRevision(revision);
    const result = await db.batch([
      db.prepare("SELECT revision, schema_version, note_count, event_count, selection_count FROM calendar_projection_revisions WHERE revision = ?").bind(revision),
      db.prepare("SELECT path, ordinal, type, status, case_id, company_key, applied_on, projection_json FROM calendar_projection_notes WHERE revision = ? ORDER BY ordinal").bind(revision),
      db.prepare("SELECT id, ordinal, event_date, projection_json FROM calendar_projection_events WHERE revision = ? ORDER BY ordinal").bind(revision),
    ]);
    if (result.length !== 3) throw invalid();
    const revisions = rows<RevisionRow>(result[0]);
    const notes = rows<NoteRow>(result[1]);
    const events = rows<EventRow>(result[2]);
    if (revisions.length === 0 && notes.length === 0 && events.length === 0) return null;
    const metadata = revisions[0];
    if (revisions.length !== 1 || metadata.revision !== revision || metadata.schema_version !== 1
      || !count(metadata.note_count) || !count(metadata.event_count) || !count(metadata.selection_count)
      || notes.length !== metadata.note_count || events.length !== metadata.event_count) throw invalid();
    const applicationNotes = notes.map((row, ordinal) => {
      const note: unknown = JSON.parse(row.projection_json);
      if (row.ordinal !== ordinal || !validNote(note) || note.path !== row.path) throw invalid();
      const fields = noteFields(note);
      if (Object.entries(fields).some(([key, value]) => row[key as keyof typeof fields] !== value)) throw invalid();
      return note;
    });
    const eventEntries = events.map((row, ordinal) => {
      const entry: unknown = JSON.parse(row.projection_json);
      if (row.ordinal !== ordinal || !validEvent(entry) || entry.event.id !== row.id || entry.event.date !== row.event_date) throw invalid();
      return entry;
    });
    const snapshot: CalendarSnapshot = { schemaVersion: 1, events: eventEntries, applicationNotes, selectionCount: metadata.selection_count };
    assertSnapshot(snapshot);
    return snapshot;
  }

  function ensure(revision: string, loadSnapshot: () => Promise<CalendarSnapshot>, publishedAt = ""): Promise<CalendarSnapshot> {
    requireRevision(revision);
    const pending = inflight.get(revision);
    if (pending) return pending;
    const task = (async () => {
      const cached = await read(revision);
      if (cached) return cached;
      const snapshot = await loadSnapshot();
      assertSnapshot(snapshot);
      const notes = snapshot.applicationNotes.map((note) => ({ path: note.path, ...noteFields(note), projection: note }));
      const events = snapshot.events.map((entry) => ({ id: entry.event.id, event_date: entry.event.date, projection: entry }));
      // json_each 把整批投影作为绑定参数展开，避免每行一条请求或超过 SQL 参数数量上限。
      // D1 batch 整体提交；完成标记最后写入，读者不会把导入到一半当成有效空日历。
      const results = await db.batch([
        db.prepare(`INSERT INTO calendar_projection_notes (revision, path, ordinal, type, status, case_id, company_key, applied_on, projection_json)
          SELECT ?1, json_extract(value, '$.path'), CAST(key AS INTEGER), json_extract(value, '$.type'), json_extract(value, '$.status'),
            json_extract(value, '$.case_id'), json_extract(value, '$.company_key'), json_extract(value, '$.applied_on'), json_extract(value, '$.projection')
          FROM json_each(?2) WHERE NOT EXISTS (SELECT 1 FROM calendar_projection_revisions WHERE revision = ?1)`)
          .bind(revision, JSON.stringify(notes)),
        db.prepare(`INSERT INTO calendar_projection_events (revision, id, ordinal, event_date, projection_json)
          SELECT ?1, json_extract(value, '$.id'), CAST(key AS INTEGER), json_extract(value, '$.event_date'), json_extract(value, '$.projection')
          FROM json_each(?2) WHERE NOT EXISTS (SELECT 1 FROM calendar_projection_revisions WHERE revision = ?1)`)
          .bind(revision, JSON.stringify(events)),
        db.prepare(`INSERT OR IGNORE INTO calendar_projection_revisions
          (revision, schema_version, note_count, event_count, selection_count, published_at, imported_at) VALUES (?, 1, ?, ?, ?, ?, ?)`)
          .bind(revision, notes.length, events.length, snapshot.selectionCount, publishedAt, new Date().toISOString()),
      ]);
      if (results.length !== 3 || results.some((result) => !result?.success)) throw new Error("日历数据库导入失败");
      // 另一实例可能先提交同一版本；回读数据库中的胜出版本，不能把本实例的副本当成已写入。
      const stored = await read(revision);
      if (!stored) throw invalid();
      return stored;
    })().finally(() => { if (inflight.get(revision) === task) inflight.delete(revision); });
    inflight.set(revision, task);
    return task;
  }

  return { read, ensure };
}
