-- CreateTable
CREATE TABLE "Drawing" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "discipline" TEXT NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "uploadedBy" TEXT,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Drawing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Drawing_projectId_idx" ON "Drawing"("projectId");

-- CreateIndex
CREATE INDEX "Drawing_workspaceId_idx" ON "Drawing"("workspaceId");

-- AddForeignKey
ALTER TABLE "Drawing" ADD CONSTRAINT "Drawing_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
