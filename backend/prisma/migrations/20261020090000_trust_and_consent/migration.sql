-- Site-reporting fee consent and client ratings of contractors.
ALTER TABLE "SiteReporting" ADD COLUMN IF NOT EXISTS "feeAgreedAt" TIMESTAMP(3);
CREATE TABLE "ContractorRating" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "clientUserId" TEXT NOT NULL, "clientName" TEXT NOT NULL,
  "stars" INTEGER NOT NULL, "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractorRating_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContractorRating_workspaceId_clientUserId_key" ON "ContractorRating"("workspaceId", "clientUserId");
CREATE INDEX "ContractorRating_workspaceId_idx" ON "ContractorRating"("workspaceId");
