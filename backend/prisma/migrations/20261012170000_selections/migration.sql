-- Finish selections: items chosen per room for client approval (see Selection).
CREATE TABLE "Selection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT NOT NULL,
    "room" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT,
    "supplier" TEXT,
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "unitPriceKES" DOUBLE PRECISION,
    "imageUrl" TEXT,
    "link" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "clientComment" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Selection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Selection_projectId_idx" ON "Selection"("projectId");
