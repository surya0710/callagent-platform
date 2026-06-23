-- CreateTable
CREATE TABLE `transcript_email_logs` (
    `id` VARCHAR(191) NOT NULL,
    `call_id` VARCHAR(191) NULL,
    `stream_sid` VARCHAR(191) NULL,
    `recipients` JSON NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `reason` TEXT NULL,
    `error` TEXT NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transcript_email_logs_call_id_idx`(`call_id`),
    INDEX `transcript_email_logs_stream_sid_idx`(`stream_sid`),
    INDEX `transcript_email_logs_status_idx`(`status`),
    INDEX `transcript_email_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `transcript_email_logs` ADD CONSTRAINT `transcript_email_logs_call_id_fkey` FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
