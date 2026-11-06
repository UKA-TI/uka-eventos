-- AlterTable
ALTER TABLE `event_tables` ADD COLUMN `x` DOUBLE NOT NULL DEFAULT 10,
    ADD COLUMN `y` DOUBLE NOT NULL DEFAULT 10,
    ADD COLUMN `zone` VARCHAR(60) NULL;

-- AlterTable
ALTER TABLE `events` ADD COLUMN `seating_published_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `registrations` ADD COLUMN `published_table_id` VARCHAR(30) NULL;

-- CreateTable
CREATE TABLE `table_allocations` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `order_id` VARCHAR(30) NOT NULL,
    `table_id` VARCHAR(30) NOT NULL,
    `seats` INTEGER UNSIGNED NOT NULL,
    `locked` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `table_allocations_event_id_locked_idx`(`event_id`, `locked`),
    INDEX `table_allocations_table_id_idx`(`table_id`),
    UNIQUE INDEX `table_allocations_order_id_table_id_key`(`order_id`, `table_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `seating_preferences` (
    `event_id` VARCHAR(30) NOT NULL,
    `group_key` VARCHAR(60) NOT NULL,
    `zone` VARCHAR(60) NOT NULL,

    PRIMARY KEY (`event_id`, `group_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_plans` (
    `event_id` VARCHAR(30) NOT NULL,
    `data` MEDIUMBLOB NOT NULL,
    `mime_type` VARCHAR(20) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`event_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `table_allocations` ADD CONSTRAINT `table_allocations_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `table_allocations` ADD CONSTRAINT `table_allocations_table_id_fkey` FOREIGN KEY (`table_id`) REFERENCES `event_tables`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `seating_preferences` ADD CONSTRAINT `seating_preferences_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_plans` ADD CONSTRAINT `event_plans_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_published_table_id_fkey` FOREIGN KEY (`published_table_id`) REFERENCES `event_tables`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

