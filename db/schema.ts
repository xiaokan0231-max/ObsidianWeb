import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// 数据库只保存已发布日历的读取投影；原始笔记仍由 vault 管理。
export const calendarProjectionRevisions = sqliteTable("calendar_projection_revisions", {
  revision: text("revision").primaryKey(),
  schemaVersion: integer("schema_version").notNull(),
  noteCount: integer("note_count").notNull(),
  eventCount: integer("event_count").notNull(),
  selectionCount: integer("selection_count").notNull(),
  publishedAt: text("published_at").notNull(),
  importedAt: text("imported_at").notNull(),
});

export const calendarProjectionNotes = sqliteTable("calendar_projection_notes", {
  revision: text("revision").notNull(),
  path: text("path").notNull(),
  ordinal: integer("ordinal").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull(),
  caseId: text("case_id").notNull(),
  companyKey: text("company_key").notNull(),
  appliedOn: text("applied_on").notNull(),
  projectionJson: text("projection_json").notNull(),
}, (table) => [
  primaryKey({ columns: [table.revision, table.path] }),
  index("calendar_notes_revision_ordinal").on(table.revision, table.ordinal),
  index("calendar_notes_revision_type_status").on(table.revision, table.type, table.status),
  index("calendar_notes_revision_applied_company").on(table.revision, table.appliedOn, table.companyKey),
  index("calendar_notes_revision_case").on(table.revision, table.caseId),
]);

export const calendarProjectionEvents = sqliteTable("calendar_projection_events", {
  revision: text("revision").notNull(),
  id: text("id").notNull(),
  ordinal: integer("ordinal").notNull(),
  eventDate: text("event_date").notNull(),
  projectionJson: text("projection_json").notNull(),
}, (table) => [
  primaryKey({ columns: [table.revision, table.id] }),
  index("calendar_events_revision_ordinal").on(table.revision, table.ordinal),
  index("calendar_events_revision_date").on(table.revision, table.eventDate),
]);

export const calendarProjectionSummaries = sqliteTable("calendar_projection_summaries", {
  revision: text("revision").notNull(),
  asOfDate: text("as_of_date").notNull(),
  month: text("month").notNull(),
  companyCount: integer("company_count").notNull(),
  positionCount: integer("position_count").notNull(),
  bucketCountsJson: text("bucket_counts_json").notNull(),
  waitingCount: integer("waiting_count").notNull(),
  historicalCount: integer("historical_count").notNull(),
  historicalTotal: integer("historical_total").notNull(),
}, (table) => [primaryKey({ columns: [table.revision, table.asOfDate, table.month] })]);
