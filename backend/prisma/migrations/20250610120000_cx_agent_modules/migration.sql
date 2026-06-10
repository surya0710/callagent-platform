-- CreateTable
CREATE TABLE `knowledge_base_entries` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `tags` JSON NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `knowledge_base_entries_department_idx`(`department`),
    INDEX `knowledge_base_entries_category_idx`(`category`),
    INDEX `knowledge_base_entries_is_active_idx`(`is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tickets` (
    `id` VARCHAR(191) NOT NULL,
    `customer_id` VARCHAR(191) NOT NULL,
    `call_id` VARCHAR(191) NULL,
    `issue_category` VARCHAR(191) NOT NULL,
    `issue_summary` TEXT NULL,
    `priority` VARCHAR(191) NOT NULL DEFAULT 'medium',
    `status` ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'ESCALATED') NOT NULL DEFAULT 'OPEN',
    `source` ENUM('cx_call', 'manual', 'integration') NOT NULL DEFAULT 'cx_call',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tickets_customer_id_idx`(`customer_id`),
    INDEX `tickets_call_id_idx`(`call_id`),
    INDEX `tickets_status_idx`(`status`),
    INDEX `tickets_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_examples` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `transcript` LONGTEXT NOT NULL,
    `summary` TEXT NULL,
    `good_practices` TEXT NULL,
    `bad_practices` TEXT NULL,
    `tags` JSON NULL,
    `is_approved` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `conversation_examples_department_idx`(`department`),
    INDEX `conversation_examples_is_approved_idx`(`is_approved`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_action_events` (
    `id` VARCHAR(191) NOT NULL,
    `department` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `call_id` VARCHAR(191) NULL,
    `customer_id` VARCHAR(191) NULL,
    `ticket_id` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_action_events_department_idx`(`department`),
    INDEX `agent_action_events_action_idx`(`action`),
    INDEX `agent_action_events_customer_id_idx`(`customer_id`),
    INDEX `agent_action_events_call_id_idx`(`call_id`),
    INDEX `agent_action_events_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tickets` ADD CONSTRAINT `tickets_call_id_fkey` FOREIGN KEY (`call_id`) REFERENCES `calls`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
