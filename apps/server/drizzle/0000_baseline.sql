CREATE TABLE `articles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brief_id` integer NOT NULL,
	`topic_id` integer NOT NULL,
	`topic_name` text NOT NULL,
	`slot` integer NOT NULL,
	`headline` text NOT NULL,
	`summary` text NOT NULL,
	`body_md` text NOT NULL,
	`story_key` text NOT NULL,
	`entities` text NOT NULL,
	`published_at` integer,
	`date_approx` integer DEFAULT false NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`rating` text,
	`saved_at` integer,
	`ignored_at` integer,
	`rated_at` integer,
	`opened_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `articles_brief_slot_idx` ON `articles` (`brief_id`,`slot`);--> statement-breakpoint
CREATE INDEX `articles_topic_created_idx` ON `articles` (`topic_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `briefs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` integer NOT NULL,
	`brief_date` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`detail` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`candidates_found` integer,
	`clusters_found` integer,
	`error` text,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `briefs_topic_date_idx` ON `briefs` (`topic_id`,`brief_date`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`provider_id` integer,
	`model` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_subject_idx` ON `chat_messages` (`subject_type`,`subject_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `daily_themes` (
	`date` text PRIMARY KEY NOT NULL,
	`signature` text NOT NULL,
	`themes` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feed_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feed_id` integer,
	`feed_name` text,
	`guid` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`published_at` integer,
	`summary` text,
	`content_html` text,
	`content_text` text,
	`extraction` text DEFAULT 'pending' NOT NULL,
	`read_at` integer,
	`saved_at` integer,
	`opened_at` integer,
	`has_chat` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_items_feed_guid_idx` ON `feed_items` (`feed_id`,`guid`);--> statement-breakpoint
CREATE INDEX `feed_items_published_idx` ON `feed_items` (`published_at`);--> statement-breakpoint
CREATE TABLE `feed_topics` (
	`feed_id` integer NOT NULL,
	`topic_id` integer NOT NULL,
	PRIMARY KEY(`feed_id`, `topic_id`),
	FOREIGN KEY (`feed_id`) REFERENCES `feeds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`site_url` text,
	`icon_url` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_fetched_at` integer,
	`last_status` integer,
	`last_error` text,
	`etag` text,
	`last_modified` text,
	`inactive_dismissed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feeds_url_unique` ON `feeds` (`url`);--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brief_id` integer,
	`article_id` integer,
	`feed_item_id` integer,
	`role` text NOT NULL,
	`provider_id` integer,
	`model` text NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`cost_usd` real,
	`duration_ms` integer NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`brief_id`) REFERENCES `briefs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`feed_item_id`) REFERENCES `feed_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `llm_calls_created_idx` ON `llm_calls` (`created_at`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ip` text NOT NULL,
	`attempted_at` integer NOT NULL,
	`success` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_ip_idx` ON `login_attempts` (`ip`,`attempted_at`);--> statement-breakpoint
CREATE TABLE `model_prices` (
	`model` text PRIMARY KEY NOT NULL,
	`input` real,
	`output` real,
	`source` text,
	`checked_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key_enc` text,
	`headers_enc` text,
	`enabled` integer DEFAULT true NOT NULL,
	`models_cache` text,
	`capabilities` text,
	`last_tested_at` integer,
	`last_test_ok` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `seen_urls` (
	`topic_id` integer NOT NULL,
	`canonical_url` text NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`topic_id`, `canonical_url`),
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`remember` integer NOT NULL,
	`user_agent` text,
	`ip` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`article_id` integer NOT NULL,
	`position` integer NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`publisher` text NOT NULL,
	`published_at` integer,
	`origin` text NOT NULL,
	`content_text` text NOT NULL,
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sources_article_idx` ON `sources` (`article_id`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`accent` text NOT NULL,
	`icon` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`auto_feeds` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_name_unique` ON `topics` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`password_changed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_nocase_idx` ON `users` (lower("username"));--> statement-breakpoint
-- Full-text search over feed items (RSS search). Not expressible in schema.ts, so maintained here by hand.
CREATE VIRTUAL TABLE `feed_items_fts` USING fts5(title, summary, content_text, content='feed_items', content_rowid='id', tokenize='porter unicode61 remove_diacritics 2');--> statement-breakpoint
CREATE TRIGGER `feed_items_fts_ai` AFTER INSERT ON `feed_items` BEGIN
  INSERT INTO feed_items_fts(rowid, title, summary, content_text) VALUES (new.id, new.title, new.summary, new.content_text);
END;--> statement-breakpoint
CREATE TRIGGER `feed_items_fts_ad` AFTER DELETE ON `feed_items` BEGIN
  INSERT INTO feed_items_fts(feed_items_fts, rowid, title, summary, content_text) VALUES ('delete', old.id, old.title, old.summary, old.content_text);
END;--> statement-breakpoint
CREATE TRIGGER `feed_items_fts_au` AFTER UPDATE OF title, summary, content_text ON `feed_items` BEGIN
  INSERT INTO feed_items_fts(feed_items_fts, rowid, title, summary, content_text) VALUES ('delete', old.id, old.title, old.summary, old.content_text);
  INSERT INTO feed_items_fts(rowid, title, summary, content_text) VALUES (new.id, new.title, new.summary, new.content_text);
END;
