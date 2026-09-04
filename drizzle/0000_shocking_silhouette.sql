CREATE TABLE `reports` (
	`id` text NOT NULL,
	`user_id` text NOT NULL,
	`company_name` text NOT NULL,
	`company_code` text NOT NULL,
	`exchange` text NOT NULL,
	`listing_id` text,
	`industry` text NOT NULL,
	`stance` text NOT NULL,
	`conclusion` text NOT NULL,
	`query` text NOT NULL,
	`report_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_reports_user_updated_at` ON `reports` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`research_count` integer DEFAULT 0 NOT NULL,
	`research_enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_users_last_seen_at` ON `users` (`last_seen_at`);