-- CreateTable
CREATE TABLE `events` (
    `id` VARCHAR(30) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `name` VARCHAR(180) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `starts_at` DATETIME(3) NULL,
    `ends_at` DATETIME(3) NULL,
    `time_zone` VARCHAR(64) NOT NULL DEFAULT 'America/Mexico_City',
    `venue` VARCHAR(180) NULL,
    `capacity` INTEGER UNSIGNED NULL,
    `folio_prefix` VARCHAR(3) NULL,
    `fee_amount` DECIMAL(10, 2) NULL,
    `currency` CHAR(3) NOT NULL DEFAULT 'MXN',
    `companion_limit` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `registration_mode` VARCHAR(32) NOT NULL DEFAULT 'individual',
    `landing_content` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `events_slug_key`(`slug`),
    INDEX `events_status_starts_at_idx`(`status`, `starts_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_purchases` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `table_id` VARCHAR(30) NULL,
    `company` VARCHAR(180) NOT NULL,
    `contact_name` VARCHAR(180) NOT NULL,
    `contact_email` VARCHAR(254) NOT NULL,
    `max_seats` INTEGER UNSIGNED NOT NULL,
    `deadline` DATETIME(3) NULL,
    `token_hash` CHAR(64) NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'draft',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `group_purchases_token_hash_key`(`token_hash`),
    INDEX `group_purchases_event_id_status_idx`(`event_id`, `status`),
    INDEX `group_purchases_table_id_idx`(`table_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_tables` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `capacity` INTEGER UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `event_tables_event_id_idx`(`event_id`),
    UNIQUE INDEX `event_tables_event_id_name_key`(`event_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guests` (
    `id` VARCHAR(30) NOT NULL,
    `first_name` VARCHAR(100) NOT NULL,
    `last_name` VARCHAR(140) NOT NULL,
    `email` VARCHAR(254) NULL,
    `phone` VARCHAR(32) NULL,
    `organization` VARCHAR(180) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `guests_email_idx`(`email`),
    INDEX `guests_last_name_first_name_idx`(`last_name`, `first_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `registrations` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `guest_id` VARCHAR(30) NOT NULL,
    `group_purchase_id` VARCHAR(30) NULL,
    `table_id` VARCHAR(30) NULL,
    `seat_number` INTEGER UNSIGNED NULL,
    `folio` VARCHAR(16) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
    `registered_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `registrations_event_id_status_idx`(`event_id`, `status`),
    INDEX `registrations_guest_id_idx`(`guest_id`),
    INDEX `registrations_table_id_idx`(`table_id`),
    UNIQUE INDEX `registrations_event_id_folio_key`(`event_id`, `folio`),
    UNIQUE INDEX `registrations_group_purchase_id_seat_number_key`(`group_purchase_id`, `seat_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `passes` (
    `id` VARCHAR(30) NOT NULL,
    `registration_id` VARCHAR(30) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
    `issued_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revoked_at` DATETIME(3) NULL,

    UNIQUE INDEX `passes_token_hash_key`(`token_hash`),
    INDEX `passes_registration_id_status_idx`(`registration_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `checkins` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `pass_id` VARCHAR(30) NOT NULL,
    `access_point_id` VARCHAR(30) NOT NULL,
    `operator_user_id` VARCHAR(30) NULL,
    `checked_in_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `raffle_folio` VARCHAR(16) NULL,

    UNIQUE INDEX `checkins_pass_id_key`(`pass_id`),
    INDEX `checkins_event_id_checked_in_at_idx`(`event_id`, `checked_in_at`),
    INDEX `checkins_access_point_id_checked_in_at_idx`(`access_point_id`, `checked_in_at`),
    UNIQUE INDEX `checkins_event_id_raffle_folio_key`(`event_id`, `raffle_folio`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_counters` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `counter_type` VARCHAR(32) NOT NULL,
    `current_value` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `event_counters_event_id_counter_type_key`(`event_id`, `counter_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(30) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `display_name` VARCHAR(180) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(30) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `description` VARCHAR(255) NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `user_id` VARCHAR(30) NOT NULL,
    `role_id` VARCHAR(30) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_roles_role_id_idx`(`role_id`),
    PRIMARY KEY (`user_id`, `role_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `access_points` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `access_points_event_id_status_idx`(`event_id`, `status`),
    UNIQUE INDEX `access_points_event_id_name_key`(`event_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `consents` (
    `id` VARCHAR(30) NOT NULL,
    `registration_id` VARCHAR(30) NOT NULL,
    `purpose` VARCHAR(80) NOT NULL,
    `notice_version` VARCHAR(40) NOT NULL,
    `granted` BOOLEAN NOT NULL,
    `consented_at` DATETIME(3) NOT NULL,
    `withdrawn_at` DATETIME(3) NULL,

    INDEX `consents_registration_id_purpose_consented_at_idx`(`registration_id`, `purpose`, `consented_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(30) NOT NULL,
    `event_id` VARCHAR(30) NULL,
    `user_id` VARCHAR(30) NULL,
    `action` VARCHAR(100) NOT NULL,
    `entity_type` VARCHAR(80) NOT NULL,
    `entity_id` VARCHAR(30) NULL,
    `details` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_event_id_created_at_idx`(`event_id`, `created_at`),
    INDEX `audit_logs_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `audit_logs_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `group_purchases` ADD CONSTRAINT `group_purchases_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_purchases` ADD CONSTRAINT `group_purchases_table_id_fkey` FOREIGN KEY (`table_id`) REFERENCES `event_tables`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_tables` ADD CONSTRAINT `event_tables_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_guest_id_fkey` FOREIGN KEY (`guest_id`) REFERENCES `guests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_group_purchase_id_fkey` FOREIGN KEY (`group_purchase_id`) REFERENCES `group_purchases`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_table_id_fkey` FOREIGN KEY (`table_id`) REFERENCES `event_tables`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `passes` ADD CONSTRAINT `passes_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkins` ADD CONSTRAINT `checkins_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkins` ADD CONSTRAINT `checkins_pass_id_fkey` FOREIGN KEY (`pass_id`) REFERENCES `passes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkins` ADD CONSTRAINT `checkins_access_point_id_fkey` FOREIGN KEY (`access_point_id`) REFERENCES `access_points`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `checkins` ADD CONSTRAINT `checkins_operator_user_id_fkey` FOREIGN KEY (`operator_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_counters` ADD CONSTRAINT `event_counters_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `access_points` ADD CONSTRAINT `access_points_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `consents` ADD CONSTRAINT `consents_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
