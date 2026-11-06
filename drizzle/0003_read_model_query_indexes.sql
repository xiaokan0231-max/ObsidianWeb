CREATE INDEX `read_alias_path_target` ON `read_model_aliases` (`revision`,`path`,`target`);--> statement-breakpoint
CREATE INDEX `read_catalog_revision_ordinal` ON `read_model_catalog` (`revision`,`ordinal`);--> statement-breakpoint
CREATE INDEX `read_catalog_revision_recent` ON `read_model_catalog` (`revision`,"mtime" DESC,`ordinal`);