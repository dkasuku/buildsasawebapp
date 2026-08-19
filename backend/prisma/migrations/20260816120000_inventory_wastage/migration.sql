-- Material wastage tracking.
--
-- The ledger recorded in | out | adjust only, so material thrown away was
-- indistinguishable from material properly issued to the works, and no movement
-- carried a cost — the waste could never be valued in shillings. All columns are
-- nullable and additive, so existing rows and stock balances are untouched.
ALTER TABLE "InventoryMovement" ADD COLUMN IF NOT EXISTS "reason" TEXT;
ALTER TABLE "InventoryMovement" ADD COLUMN IF NOT EXISTS "unitCostKES" DOUBLE PRECISION;
ALTER TABLE "InventoryMovement" ADD COLUMN IF NOT EXISTS "valueKES" DOUBLE PRECISION;
ALTER TABLE "InventoryMovement" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "wasteAllowancePct" DOUBLE PRECISION;

-- Reports filter and group on these constantly.
CREATE INDEX IF NOT EXISTS "InventoryMovement_type_idx" ON "InventoryMovement"("type");
CREATE INDEX IF NOT EXISTS "InventoryMovement_projectId_idx" ON "InventoryMovement"("projectId");
