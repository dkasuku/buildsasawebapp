-- Task assignment hub: work tasks assigned to trades/people.
CREATE TABLE "WorkTask" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "trade" TEXT DEFAULT 'General',
    "assignees" TEXT,
    "priority" TEXT DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "dueDate" TEXT,
    "projectId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkTask_status_idx" ON "WorkTask"("status");
CREATE INDEX "WorkTask_projectId_idx" ON "WorkTask"("projectId");
