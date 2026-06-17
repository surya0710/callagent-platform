-- CreateTable
CREATE TABLE `training_recording_analyses` (
    `id` VARCHAR(191) NOT NULL,
    `training_recording_id` VARCHAR(191) NOT NULL,
    `summary` TEXT NULL,
    `outcome` VARCHAR(191) NULL,
    `lead_quality` VARCHAR(191) NULL,
    `customer_intent` TEXT NULL,
    `next_action` TEXT NULL,
    `customer_requirements_json` JSON NULL,
    `objections_json` JSON NULL,
    `customer_questions_json` JSON NULL,
    `important_details_json` JSON NULL,
    `callback_requested` BOOLEAN NOT NULL DEFAULT false,
    `callback_date_time` DATETIME(3) NULL,
    `executive_score` INTEGER NULL,
    `executive_strengths_json` JSON NULL,
    `executive_improvements_json` JSON NULL,
    `missed_opportunities_json` JSON NULL,
    `winning_phrases_json` JSON NULL,
    `bad_phrases_json` JSON NULL,
    `confidence` DOUBLE NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `training_recording_analyses_training_recording_id_key`(`training_recording_id`),
    INDEX `training_recording_analyses_status_idx`(`status`),
    INDEX `training_recording_analyses_outcome_idx`(`outcome`),
    INDEX `training_recording_analyses_lead_quality_idx`(`lead_quality`),
    INDEX `training_recording_analyses_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `training_insight_reports` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `total_calls` INTEGER NOT NULL DEFAULT 0,
    `common_objections_json` JSON NULL,
    `common_questions_json` JSON NULL,
    `common_requirements_json` JSON NULL,
    `winning_phrases_json` JSON NULL,
    `bad_phrases_json` JSON NULL,
    `best_openings_json` JSON NULL,
    `follow_up_patterns_json` JSON NULL,
    `qualification_signals_json` JSON NULL,
    `recommended_playbook` TEXT NULL,
    `ai_agent_instructions` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `training_insight_reports_status_idx`(`status`),
    INDEX `training_insight_reports_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `training_recording_analyses` ADD CONSTRAINT `training_recording_analyses_training_recording_id_fkey` FOREIGN KEY (`training_recording_id`) REFERENCES `training_recordings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
