-- DropIndex
DROP INDEX `email_messages_status_next_attempt_at_idx` ON `email_messages`;

-- AlterTable
ALTER TABLE `email_messages` ADD COLUMN `campaign_id` VARCHAR(30) NULL,
    ADD COLUMN `priority` TINYINT UNSIGNED NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `guests` ADD COLUMN `contact_id` VARCHAR(30) NULL;

-- CreateTable
CREATE TABLE `companies` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(180) NOT NULL,
    `website` VARCHAR(255) NULL,
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `companies_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contacts` (
    `id` VARCHAR(30) NOT NULL,
    `first_name` VARCHAR(100) NOT NULL,
    `last_name` VARCHAR(140) NOT NULL,
    `email` VARCHAR(254) NULL,
    `phone` VARCHAR(32) NULL,
    `position` VARCHAR(120) NULL,
    `company_id` VARCHAR(30) NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'manual',
    `opted_out_at` DATETIME(3) NULL,
    `opt_out_source` VARCHAR(16) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `contacts_email_key`(`email`),
    INDEX `contacts_last_name_first_name_idx`(`last_name`, `first_name`),
    INDEX `contacts_company_id_idx`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_notes` (
    `id` VARCHAR(30) NOT NULL,
    `contact_id` VARCHAR(30) NOT NULL,
    `author_id` VARCHAR(30) NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `contact_notes_contact_id_created_at_idx`(`contact_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `segments` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NULL,
    `filters` JSON NOT NULL,
    `created_by_id` VARCHAR(30) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `segments_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_templates` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `subject` VARCHAR(180) NOT NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `email_templates_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campaigns` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `subject` VARCHAR(180) NOT NULL,
    `body` TEXT NOT NULL,
    `event_id` VARCHAR(30) NULL,
    `segment_id` VARCHAR(30) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
    `created_by_id` VARCHAR(30) NULL,
    `sent_by_id` VARCHAR(30) NULL,
    `queued_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `campaigns_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `campaign_recipients` (
    `id` VARCHAR(30) NOT NULL,
    `campaign_id` VARCHAR(30) NOT NULL,
    `contact_id` VARCHAR(30) NOT NULL,

    INDEX `campaign_recipients_contact_id_idx`(`contact_id`),
    UNIQUE INDEX `campaign_recipients_campaign_id_contact_id_key`(`campaign_id`, `contact_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `donations` (
    `id` VARCHAR(30) NOT NULL,
    `contact_id` VARCHAR(30) NULL,
    `company_id` VARCHAR(30) NULL,
    `event_id` VARCHAR(30) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'MXN',
    `method` VARCHAR(16) NOT NULL,
    `reference` VARCHAR(120) NULL,
    `notes` VARCHAR(500) NULL,
    `received_at` DATETIME(3) NOT NULL,
    `recorded_by_id` VARCHAR(30) NULL,
    `voided_at` DATETIME(3) NULL,
    `voided_by_id` VARCHAR(30) NULL,
    `void_reason` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `donations_received_at_idx`(`received_at`),
    INDEX `donations_contact_id_idx`(`contact_id`),
    INDEX `donations_company_id_idx`(`company_id`),
    INDEX `donations_event_id_idx`(`event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `email_messages_status_priority_next_attempt_at_idx` ON `email_messages`(`status`, `priority`, `next_attempt_at`);

-- CreateIndex
CREATE INDEX `email_messages_campaign_id_status_idx` ON `email_messages`(`campaign_id`, `status`);

-- CreateIndex
CREATE INDEX `guests_contact_id_idx` ON `guests`(`contact_id`);

-- AddForeignKey
ALTER TABLE `email_messages` ADD CONSTRAINT `email_messages_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guests` ADD CONSTRAINT `guests_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_notes` ADD CONSTRAINT `contact_notes_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_notes` ADD CONSTRAINT `contact_notes_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `segments` ADD CONSTRAINT `segments_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_segment_id_fkey` FOREIGN KEY (`segment_id`) REFERENCES `segments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_sent_by_id_fkey` FOREIGN KEY (`sent_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaign_recipients` ADD CONSTRAINT `campaign_recipients_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `campaign_recipients` ADD CONSTRAINT `campaign_recipients_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `donations` ADD CONSTRAINT `donations_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `donations` ADD CONSTRAINT `donations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `donations` ADD CONSTRAINT `donations_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `donations` ADD CONSTRAINT `donations_recorded_by_id_fkey` FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `donations` ADD CONSTRAINT `donations_voided_by_id_fkey` FOREIGN KEY (`voided_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: cada invitado con correo queda unido a un contacto, y cada organización
-- capturada a una empresa. La misma dirección de correo es la misma persona.
INSERT INTO `companies` (`id`, `name`, `updated_at`)
SELECT CONCAT('c', LEFT(MD5(LOWER(TRIM(`organization`))), 24)), MIN(TRIM(`organization`)), CURRENT_TIMESTAMP(3)
FROM `guests`
WHERE `organization` IS NOT NULL AND TRIM(`organization`) <> ''
GROUP BY TRIM(`organization`);

INSERT INTO `contacts` (`id`, `first_name`, `last_name`, `email`, `phone`, `company_id`, `source`, `updated_at`)
SELECT
  CONCAT('k', LEFT(MD5(LOWER(g.`email`)), 24)),
  g.`first_name`,
  g.`last_name`,
  LOWER(g.`email`),
  g.`phone`,
  (SELECT c.`id` FROM `companies` c WHERE c.`name` = TRIM(g.`organization`) LIMIT 1),
  'registration',
  CURRENT_TIMESTAMP(3)
FROM `guests` g
JOIN (
  SELECT MIN(`id`) AS `id`
  FROM `guests`
  WHERE `email` IS NOT NULL AND TRIM(`email`) <> ''
  GROUP BY LOWER(`email`)
) first_guest ON first_guest.`id` = g.`id`;

UPDATE `guests` g
JOIN `contacts` k ON k.`email` = LOWER(g.`email`)
SET g.`contact_id` = k.`id`
WHERE g.`email` IS NOT NULL;
