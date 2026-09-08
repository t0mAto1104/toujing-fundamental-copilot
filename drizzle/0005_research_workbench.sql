CREATE TABLE `data_source_health` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`source_name` text NOT NULL,
	`source_url` text NOT NULL,
	`last_attempt_at` text,
	`last_success_at` text,
	`last_failure_at` text,
	`latency_ms` integer,
	`successes` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`cache_hits` integer DEFAULT 0 NOT NULL,
	`data_as_of` text,
	`coverage_json` text DEFAULT '{}' NOT NULL,
	`last_error` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_source_health_updated` ON `data_source_health` (`updated_at`);--> statement-breakpoint
CREATE TABLE `research_budget_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`tokens` integer NOT NULL,
	`usd` real NOT NULL,
	`settled` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `research_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`batch_id` text,
	`query` text NOT NULL,
	`listing_json` text NOT NULL,
	`model` text NOT NULL,
	`framework_version` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`stage` text DEFAULT 'queued' NOT NULL,
	`message` text DEFAULT '等待用户启动' NOT NULL,
	`error` text,
	`token_limit` integer NOT NULL,
	`usd_limit` real NOT NULL,
	`committed_tokens` integer DEFAULT 0 NOT NULL,
	`committed_usd` real DEFAULT 0 NOT NULL,
	`lease_id` text,
	`lease_expires_at` text,
	`quota_consumed` integer DEFAULT 0 NOT NULL,
	`completed_stages_json` text DEFAULT '[]' NOT NULL,
	`report_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_research_tasks_user_created` ON `research_tasks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_research_tasks_lease` ON `research_tasks` (`lease_expires_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `report_token_limit` integer DEFAULT 80000 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `report_usd_limit` real DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `watchlist` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `watchlist` ADD `note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `watchlist` ADD `pending_event` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_ai_usage_task_user` ON `ai_usage_events` (`research_task_id`,`user_id`);