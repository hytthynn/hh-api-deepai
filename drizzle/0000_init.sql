CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_enc` text,
	`cookies_enc` text,
	`machine` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`balance` real DEFAULT 0 NOT NULL,
	`granted` real DEFAULT 0 NOT NULL,
	`refresh_at` text,
	`lane_version` integer,
	`last_used_at` integer,
	`last_checked_at` integer,
	`cooldown_until` integer DEFAULT 0 NOT NULL,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`bm_order_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`notes` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_unique` ON `accounts` (`email`);--> statement-breakpoint
CREATE INDEX `idx_accounts_pick` ON `accounts` (`status`,`cooldown_until`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`last4` text NOT NULL,
	`key_hash` text NOT NULL,
	`rpm_limit` integer DEFAULT 60 NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `balance_samples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`ts` integer NOT NULL,
	`balance` real NOT NULL,
	`granted` real NOT NULL,
	`refresh_at` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_balance_account_ts` ON `balance_samples` (`account_id`,`ts`);--> statement-breakpoint
CREATE TABLE `bm_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bm_order_id` integer,
	`product_id` integer NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price` real,
	`total_usd` real,
	`status` text NOT NULL,
	`items` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bm_orders_bm_order_id_unique` ON `bm_orders` (`bm_order_id`);--> statement-breakpoint
CREATE TABLE `job_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`email` text,
	`stage` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`account_id` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_job_items_job` ON `job_items` (`job_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`params` text NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`ok` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`spent_usd` real DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer
);
--> statement-breakpoint
CREATE TABLE `locks` (
	`name` text PRIMARY KEY NOT NULL,
	`pid` integer NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`level` text NOT NULL,
	`scope` text NOT NULL,
	`message` text NOT NULL,
	`account_id` integer,
	`request_id` text,
	`meta` text
);
--> statement-breakpoint
CREATE INDEX `idx_logs_ts` ON `logs` (`ts`);--> statement-breakpoint
CREATE INDEX `idx_logs_scope_level` ON `logs` (`scope`,`level`,`ts`);--> statement-breakpoint
CREATE TABLE `models` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`free` integer DEFAULT 0 NOT NULL,
	`premier` integer DEFAULT 0 NOT NULL,
	`context_window` integer,
	`max_tokens` integer,
	`modalities` text DEFAULT 'text' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`request_id` text NOT NULL,
	`api_key_id` integer,
	`endpoint` text NOT NULL,
	`model` text,
	`stream` integer DEFAULT 0 NOT NULL,
	`account_id` integer,
	`attempts` integer DEFAULT 1 NOT NULL,
	`http_status` integer,
	`latency_ms` integer,
	`first_byte_ms` integer,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`theos_before` real,
	`theos_after` real,
	`error_code` text,
	`client` text,
	`detail` text,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_requests_ts` ON `requests` (`ts`);--> statement-breakpoint
CREATE INDEX `idx_requests_model_ts` ON `requests` (`model`,`ts`);--> statement-breakpoint
CREATE TABLE `responses` (
	`id` text PRIMARY KEY NOT NULL,
	`api_key_id` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`request` text NOT NULL,
	`response` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_responses_expires` ON `responses` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`encrypted` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
