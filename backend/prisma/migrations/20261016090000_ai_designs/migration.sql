-- AI Design Studio history (see AiDesign).
CREATE TABLE "AiDesign" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT,
    "mode" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "sourceImages" TEXT,
    "notes" TEXT,
    "projectId" TEXT,
    "drawingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiDesign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AiDesign_workspaceId_idx" ON "AiDesign"("workspaceId");
