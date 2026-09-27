CREATE TABLE `user_notebooks` (
	`user_id` text PRIMARY KEY NOT NULL,
	`document_json` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL
);
