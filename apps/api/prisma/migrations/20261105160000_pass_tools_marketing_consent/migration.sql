-- Los folios son consecutivos por evento: se retira el prefijo por mesa.
DROP INDEX `orders_event_id_folio_prefix_key` ON `orders`;
ALTER TABLE `orders`
  DROP COLUMN `folio_prefix`,
  ADD COLUMN `notes` VARCHAR(255) NULL;

-- Comprobante del permiso para recibir comunicaciones.
ALTER TABLE `contacts`
  ADD COLUMN `marketing_consent_at` DATETIME(3) NULL,
  ADD COLUMN `marketing_consent_source` VARCHAR(16) NULL,
  ADD COLUMN `marketing_notice_version` VARCHAR(40) NULL;

-- Programa, mapa y recordatorio del evento.
ALTER TABLE `events`
  ADD COLUMN `program_starts_at` DATETIME(3) NULL,
  ADD COLUMN `map_url` VARCHAR(500) NULL,
  ADD COLUMN `reminder_sent_at` DATETIME(3) NULL;
