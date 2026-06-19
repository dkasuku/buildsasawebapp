-- Enrich PunchItem with Procore-inspired fields (all nullable / defaulted for back-compat)
ALTER TABLE "PunchItem" ADD COLUMN "title" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN "category" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN "trade" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN "priority" TEXT DEFAULT 'medium';
ALTER TABLE "PunchItem" ADD COLUMN "assignees" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN "punchManagerId" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN "finalApproverId" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN "dueDate" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN "createdById" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN "costImpact" TEXT DEFAULT 'tbd';
ALTER TABLE "PunchItem" ADD COLUMN "scheduleImpact" TEXT DEFAULT 'tbd';
ALTER TABLE "PunchItem" ADD COLUMN "costCode" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN "reference" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PunchItem" ADD COLUMN "distribution" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN "linkedDrawingId" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN "drawingCoordinates" TEXT;

-- CreateTable
CREATE TABLE "PunchItemComment" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "punchItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PunchItemComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PunchItemAttachment" (
    "id" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "type" TEXT,
    "createdById" TEXT,
    "punchItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PunchItemAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PunchItemActivity" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actionType" TEXT NOT NULL,
    "field" TEXT,
    "before" TEXT,
    "after" TEXT,
    "punchItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PunchItemActivity_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PunchItemComment" ADD CONSTRAINT "PunchItemComment_punchItemId_fkey" FOREIGN KEY ("punchItemId") REFERENCES "PunchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PunchItemAttachment" ADD CONSTRAINT "PunchItemAttachment_punchItemId_fkey" FOREIGN KEY ("punchItemId") REFERENCES "PunchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PunchItemActivity" ADD CONSTRAINT "PunchItemActivity_punchItemId_fkey" FOREIGN KEY ("punchItemId") REFERENCES "PunchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
