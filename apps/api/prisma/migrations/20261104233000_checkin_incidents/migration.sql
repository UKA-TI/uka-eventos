-- AlterTable
ALTER TABLE `checkins` ADD COLUMN `client_event_id` VARCHAR(40) NULL,
    ADD COLUMN `manual_reason` VARCHAR(255) NULL,
    ADD COLUMN `source` VARCHAR(16) NOT NULL DEFAULT 'online';

-- CreateTable
CREATE TABLE `incidents` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `client_event_id` VARCHAR(40) NULL,
    `pass_id` VARCHAR(30) NULL,
    `access_point_id` VARCHAR(30) NULL,
    `operator_user_id` VARCHAR(30) NULL,
    `type` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `description` VARCHAR(500) NOT NULL,
    `occurred_at` DATETIME(3) NOT NULL,
    `resolution` VARCHAR(500) NULL,
    `resolved_by_id` VARCHAR(30) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `incidents_client_event_id_key`(`client_event_id`),
    INDEX `incidents_event_id_status_occurred_at_idx`(`event_id`, `status`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `checkins_client_event_id_key` ON `checkins`(`client_event_id`);

-- AddForeignKey
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_pass_id_fkey` FOREIGN KEY (`pass_id`) REFERENCES `passes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_access_point_id_fkey` FOREIGN KEY (`access_point_id`) REFERENCES `access_points`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_operator_user_id_fkey` FOREIGN KEY (`operator_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `incidents` ADD CONSTRAINT `incidents_resolved_by_id_fkey` FOREIGN KEY (`resolved_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- El perfil de Recepción opera el check-in. Es un perfil editable: si ya existe solo
-- se le agrega este permiso, sin tocar lo que se haya ajustado.
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission`)
SELECT `id`, 'checkin.operate' FROM `roles` WHERE `code` = 'RECEPTION';
