-- Attribution for contractor-reported field progress.
--
-- `reportedProgress` existed with no record of who set it or when, yet managers
-- treat it as fact and it is averaged into the project's headline progress bar.
-- Both columns are nullable, so existing rows are untouched and simply show no
-- reporter until the next update.
ALTER TABLE "Checklist" ADD COLUMN IF NOT EXISTS "reportedProgressBy" TEXT;
ALTER TABLE "Checklist" ADD COLUMN IF NOT EXISTS "reportedProgressAt" TIMESTAMP(3);
