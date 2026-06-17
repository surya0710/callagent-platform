-- CreateTable
CREATE TABLE `agent_playbooks` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `source_insight_report_id` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'draft',
    `version` INTEGER NOT NULL DEFAULT 1,
    `playbook_text` TEXT NOT NULL,
    `agent_instructions` TEXT NOT NULL,
    `common_objections_json` JSON NULL,
    `objection_responses_json` JSON NULL,
    `winning_phrases_json` JSON NULL,
    `bad_phrases_json` JSON NULL,
    `qualification_signals_json` JSON NULL,
    `follow_up_rules_json` JSON NULL,
    `safety_rules_json` JSON NULL,
    `approved_by` VARCHAR(191) NULL,
    `approved_at` DATETIME(3) NULL,
    `activated_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `agent_playbooks_status_idx`(`status`),
    INDEX `agent_playbooks_source_insight_report_id_idx`(`source_insight_report_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
