-- AlterTable
ALTER TABLE `registrations` ADD COLUMN `ticket_type_id` VARCHAR(30) NULL;

-- CreateTable
CREATE TABLE `event_series` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(180) NOT NULL,
    `type` VARCHAR(60) NOT NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `event_series_name_key`(`name`),
    INDEX `event_series_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_types` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NULL,
    `price` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `capacity` INTEGER UNSIGNED NULL,
    `seats_included` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `sales_start` DATETIME(3) NULL,
    `sales_end` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ticket_types_event_id_active_idx`(`event_id`, `active`),
    UNIQUE INDEX `ticket_types_event_id_name_key`(`event_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_form_fields` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `options` JSON NOT NULL,
    `help_text` VARCHAR(255) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `event_form_fields_event_id_sort_order_idx`(`event_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Agrega las columnas nuevas como opcionales para poder migrar los eventos existentes
ALTER TABLE `events` ADD COLUMN `series_id` VARCHAR(30) NULL,
    ADD COLUMN `edition_year` SMALLINT UNSIGNED NULL,
    ADD COLUMN `modules` JSON NULL;

-- Cada nombre de evento existente se convierte en una serie
INSERT INTO `event_series` (`id`, `name`, `type`, `created_at`, `updated_at`)
SELECT DISTINCT SUBSTRING(MD5(`name`), 1, 30), `name`,
    CASE
        WHEN LOWER(`name`) LIKE '%gala%' THEN 'Gala'
        WHEN LOWER(`name`) LIKE '%carrera%' THEN 'Carrera'
        WHEN LOWER(`name`) LIKE '%colecta%' THEN 'Colecta'
        ELSE 'Otro'
    END,
    CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `events`;

UPDATE `events`
SET `series_id` = SUBSTRING(MD5(`name`), 1, 30),
    `edition_year` = COALESCE(YEAR(`starts_at`), YEAR(CURRENT_TIMESTAMP(3))),
    `modules` = CASE `registration_mode`
        WHEN 'individual_and_corporate' THEN '["publicRegistration","corporate","tables","checkin"]'
        WHEN 'corporate' THEN '["corporate","tables","checkin"]'
        ELSE '["publicRegistration","checkin"]'
    END;

-- La cuota por persona pasa a ser un tipo de boleto
INSERT INTO `ticket_types` (`id`, `event_id`, `name`, `price`, `updated_at`)
SELECT SUBSTRING(MD5(CONCAT('ticket-', `id`)), 1, 30), `id`, 'General', `fee_amount`, CURRENT_TIMESTAMP(3)
FROM `events`
WHERE `fee_amount` IS NOT NULL;

ALTER TABLE `events` MODIFY `series_id` VARCHAR(30) NOT NULL,
    MODIFY `edition_year` SMALLINT UNSIGNED NOT NULL,
    MODIFY `modules` JSON NOT NULL,
    DROP COLUMN `fee_amount`,
    DROP COLUMN `registration_mode`;

-- CreateIndex
CREATE INDEX `events_series_id_edition_year_idx` ON `events`(`series_id`, `edition_year`);

-- CreateIndex
CREATE INDEX `registrations_ticket_type_id_idx` ON `registrations`(`ticket_type_id`);

-- AddForeignKey
ALTER TABLE `ticket_types` ADD CONSTRAINT `ticket_types_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_form_fields` ADD CONSTRAINT `event_form_fields_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `events` ADD CONSTRAINT `events_series_id_fkey` FOREIGN KEY (`series_id`) REFERENCES `event_series`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_ticket_type_id_fkey` FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
