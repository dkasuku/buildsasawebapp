-- Sasa Credits: AI usage allowance per company, plan allowance, and a ledger.
ALTER TABLE "Workspace" ADD COLUMN "aiPlanCredits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workspace" ADD COLUMN "aiTopupCredits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workspace" ADD COLUMN "aiCreditsResetAt" TIMESTAMP(3);
ALTER TABLE "SubscriptionPackage" ADD COLUMN "aiCredits" INTEGER NOT NULL DEFAULT 200;
CREATE TABLE "AiCreditTxn" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "bucket" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "action" TEXT,
    "note" TEXT,
    "userId" TEXT,
    "userName" TEXT,
    "paystackRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCreditTxn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiCreditTxn_paystackRef_key" ON "AiCreditTxn"("paystackRef");
CREATE INDEX "AiCreditTxn_workspaceId_createdAt_idx" ON "AiCreditTxn"("workspaceId", "createdAt");
