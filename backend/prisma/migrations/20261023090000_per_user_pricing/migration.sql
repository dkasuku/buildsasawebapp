-- Per-user pricing on plans (0 = flat price, unchanged).
ALTER TABLE "SubscriptionPackage" ADD COLUMN IF NOT EXISTS "includedUsers" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SubscriptionPackage" ADD COLUMN IF NOT EXISTS "perUserUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;
