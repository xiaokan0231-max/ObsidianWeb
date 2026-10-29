CREATE TABLE `calendar_projection_events` (
	`revision` text NOT NULL,
	`id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`event_date` text NOT NULL,
	`projection_json` text NOT NULL,
	PRIMARY KEY(`revision`, `id`)
);
--> statement-breakpoint
CREATE INDEX `calendar_events_revision_ordinal` ON `calendar_projection_events` (`revision`,`ordinal`);--> statement-breakpoint
CREATE INDEX `calendar_events_revision_date` ON `calendar_projection_events` (`revision`,`event_date`);--> statement-breakpoint
CREATE TABLE `calendar_projection_notes` (
	`revision` text NOT NULL,
	`path` text NOT NULL,
	`ordinal` integer NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`case_id` text NOT NULL,
	`company_key` text NOT NULL,
	`applied_on` text NOT NULL,
	`projection_json` text NOT NULL,
	PRIMARY KEY(`revision`, `path`)
);
--> statement-breakpoint
CREATE INDEX `calendar_notes_revision_ordinal` ON `calendar_projection_notes` (`revision`,`ordinal`);--> statement-breakpoint
CREATE INDEX `calendar_notes_revision_type_status` ON `calendar_projection_notes` (`revision`,`type`,`status`);--> statement-breakpoint
CREATE INDEX `calendar_notes_revision_applied_company` ON `calendar_projection_notes` (`revision`,`applied_on`,`company_key`);--> statement-breakpoint
CREATE INDEX `calendar_notes_revision_case` ON `calendar_projection_notes` (`revision`,`case_id`);--> statement-breakpoint
CREATE TABLE `calendar_projection_revisions` (
	`revision` text PRIMARY KEY NOT NULL,
	`schema_version` integer NOT NULL,
	`note_count` integer NOT NULL,
	`event_count` integer NOT NULL,
	`selection_count` integer NOT NULL,
	`published_at` text NOT NULL,
	`imported_at` text NOT NULL
);
