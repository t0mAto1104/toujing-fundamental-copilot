CREATE TABLE `data_snapshots` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`payload_json` text NOT NULL,
	`source_name` text NOT NULL,
	`source_url` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_data_snapshots_category_expires` ON `data_snapshots` (`category`,`expires_at`);