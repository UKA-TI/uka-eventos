-- Boletos comprados en un pedido. Las compras conciliadas pueden ser de varios.
ALTER TABLE `orders` ADD COLUMN `quantity` INT UNSIGNED NOT NULL DEFAULT 1;
