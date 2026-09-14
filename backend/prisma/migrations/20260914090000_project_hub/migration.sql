-- Project hub: everything about one project in one place. All additive and
-- nullable so existing rows are untouched.

-- Contract sum as a number. `value` is a display string and cannot be added to.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "contractSumKES" DOUBLE PRECISION;

-- Documents get a folder (category) and an optional link to the record they
-- support (an instruction letter behind a variation, a scanned certificate).
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'general';
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "linkedType" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "linkedId" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "uploadedBy" TEXT;
CREATE INDEX IF NOT EXISTS "Document_projectId_category_idx" ON "Document"("projectId", "category");

-- Variations are valued in shillings; costUSD stays in step for the CO module.
ALTER TABLE "ChangeOrder" ADD COLUMN IF NOT EXISTS "amountKES" DOUBLE PRECISION;

-- The scanned certificate behind a payment application.
ALTER TABLE "PaymentApplication" ADD COLUMN IF NOT EXISTS "fileUrl" TEXT;

-- Site diary: labour, plant, materials delivered, photos.
ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "labour" TEXT;
ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "plant" TEXT;
ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "materials" TEXT;
ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "photos" TEXT;

-- BOQ revisions: a frozen copy of the bill so a revised BOQ never overwrites the
-- one that was tendered on.
CREATE TABLE IF NOT EXISTS "BoqRevision" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "projectId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "label" TEXT,
  "note" TEXT,
  "snapshot" TEXT NOT NULL,
  "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BoqRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BoqRevision_projectId_idx" ON "BoqRevision"("projectId");

-- Rate library: fair rates for common items, per workspace.
CREATE TABLE IF NOT EXISTS "RateLibraryItem" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "code" TEXT,
  "description" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "category" TEXT,
  "source" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RateLibraryItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RateLibraryItem_workspaceId_idx" ON "RateLibraryItem"("workspaceId");
