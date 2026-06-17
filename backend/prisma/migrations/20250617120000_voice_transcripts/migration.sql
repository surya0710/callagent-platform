-- AlterTable
ALTER TABLE `call_transcripts`
    ADD COLUMN `lifecycle_status` ENUM('none', 'draft', 'processing', 'final', 'failed') NOT NULL DEFAULT 'none',
    ADD COLUMN `transcript_mode` VARCHAR(191) NULL,
    ADD COLUMN `transcript_error` TEXT NULL,
    ADD COLUMN `transcript_language_detected` VARCHAR(191) NULL,
    ADD COLUMN `realtime_transcript_count` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `call_transcript_segments` (
    `id` VARCHAR(191) NOT NULL,
    `call_transcript_id` VARCHAR(191) NOT NULL,
    `speaker` ENUM('customer', 'assistant', 'unknown') NOT NULL,
    `source` ENUM('realtime', 'postcall') NOT NULL,
    `status` ENUM('draft', 'final') NOT NULL,
    `language` VARCHAR(191) NULL,
    `text` LONGTEXT NOT NULL,
    `started_at_ms` INTEGER NULL,
    `ended_at_ms` INTEGER NULL,
    `confidence` DOUBLE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `call_transcript_segments_call_transcript_id_idx`(`call_transcript_id`),
    INDEX `call_transcript_segments_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `call_transcript_segments` ADD CONSTRAINT `call_transcript_segments_call_transcript_id_fkey` FOREIGN KEY (`call_transcript_id`) REFERENCES `call_transcripts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
