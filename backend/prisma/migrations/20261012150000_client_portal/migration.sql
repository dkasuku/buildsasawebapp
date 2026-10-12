-- Client portal: per-project share link (see Project.portalToken).
ALTER TABLE "Project" ADD COLUMN "portalToken" TEXT;
ALTER TABLE "Project" ADD COLUMN "portalSharedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Project_portalToken_key" ON "Project"("portalToken");
