-- Subscription plan catalogue, editable from the admin panel. Seeded with the
-- two plans that were previously hardcoded in the backend so the SaaS pricing
-- screen and checkout behave identically the moment this ships.

CREATE TABLE IF NOT EXISTS "SubscriptionPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cycle" TEXT NOT NULL DEFAULT 'monthly',
    "usd" INTEGER NOT NULL DEFAULT 0,
    "days" INTEGER NOT NULL DEFAULT 30,
    "note" TEXT,
    "features" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPackage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SubscriptionPackage_active_sortOrder_idx"
    ON "SubscriptionPackage"("active", "sortOrder");

-- Seed the previously-hardcoded plans (no-op if they already exist).
INSERT INTO "SubscriptionPackage" ("id", "name", "cycle", "usd", "days", "note", "active", "sortOrder", "updatedAt")
VALUES
    ('standard-monthly', 'Buildsasa Standard — Monthly', 'monthly', 250, 30, 'Billed every month. Cancel anytime.', true, 0, CURRENT_TIMESTAMP),
    ('standard-yearly', 'Buildsasa Standard — Yearly', 'yearly', 2500, 365, 'Billed once a year — save $500 (2 months free).', true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
