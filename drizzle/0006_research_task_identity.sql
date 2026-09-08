ALTER TABLE `research_tasks` ADD `pipeline_version` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_research_budget_task_settled` ON `research_budget_calls` (`task_id`,`settled`);