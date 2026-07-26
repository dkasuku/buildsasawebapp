-- Project brief + uploaded photos. Both were already collected by the New /
-- Edit Project form and thrown away on save because there was no column for
-- them, which is why attached images never showed up again.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "images" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "targetEndDate" TIMESTAMP(3);
