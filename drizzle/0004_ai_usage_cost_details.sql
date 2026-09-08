ALTER TABLE `ai_usage_events` ADD `research_task_id` text;--> statement-breakpoint
ALTER TABLE `ai_usage_events` ADD `cached_input_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_usage_events` ADD `cache_write_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_usage_events` ADD `service_tier` text;--> statement-breakpoint
ALTER TABLE `ai_usage_events` ADD `estimated_cost_usd` real;--> statement-breakpoint
ALTER TABLE `ai_usage_events` ADD `pricing_version` text;