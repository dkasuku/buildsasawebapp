-- Internal tendering: bid packages (tenders) posted on a project, with a
-- public shared link for subcontractors to submit without an account, and an
-- award flow. Purely additive: a new BidPackage table (+ unique publicToken
-- index) and nullable columns on Bid linking it to a package and capturing
-- public submitter contact details. No changes to existing data, no data loss.

-- CreateTable
CREATE TABLE "BidPackage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trade" TEXT,
    "description" TEXT,
    "budgetKES" DOUBLE PRECISION,
    "dueDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "publicToken" TEXT,
    "awardedBidId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BidPackage_publicToken_key" ON "BidPackage"("publicToken");

-- AlterTable
ALTER TABLE "Bid" ADD COLUMN "bidPackageId" TEXT;
ALTER TABLE "Bid" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Bid" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "Bid" ADD COLUMN "contactPhone" TEXT;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidPackageId_fkey" FOREIGN KEY ("bidPackageId") REFERENCES "BidPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
