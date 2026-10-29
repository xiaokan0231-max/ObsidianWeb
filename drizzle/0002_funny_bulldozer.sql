CREATE TABLE `read_model_aliases` (
	`revision` text NOT NULL,
	`target` text NOT NULL,
	`path` text NOT NULL,
	`exact` integer NOT NULL,
	PRIMARY KEY(`revision`, `target`, `path`, `exact`)
);
--> statement-breakpoint
CREATE INDEX `read_alias_lookup` ON `read_model_aliases` (`revision`,`target`,`exact`);--> statement-breakpoint
CREATE TABLE `read_model_batches` (
	`revision` text NOT NULL,
	`ordinal` integer NOT NULL,
	`digest` text NOT NULL,
	PRIMARY KEY(`revision`, `ordinal`)
);
--> statement-breakpoint
CREATE TABLE `read_model_catalog` (
	`revision` text NOT NULL,
	`path` text NOT NULL,
	`ordinal` integer NOT NULL,
	`hash` text NOT NULL,
	`card_json` text NOT NULL,
	`decision_json` text NOT NULL,
	`type_lower` text NOT NULL,
	`status_lower` text NOT NULL,
	`group_key` text NOT NULL,
	`scopes_json` text NOT NULL,
	`tags_json` text NOT NULL,
	`mtime` integer NOT NULL,
	PRIMARY KEY(`revision`, `path`)
);
--> statement-breakpoint
CREATE INDEX `read_catalog_revision_mtime` ON `read_model_catalog` (`revision`,`mtime`);--> statement-breakpoint
CREATE INDEX `read_catalog_revision_group_type` ON `read_model_catalog` (`revision`,`group_key`,`type_lower`);--> statement-breakpoint
CREATE INDEX `read_catalog_revision_status` ON `read_model_catalog` (`revision`,`status_lower`);--> statement-breakpoint
CREATE TABLE `read_model_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`channel` text NOT NULL,
	`ordinal` integer NOT NULL,
	`prefix` integer NOT NULL,
	`text` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `read_chunks_hash_channel` ON `read_model_chunks` (`hash`,`channel`,`ordinal`);--> statement-breakpoint
CREATE TABLE `read_model_content_refs` (
	`revision` text NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`revision`, `hash`)
);
--> statement-breakpoint
CREATE INDEX `read_refs_hash` ON `read_model_content_refs` (`hash`);--> statement-breakpoint
CREATE TABLE `read_model_links` (
	`revision` text NOT NULL,
	`source_path` text NOT NULL,
	`target` text NOT NULL,
	PRIMARY KEY(`revision`, `source_path`, `target`)
);
--> statement-breakpoint
CREATE INDEX `read_backlink_lookup` ON `read_model_links` (`revision`,`target`);--> statement-breakpoint
CREATE TABLE `read_model_records` (
	`revision` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`revision`, `kind`, `key`)
);
--> statement-breakpoint
CREATE TABLE `read_model_revisions` (
	`revision` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`manifest_json` text NOT NULL,
	`source_updated_at` integer NOT NULL,
	`indexed_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE VIRTUAL TABLE `read_model_fts` USING fts5(text, tokenize='trigram', detail='none');
--> statement-breakpoint
CREATE TRIGGER `read_chunks_search_insert` AFTER INSERT ON `read_model_chunks` WHEN new.channel = 'match' BEGIN
  INSERT INTO read_model_fts (rowid,text) VALUES (new.rowid,new.text);
END;
--> statement-breakpoint
CREATE TRIGGER `read_chunks_search_delete` AFTER DELETE ON `read_model_chunks` WHEN old.channel = 'match' BEGIN
  DELETE FROM read_model_fts WHERE rowid=old.rowid;
END;
