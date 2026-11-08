-- Units in apartment blocks and estates, each with its own buyer and private
-- progress link, and daily AI allowances.
ALTER TABLE "ProjectClient" ADD COLUMN IF NOT EXISTS "unitId" TEXT;
ALTER TABLE "ClientUpdate" ADD COLUMN IF NOT EXISTS "unitId" TEXT;
ALTER TABLE "ClientMessage" ADD COLUMN IF NOT EXISTS "unitId" TEXT;
ALTER TABLE "ClientComment" ADD COLUMN IF NOT EXISTS "unitId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "unitId" TEXT;

CREATE TABLE IF NOT EXISTS "ProjectUnit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "block" TEXT,
    "floor" TEXT,
    "type" TEXT,
    "sizeSqm" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "stages" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "clientName" TEXT,
    "clientEmail" TEXT,
    "clientPhone" TEXT,
    "priceKES" DOUBLE PRECISION,
    "paidKES" DOUBLE PRECISION,
    "notes" TEXT,
    "shareToken" TEXT,
    "lastReportAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectUnit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectUnit_shareToken_key" ON "ProjectUnit"("shareToken");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectUnit_projectId_code_key" ON "ProjectUnit"("projectId", "code");
CREATE INDEX IF NOT EXISTS "ProjectUnit_projectId_idx" ON "ProjectUnit"("projectId");

CREATE TABLE IF NOT EXISTS "AiDailyUsage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AiDailyUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AiDailyUsage_workspaceId_day_kind_key" ON "AiDailyUsage"("workspaceId", "day", "kind");
