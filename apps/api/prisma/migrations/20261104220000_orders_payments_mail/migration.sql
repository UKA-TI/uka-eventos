-- DropForeignKey
ALTER TABLE `group_purchases` DROP FOREIGN KEY `group_purchases_event_id_fkey`;

-- DropForeignKey
ALTER TABLE `group_purchases` DROP FOREIGN KEY `group_purchases_table_id_fkey`;

-- DropForeignKey
ALTER TABLE `registrations` DROP FOREIGN KEY `registrations_group_purchase_id_fkey`;

-- DropForeignKey
ALTER TABLE `registrations` DROP FOREIGN KEY `registrations_ticket_type_id_fkey`;

-- DropIndex
DROP INDEX `registrations_group_purchase_id_seat_number_key` ON `registrations`;

-- DropIndex
DROP INDEX `registrations_ticket_type_id_idx` ON `registrations`;

-- AlterTable
ALTER TABLE `events` ADD COLUMN `payment_instructions` TEXT NULL;

-- AlterTable
ALTER TABLE `registrations` DROP COLUMN `group_purchase_id`,
    DROP COLUMN `ticket_type_id`,
    ADD COLUMN `order_id` VARCHAR(30) NOT NULL;

-- DropTable
DROP TABLE `group_purchases`;

-- CreateTable
CREATE TABLE `orders` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `ticket_type_id` VARCHAR(30) NOT NULL,
    `buyer_guest_id` VARCHAR(30) NOT NULL,
    `created_by_id` VARCHAR(30) NULL,
    `reference` VARCHAR(16) NOT NULL,
    `seats` INTEGER UNSIGNED NOT NULL,
    `amount_due` DECIMAL(10, 2) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'pending_payment',
    `source` VARCHAR(16) NOT NULL,
    `answers` JSON NOT NULL,
    `group_token_hash` CHAR(64) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `orders_group_token_hash_key`(`group_token_hash`),
    INDEX `orders_event_id_status_idx`(`event_id`, `status`),
    INDEX `orders_ticket_type_id_status_idx`(`ticket_type_id`, `status`),
    INDEX `orders_buyer_guest_id_idx`(`buyer_guest_id`),
    UNIQUE INDEX `orders_event_id_reference_key`(`event_id`, `reference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(30) NOT NULL,
    `order_id` VARCHAR(30) NOT NULL,
    `amount` DECIMAL(10, 2) NOT NULL,
    `method` VARCHAR(16) NOT NULL,
    `reference` VARCHAR(120) NULL,
    `notes` VARCHAR(500) NULL,
    `paid_at` DATETIME(3) NOT NULL,
    `recorded_by_id` VARCHAR(30) NULL,
    `voided_at` DATETIME(3) NULL,
    `voided_by_id` VARCHAR(30) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payments_order_id_idx`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_messages` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NULL,
    `kind` VARCHAR(24) NOT NULL,
    `ref_id` VARCHAR(30) NOT NULL,
    `to_email` VARCHAR(254) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `attempts` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_error` VARCHAR(500) NULL,
    `claimed_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `email_messages_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    INDEX `email_messages_sent_at_idx`(`sent_at`),
    INDEX `email_messages_event_id_status_idx`(`event_id`, `status`),
    INDEX `email_messages_kind_ref_id_idx`(`kind`, `ref_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `registrations_order_id_seat_number_key` ON `registrations`(`order_id`, `seat_number`);

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_ticket_type_id_fkey` FOREIGN KEY (`ticket_type_id`) REFERENCES `ticket_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_buyer_guest_id_fkey` FOREIGN KEY (`buyer_guest_id`) REFERENCES `guests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_recorded_by_id_fkey` FOREIGN KEY (`recorded_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_voided_by_id_fkey` FOREIGN KEY (`voided_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_messages` ADD CONSTRAINT `email_messages_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

