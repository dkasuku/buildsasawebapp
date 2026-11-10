-- Casual labour muster and wage bill.
CREATE TABLE IF NOT EXISTS "Labourer" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "trade" TEXT,
    "dailyRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Labourer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Labourer_workspaceId_idx" ON "Labourer"("workspaceId");
CREATE TABLE IF NOT EXISTS "LabourDay" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "labourerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "markedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LabourDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LabourDay_labourerId_date_key" ON "LabourDay"("labourerId", "date");
CREATE INDEX IF NOT EXISTS "LabourDay_projectId_date_idx" ON "LabourDay"("projectId", "date");
