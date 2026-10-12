-- Jobs board: platform-posted jobs and the bids subscribed companies place on them.
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT,
    "budgetKES" DOUBLE PRECISION,
    "deadline" TEXT,
    "clientName" TEXT,
    "attachments" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Job_status_idx" ON "Job"("status");
CREATE TABLE "JobBid" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "amountKES" DOUBLE PRECISION NOT NULL,
    "timelineDays" INTEGER,
    "message" TEXT,
    "attachments" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobBid_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JobBid_jobId_workspaceId_key" ON "JobBid"("jobId", "workspaceId");
CREATE INDEX "JobBid_workspaceId_idx" ON "JobBid"("workspaceId");
ALTER TABLE "JobBid" ADD CONSTRAINT "JobBid_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
