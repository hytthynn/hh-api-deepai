DELETE FROM `api_keys` WHERE `revoked_at` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `key_enc` text;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `token_limit` integer;--> statement-breakpoint
ALTER TABLE `api_keys` DROP COLUMN `rpm_limit`;--> statement-breakpoint
ALTER TABLE `api_keys` DROP COLUMN `revoked_at`;--> statement-breakpoint
CREATE INDEX `idx_requests_key` ON `requests` (`api_key_id`);