-- Quotes: priced offers to clients before a project exists (see the Quote model).
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "quoteNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT,
    "clientEmail" TEXT,
    "clientAddress" TEXT,
    "items" TEXT NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION,
    "taxRate" DOUBLE PRECISION,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "depositPercent" DOUBLE PRECISION,
    "validUntil" TEXT,
    "notes" TEXT,
    "terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publicToken" TEXT,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "declineReason" TEXT,
    "projectId" TEXT,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Quote_publicToken_key" ON "Quote"("publicToken");
CREATE UNIQUE INDEX "Quote_workspaceId_quoteNumber_key" ON "Quote"("workspaceId", "quoteNumber");
CREATE INDEX "Quote_workspaceId_idx" ON "Quote"("workspaceId");
