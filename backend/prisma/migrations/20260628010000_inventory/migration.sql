-- Construction materials inventory. Purely additive: new tables for inventory
-- items and their stock-movement ledger, plus the movement -> item FK
-- (ON DELETE CASCADE). No changes to existing tables, no data loss.

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "unit" TEXT NOT NULL,
    "currentStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reorderLevel" DOUBLE PRECISION DEFAULT 0,
    "unitCostKES" DOUBLE PRECISION,
    "supplier" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "status" TEXT DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "itemId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryMovement_itemId_idx" ON "InventoryMovement"("itemId");

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
