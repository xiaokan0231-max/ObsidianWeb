CREATE TABLE `calendar_projection_summaries` (
	`revision` text NOT NULL,
	`as_of_date` text NOT NULL,
	`month` text NOT NULL,
	`company_count` integer NOT NULL,
	`position_count` integer NOT NULL,
	`bucket_counts_json` text NOT NULL,
	`waiting_count` integer NOT NULL,
	`historical_count` integer NOT NULL,
	`historical_total` integer NOT NULL,
	PRIMARY KEY(`revision`, `as_of_date`, `month`)
);
