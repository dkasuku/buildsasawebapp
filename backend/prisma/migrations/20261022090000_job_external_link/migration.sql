-- Jobs shared from outside Buildsasa: contractors apply on the source site.
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "externalUrl" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
