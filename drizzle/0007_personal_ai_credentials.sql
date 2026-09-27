CREATE TABLE `user_ai_credentials` (
	`user_id` text PRIMARY KEY NOT NULL,
	`encrypted_key` text NOT NULL,
	`key_last_four` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ai_usage_events` ADD `billing_source` text;