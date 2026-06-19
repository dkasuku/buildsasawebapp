-- Activity/audit log for change orders (who did what, when).
CREATE TABLE "ChangeOrderActivity" (
    "id" TEXT NOT NULL,
    "changeOrderId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "userRole" TEXT,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChangeOrderActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChangeOrderActivity_changeOrderId_idx" ON "ChangeOrderActivity"("changeOrderId");
