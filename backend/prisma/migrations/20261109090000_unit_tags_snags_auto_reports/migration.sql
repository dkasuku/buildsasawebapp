-- Unit tags on daily logs, inspections and 360 tours; snags per unit; automatic unit reports.
ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "unitIds" TEXT;
ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "unitIds" TEXT;
ALTER TABLE "VirtualTour" ADD COLUMN IF NOT EXISTS "unitIds" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN IF NOT EXISTS "unitId" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "unitReportFrequency" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "unitReportLastAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "PunchItem_unitId_idx" ON "PunchItem"("unitId");
