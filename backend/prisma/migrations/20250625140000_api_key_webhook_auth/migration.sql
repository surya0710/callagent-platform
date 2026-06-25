-- AlterTable
ALTER TABLE `api_keys`
    ADD COLUMN `webhook_auth_type` ENUM('none', 'bearer', 'header') NOT NULL DEFAULT 'none',
    ADD COLUMN `webhook_auth_header_name` VARCHAR(191) NULL,
    ADD COLUMN `webhook_auth_token` VARCHAR(512) NULL;
