-- Client accounts, shared updates, client chat and Buildsasa site reporting.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "country" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "services" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "about" TEXT;
ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "clientVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "approval" TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "clientUserId" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "clientPhone" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "clientEmail" TEXT;
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "targetWorkspaceId" TEXT;

CREATE TABLE "ProjectClient" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "projectId" TEXT NOT NULL, "email" TEXT NOT NULL,
  "name" TEXT, "userId" TEXT, "invitedBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectClient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectClient_projectId_email_key" ON "ProjectClient"("projectId", "email");
CREATE INDEX "ProjectClient_email_idx" ON "ProjectClient"("email");
CREATE INDEX "ProjectClient_userId_idx" ON "ProjectClient"("userId");

CREATE TABLE "ClientUpdate" (
  "id" TEXT NOT NULL, "workspaceId" TEXT, "projectId" TEXT, "reportingId" TEXT, "stage" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'progress', "title" TEXT NOT NULL, "body" TEXT, "media" TEXT,
  "authorId" TEXT, "authorName" TEXT, "authorRole" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientUpdate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClientUpdate_projectId_createdAt_idx" ON "ClientUpdate"("projectId", "createdAt");
CREATE INDEX "ClientUpdate_reportingId_createdAt_idx" ON "ClientUpdate"("reportingId", "createdAt");

CREATE TABLE "ClientMessage" (
  "id" TEXT NOT NULL, "workspaceId" TEXT, "projectId" TEXT, "reportingId" TEXT, "senderType" TEXT NOT NULL,
  "senderId" TEXT, "senderName" TEXT NOT NULL, "body" TEXT, "media" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClientMessage_projectId_createdAt_idx" ON "ClientMessage"("projectId", "createdAt");
CREATE INDEX "ClientMessage_reportingId_createdAt_idx" ON "ClientMessage"("reportingId", "createdAt");

CREATE TABLE "SiteReporting" (
  "id" TEXT NOT NULL, "clientUserId" TEXT NOT NULL, "clientName" TEXT NOT NULL, "clientEmail" TEXT NOT NULL,
  "clientPhone" TEXT, "projectId" TEXT, "siteName" TEXT NOT NULL, "location" TEXT NOT NULL,
  "lat" DOUBLE PRECISION, "lng" DOUBLE PRECISION, "stages" TEXT, "notes" TEXT,
  "projectCostKES" DOUBLE PRECISION NOT NULL, "months" INTEGER NOT NULL, "feePercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
  "monthlyFeeKES" DOUBLE PRECISION NOT NULL, "status" TEXT NOT NULL DEFAULT 'requested', "inspectorName" TEXT,
  "adminNote" TEXT, "paidMonths" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteReporting_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteReporting_clientUserId_idx" ON "SiteReporting"("clientUserId");
CREATE INDEX "SiteReporting_status_createdAt_idx" ON "SiteReporting"("status", "createdAt");

CREATE TABLE "SiteReportingPayment" (
  "id" TEXT NOT NULL, "reportingId" TEXT NOT NULL, "amountKES" DOUBLE PRECISION NOT NULL, "months" INTEGER NOT NULL DEFAULT 1,
  "paystackRef" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteReportingPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteReportingPayment_paystackRef_key" ON "SiteReportingPayment"("paystackRef");
CREATE INDEX "SiteReportingPayment_reportingId_idx" ON "SiteReportingPayment"("reportingId");
