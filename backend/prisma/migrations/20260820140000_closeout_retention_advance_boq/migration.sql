-- Four gaps in the project lifecycle, all additive and nullable so existing rows
-- and balances are untouched.

-- 1. Handover & defects liability. A project went from Closing to Archived with
--    nothing in between, so the phase where the contractor is still liable but no
--    longer building did not exist in the data.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "practicalCompletionAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "defectsLiabilityMonths" INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "defectsEndAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "finalAccountAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "closeoutNotes" TEXT;

-- 2. Retention release. releaseDate could pass with the row still "held" because
--    nothing ever looked at it.
ALTER TABLE "RetentionRecord" ADD COLUMN IF NOT EXISTS "stage" TEXT;
ALTER TABLE "RetentionRecord" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3);
ALTER TABLE "RetentionRecord" ADD COLUMN IF NOT EXISTS "releasedById" TEXT;
ALTER TABLE "RetentionRecord" ADD COLUMN IF NOT EXISTS "note" TEXT;

-- 3. Advance recovery. An advance was payable but nothing recovered it, so it sat
--    on the books as though it had been earned.
ALTER TABLE "Commitment" ADD COLUMN IF NOT EXISTS "advanceAmount" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "Commitment" ADD COLUMN IF NOT EXISTS "advanceRecovered" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "Commitment" ADD COLUMN IF NOT EXISTS "advanceRecoveryPct" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "PaymentApplication" ADD COLUMN IF NOT EXISTS "advanceRecovery" DOUBLE PRECISION DEFAULT 0;

-- 4. Bill of quantities. The budget previously had no origin.
CREATE TABLE IF NOT EXISTS "BoqSection" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "projectId" TEXT NOT NULL,
  "code" TEXT,
  "title" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BoqSection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BoqSection_projectId_idx" ON "BoqSection"("projectId");

CREATE TABLE IF NOT EXISTS "BoqItem" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "sectionId" TEXT NOT NULL,
  "code" TEXT,
  "description" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "costCodeId" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BoqItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BoqItem_sectionId_idx" ON "BoqItem"("sectionId");

DO $$ BEGIN
  ALTER TABLE "BoqItem" ADD CONSTRAINT "BoqItem_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "BoqSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
