-- CreateTable
CREATE TABLE `training_recordings` (
    `id` VARCHAR(191) NOT NULL,
    `call_id` VARCHAR(191) NULL,
    `original_file_name` VARCHAR(191) NOT NULL,
    `file_name` VARCHAR(191) NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `storage_path` VARCHAR(191) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `language` VARCHAR(191) NULL,
    `status` ENUM('uploaded', 'transcribing', 'transcribed', 'failed', 'approved') NOT NULL DEFAULT 'uploaded',
    `transcript` LONGTEXT NULL,
    `redacted_transcript` LONGTEXT NULL,
    `label_outcome` VARCHAR(191) NULL,
    `expected_response` LONGTEXT NULL,
    `training_approved` BOOLEAN NOT NULL DEFAULT false,
    `error_message` TEXT NULL,
    `uploaded_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `training_recordings_call_id_idx`(`call_id`),
    INDEX `training_recordings_status_idx`(`status`),
    INDEX `training_recordings_uploaded_by_id_idx`(`uploaded_by_id`),
    INDEX `training_recordings_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_datasets` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `status` ENUM('draft', 'ready', 'uploaded', 'failed') NOT NULL DEFAULT 'draft',
    `jsonl_path` VARCHAR(191) NULL,
    `openai_file_id` VARCHAR(191) NULL,
    `example_count` INTEGER NOT NULL DEFAULT 0,
    `base_model` VARCHAR(191) NULL,
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `training_datasets_status_idx`(`status`),
    INDEX `training_datasets_created_by_id_idx`(`created_by_id`),
    INDEX `training_datasets_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_examples` (
    `id` VARCHAR(191) NOT NULL,
    `dataset_id` VARCHAR(191) NOT NULL,
    `recording_id` VARCHAR(191) NULL,
    `system_prompt` TEXT NULL,
    `user_prompt` LONGTEXT NOT NULL,
    `assistant_response` LONGTEXT NOT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `training_examples_dataset_id_idx`(`dataset_id`),
    INDEX `training_examples_recording_id_idx`(`recording_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `dataset_id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'openai',
    `base_model` VARCHAR(191) NOT NULL,
    `openai_job_id` VARCHAR(191) NULL,
    `openai_file_id` VARCHAR(191) NULL,
    `fine_tuned_model` VARCHAR(191) NULL,
    `status` ENUM('draft', 'uploading', 'queued', 'running', 'succeeded', 'failed', 'cancelled') NOT NULL DEFAULT 'draft',
    `error_message` TEXT NULL,
    `created_by_id` VARCHAR(191) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `training_jobs_dataset_id_idx`(`dataset_id`),
    INDEX `training_jobs_status_idx`(`status`),
    INDEX `training_jobs_created_by_id_idx`(`created_by_id`),
    INDEX `training_jobs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `training_recordings` ADD CONSTRAINT `training_recordings_call_id_fkey` FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `training_recordings` ADD CONSTRAINT `training_recordings_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `training_datasets` ADD CONSTRAINT `training_datasets_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `training_examples` ADD CONSTRAINT `training_examples_dataset_id_fkey` FOREIGN KEY (`dataset_id`) REFERENCES `training_datasets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `training_examples` ADD CONSTRAINT `training_examples_recording_id_fkey` FOREIGN KEY (`recording_id`) REFERENCES `training_recordings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `training_jobs` ADD CONSTRAINT `training_jobs_dataset_id_fkey` FOREIGN KEY (`dataset_id`) REFERENCES `training_datasets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `training_jobs` ADD CONSTRAINT `training_jobs_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
