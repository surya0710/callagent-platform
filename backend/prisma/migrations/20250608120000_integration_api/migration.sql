-- CreateTable
CREATE TABLE `api_keys` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `key_prefix` VARCHAR(191) NOT NULL,
    `key_hash` VARCHAR(191) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `api_keys_key_prefix_idx`(`key_prefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `calls` ADD COLUMN `api_key_id` VARCHAR(191) NULL,
    ADD COLUMN `source` ENUM('campaign', 'integration', 'manual', 'test') NOT NULL DEFAULT 'manual',
    ADD COLUMN `external_ref` VARCHAR(191) NULL,
    ADD COLUMN `call_purpose` ENUM('driver_assigned', 'ride_reminder', 'pickup_update', 'trip_completed', 'payment_reminder', 'custom') NULL,
    ADD COLUMN `priority` VARCHAR(191) NOT NULL DEFAULT 'normal',
    ADD COLUMN `metadata` JSON NULL,
    ADD COLUMN `callback_url` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `calls_external_ref_idx` ON `calls`(`external_ref`);
CREATE INDEX `calls_source_idx` ON `calls`(`source`);
CREATE UNIQUE INDEX `calls_api_key_id_external_ref_key` ON `calls`(`api_key_id`, `external_ref`);

-- AddForeignKey
ALTER TABLE `calls` ADD CONSTRAINT `calls_api_key_id_fkey` FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
