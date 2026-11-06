-- AlterTable
ALTER TABLE `consents` ADD COLUMN `guest_id` VARCHAR(30) NULL;
UPDATE `consents` c JOIN `registrations` r ON r.id = c.registration_id SET c.guest_id = r.guest_id;
ALTER TABLE `consents` MODIFY `guest_id` VARCHAR(30) NOT NULL;

-- AlterTable
ALTER TABLE `events` ADD COLUMN `closed_at` DATETIME(3) NULL,
    ADD COLUMN `closed_by_id` VARCHAR(30) NULL,
    ADD COLUMN `closing_summary` JSON NULL,
    ADD COLUMN `fundraising_goal` DECIMAL(12, 2) NULL,
    ADD COLUMN `payment_reminders` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `payment_term_days` SMALLINT UNSIGNED NOT NULL DEFAULT 7;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `cancellation_reason` VARCHAR(500) NULL,
    ADD COLUMN `due_at` DATETIME(3) NULL,
    ADD COLUMN `fiscal_data` JSON NULL,
    ADD COLUMN `invoice_folio` VARCHAR(60) NULL,
    ADD COLUMN `invoice_status` VARCHAR(16) NOT NULL DEFAULT 'none',
    ADD COLUMN `invoiced_at` DATETIME(3) NULL,
    ADD COLUMN `last_reminder_at` DATETIME(3) NULL,
    ADD COLUMN `reminder_stage` TINYINT UNSIGNED NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `external_id` VARCHAR(120) NULL,
    ADD COLUMN `source` VARCHAR(16) NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE `refunds` (
    `id` VARCHAR(30) NOT NULL,
    `order_id` VARCHAR(30) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `method` VARCHAR(16) NOT NULL,
    `reference` VARCHAR(120) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `refunded_at` DATETIME(3) NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'manual',
    `external_id` VARCHAR(120) NULL,
    `recorded_by_id` VARCHAR(30) NULL,
    `voided_at` DATETIME(3) NULL,
    `voided_by_id` VARCHAR(30) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refunds_external_id_key`(`external_id`),
    INDEX `refunds_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_items` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `category` VARCHAR(20) NOT NULL,
    `concept` VARCHAR(160) NOT NULL,
    `budgeted` DECIMAL(12, 2) NOT NULL,
    `actual` DECIMAL(12, 2) NULL,
    `notes` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `budget_items_event_id_idx`(`event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cancellation_policies` (
    `event_type` VARCHAR(60) NOT NULL,
    `text` VARCHAR(2000) NOT NULL,
    `tiers` JSON NOT NULL,
    `updated_by_id` VARCHAR(30) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`event_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `consents_guest_id_idx` ON `consents`(`guest_id`);

-- CreateIndex
CREATE INDEX `orders_status_due_at_idx` ON `orders`(`status`, `due_at`);

-- CreateIndex
CREATE INDEX `orders_invoice_status_idx` ON `orders`(`invoice_status`);

-- CreateIndex
CREATE UNIQUE INDEX `payments_external_id_key` ON `payments`(`external_id`);

-- AddForeignKey
ALTER TABLE `events` ADD CONSTRAINT `events_closed_by_id_fkey` FOREIGN KEY (`closed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_recorded_by_id_fkey` FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_voided_by_id_fkey` FOREIGN KEY (`voided_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `budget_items` ADD CONSTRAINT `budget_items_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cancellation_policies` ADD CONSTRAINT `cancellation_policies_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consents` ADD CONSTRAINT `consents_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

