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

// 通用读取层按完成版本发布；正文检索块按内容哈希复用，卡片不承载完整笔记。
export const readModelRevisions = sqliteTable("read_model_revisions", {
  revision: text("revision").primaryKey(), state: text("state").notNull(),
  manifestJson: text("manifest_json").notNull(), sourceUpdatedAt: integer("source_updated_at").notNull(),
  indexedAt: integer("indexed_at").notNull(), createdAt: integer("created_at").notNull(),
});
export const readModelChunks = sqliteTable("read_model_chunks", {
  id: text("id").primaryKey(), hash: text("hash").notNull(), channel: text("channel").notNull(),
  ordinal: integer("ordinal").notNull(), prefix: integer("prefix").notNull(), text: text("text").notNull(),
}, (table) => [index("read_chunks_hash_channel").on(table.hash, table.channel, table.ordinal)]);
export const readModelContentRefs = sqliteTable("read_model_content_refs", {
  revision: text("revision").notNull(), hash: text("hash").notNull(),
}, (table) => [primaryKey({ columns: [table.revision, table.hash] }), index("read_refs_hash").on(table.hash)]);
export const readModelCatalog = sqliteTable("read_model_catalog", {
  revision: text("revision").notNull(), path: text("path").notNull(), ordinal: integer("ordinal").notNull(),
  hash: text("hash").notNull(), cardJson: text("card_json").notNull(), decisionJson: text("decision_json").notNull(),
  typeLower: text("type_lower").notNull(), statusLower: text("status_lower").notNull(), groupKey: text("group_key").notNull(),
  scopesJson: text("scopes_json").notNull(), tagsJson: text("tags_json").notNull(), mtime: integer("mtime").notNull(),
}, (table) => [primaryKey({ columns: [table.revision, table.path] }),
  index("read_catalog_revision_mtime").on(table.revision, table.mtime),
  index("read_catalog_revision_group_type").on(table.revision, table.groupKey, table.typeLower),
  index("read_catalog_revision_status").on(table.revision, table.statusLower)]);
export const readModelAliases = sqliteTable("read_model_aliases", {
  revision: text("revision").notNull(), target: text("target").notNull(), path: text("path").notNull(), exact: integer("exact").notNull(),
}, (table) => [primaryKey({ columns: [table.revision, table.target, table.path, table.exact] }), index("read_alias_lookup").on(table.revision, table.target, table.exact)]);
export const readModelLinks = sqliteTable("read_model_links", {
  revision: text("revision").notNull(), sourcePath: text("source_path").notNull(), target: text("target").notNull(),
}, (table) => [primaryKey({ columns: [table.revision, table.sourcePath, table.target] }), index("read_backlink_lookup").on(table.revision, table.target)]);
export const readModelRecords = sqliteTable("read_model_records", {
  revision: text("revision").notNull(), kind: text("kind").notNull(), key: text("key").notNull(), hash: text("hash").notNull(),
}, (table) => [primaryKey({ columns: [table.revision, table.kind, table.key] })]);
export const readModelBatches = sqliteTable("read_model_batches", {
  revision: text("revision").notNull(), ordinal: integer("ordinal").notNull(), digest: text("digest").notNull(),
}, (table) => [primaryKey({ columns: [table.revision, table.ordinal] })]);
