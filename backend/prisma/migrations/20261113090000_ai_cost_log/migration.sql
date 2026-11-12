-- What each AI call cost, per company, for the admin AI spend page.
CREATE TABLE IF NOT EXISTS "AiCostLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "images" INTEGER NOT NULL DEFAULT 0,
    "usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiCostLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiCostLog_workspaceId_createdAt_idx" ON "AiCostLog"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiCostLog_createdAt_idx" ON "AiCostLog"("createdAt");
