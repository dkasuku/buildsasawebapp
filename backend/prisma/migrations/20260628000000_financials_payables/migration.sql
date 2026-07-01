-- Construction-finance (payables) additions. Purely additive: new tables for
-- payment applications, retention records, cost codes and an approvals audit
-- trail, plus nullable columns on Commitment and LedgerEntry. No drops, no data loss.

-- AlterTable: Commitment payables fields
ALTER TABLE "Commitment" ADD COLUMN "costCodeId" TEXT;
ALTER TABLE "Commitment" ADD COLUMN "contractValue" DOUBLE PRECISION;
ALTER TABLE "Commitment" ADD COLUMN "approvedVariations" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "Commitment" ADD COLUMN "invoicedToDate" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "Commitment" ADD COLUMN "paidToDate" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "Commitment" ADD COLUMN "retentionPct" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "Commitment" ADD COLUMN "retentionHeld" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "Commitment" ADD COLUMN "balanceRemaining" DOUBLE PRECISION DEFAULT 0;
ALTER TABLE "Commitment" ADD COLUMN "status" TEXT DEFAULT 'active';

-- AlterTable: LedgerEntry construction-finance links and status
ALTER TABLE "LedgerEntry" ADD COLUMN "vendorId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "commitmentId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "applicationId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "costCodeId" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "status" TEXT DEFAULT 'pending';
ALTER TABLE "LedgerEntry" ADD COLUMN "invoiceNumber" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "poNumber" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "subcontractNumber" TEXT;
ALTER TABLE "LedgerEntry" ADD COLUMN "changeOrderNumber" TEXT;

-- CreateTable
CREATE TABLE "PaymentApplication" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT NOT NULL,
    "commitmentId" TEXT,
    "number" TEXT NOT NULL,
    "period" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "workCompletedThisPeriod" DOUBLE PRECISION,
    "previousCertified" DOUBLE PRECISION DEFAULT 0,
    "requestedAmount" DOUBLE PRECISION,
    "retentionPct" DOUBLE PRECISION DEFAULT 0,
    "retentionAmount" DOUBLE PRECISION,
    "netPayable" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "costCodeId" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "commitmentId" TEXT NOT NULL,
    "amountHeld" DOUBLE PRECISION,
    "amountReleased" DOUBLE PRECISION DEFAULT 0,
    "remaining" DOUBLE PRECISION,
    "releaseDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'held',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PaymentApplication" ADD CONSTRAINT "PaymentApplication_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionRecord" ADD CONSTRAINT "RetentionRecord_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
