-- 360° virtual tours shared with clients.
CREATE TABLE IF NOT EXISTS "VirtualTour" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'other',
    "scenes" TEXT,
    "createdById" TEXT,
    "createdBy" TEXT,
    "sharedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VirtualTour_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "VirtualTour_projectId_createdAt_idx" ON "VirtualTour"("projectId", "createdAt");
