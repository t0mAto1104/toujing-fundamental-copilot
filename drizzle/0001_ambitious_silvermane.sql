CREATE TABLE `ai_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`web_search_requests` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`request_id` text,
	`error_code` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ai_usage_events_user_created` ON `ai_usage_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_usage_events_created` ON `ai_usage_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `daily_briefs` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`date_key` text NOT NULL,
	`status` text NOT NULL,
	`payload_json` text,
	`retry_after` text,
	`lease_expires_at` text,
	`failure_code` text,
	`last_error` text,
	`generated_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_daily_briefs_date_mode` ON `daily_briefs` (`date_key`,`mode`);--> statement-breakpoint
CREATE INDEX `idx_daily_briefs_status_retry` ON `daily_briefs` (`status`,`retry_after`);--> statement-breakpoint
ALTER TABLE `users` ADD `daily_research_limit` integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `daily_research_used` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `daily_research_date` text DEFAULT '' NOT NULL;