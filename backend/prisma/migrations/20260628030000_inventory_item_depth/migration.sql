-- Extend InventoryItem with material-depth fields: SKU/item code, stock
-- thresholds (min/max/reorder qty), supplier lead time, and supplier contact.
-- Purely additive: every column is nullable and only the existing
-- "InventoryItem" table is touched. No data loss.

-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN "sku" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "minLevel" DOUBLE PRECISION;
ALTER TABLE "InventoryItem" ADD COLUMN "maxLevel" DOUBLE PRECISION;
ALTER TABLE "InventoryItem" ADD COLUMN "reorderQty" DOUBLE PRECISION;
ALTER TABLE "InventoryItem" ADD COLUMN "leadTimeDays" INTEGER;
ALTER TABLE "InventoryItem" ADD COLUMN "supplierContact" TEXT;
