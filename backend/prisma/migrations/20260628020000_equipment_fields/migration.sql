-- Extend Equipment with hire/rental tracking, costs, service-by-hours, and
-- compliance fields. Purely additive: every column is nullable and only the
-- existing "Equipment" table is touched. No data loss.

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN "assetTag" TEXT;
ALTER TABLE "Equipment" ADD COLUMN "condition" TEXT;
ALTER TABLE "Equipment" ADD COLUMN "operator" TEXT;
ALTER TABLE "Equipment" ADD COLUMN "ownership" TEXT;
ALTER TABLE "Equipment" ADD COLUMN "hireVendor" TEXT;
ALTER TABLE "Equipment" ADD COLUMN "hireRate" DOUBLE PRECISION;
ALTER TABLE "Equipment" ADD COLUMN "hireRateUnit" TEXT;
ALTER TABLE "Equipment" ADD COLUMN "hireStartDate" TIMESTAMP(3);
ALTER TABLE "Equipment" ADD COLUMN "hireEndDate" TIMESTAMP(3);
ALTER TABLE "Equipment" ADD COLUMN "purchaseCost" DOUBLE PRECISION;
ALTER TABLE "Equipment" ADD COLUMN "currentValue" DOUBLE PRECISION;
ALTER TABLE "Equipment" ADD COLUMN "meterHours" DOUBLE PRECISION;
ALTER TABLE "Equipment" ADD COLUMN "lastServiceHours" DOUBLE PRECISION;
ALTER TABLE "Equipment" ADD COLUMN "serviceIntervalHours" DOUBLE PRECISION;
ALTER TABLE "Equipment" ADD COLUMN "insuranceExpiry" TIMESTAMP(3);
ALTER TABLE "Equipment" ADD COLUMN "inspectionExpiry" TIMESTAMP(3);
ALTER TABLE "Equipment" ADD COLUMN "photoUrl" TEXT;
ALTER TABLE "Equipment" ADD COLUMN "documents" TEXT;
