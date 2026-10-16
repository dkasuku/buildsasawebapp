-- Plan tiers: Starter vs Business features.
ALTER TABLE "SubscriptionPackage" ADD COLUMN IF NOT EXISTS "tier" TEXT NOT NULL DEFAULT 'business';
UPDATE "SubscriptionPackage" SET "tier" = 'starter' WHERE "id" = 'starter-monthly';
-- The old flat Standard plans had no paying customers (only staff accounts, who are comped).
DELETE FROM "SubscriptionPackage" WHERE "id" IN ('standard-monthly', 'standard-yearly');
