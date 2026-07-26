-- Durable project links. These modules only ever stored the project NAME, so a
-- record could not be traced back to a real Project row and a rename orphaned
-- it. The name column stays for display; projectId is the actual link.
ALTER TABLE "Observation"       ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "CoordinationIssue" ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "ActionPlan"        ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "Correspondence"    ADD COLUMN IF NOT EXISTS "projectId" TEXT;
ALTER TABLE "Crew"              ADD COLUMN IF NOT EXISTS "projectId" TEXT;

-- Daily log: which crew roster the headcount came from, plus site conditions.
ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "crewId" TEXT;
ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "weather" TEXT;

-- Backfill the new links by matching the stored display name to a project.
-- Anything that referenced a demo/seed name simply stays NULL.
UPDATE "Observation" o       SET "projectId" = p."id" FROM "Project" p WHERE o."projectId" IS NULL AND o."project" = p."name";
UPDATE "CoordinationIssue" c SET "projectId" = p."id" FROM "Project" p WHERE c."projectId" IS NULL AND c."project" = p."name";
UPDATE "ActionPlan" a        SET "projectId" = p."id" FROM "Project" p WHERE a."projectId" IS NULL AND a."project" = p."name";
UPDATE "Correspondence" c    SET "projectId" = p."id" FROM "Project" p WHERE c."projectId" IS NULL AND c."project" = p."name";
UPDATE "Crew" c              SET "projectId" = p."id" FROM "Project" p WHERE c."projectId" IS NULL AND c."project" = p."name";
