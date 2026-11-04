-- Quién registra a los invitados de una mesa y cómo se ven sus folios.
ALTER TABLE `orders`
  ADD COLUMN `delegate_name` VARCHAR(160) NULL,
  ADD COLUMN `delegate_email` VARCHAR(254) NULL,
  ADD COLUMN `folio_prefix` VARCHAR(10) NULL,
  ADD COLUMN `registration_deadline` DATETIME(3) NULL;

CREATE UNIQUE INDEX `orders_event_id_folio_prefix_key` ON `orders`(`event_id`, `folio_prefix`);
