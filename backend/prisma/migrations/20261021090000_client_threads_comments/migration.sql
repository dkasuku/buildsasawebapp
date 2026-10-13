-- Private client chats and comments on shared items.
ALTER TABLE "ClientMessage" ADD COLUMN IF NOT EXISTS "threadUserId" TEXT;
CREATE TABLE "ClientComment" (
  "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "projectId" TEXT, "targetType" TEXT NOT NULL, "targetId" TEXT NOT NULL,
  "authorType" TEXT NOT NULL, "authorId" TEXT, "authorName" TEXT NOT NULL, "body" TEXT, "media" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClientComment_workspaceId_targetType_targetId_idx" ON "ClientComment"("workspaceId", "targetType", "targetId");
CREATE INDEX "ClientComment_projectId_createdAt_idx" ON "ClientComment"("projectId", "createdAt");
