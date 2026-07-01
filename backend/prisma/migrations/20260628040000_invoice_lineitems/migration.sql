-- Upgrade Invoice from a flat single-amount record into a line-item invoice.
-- Line items live in the existing "items" JSON column; "amount" stays the TOTAL
-- and "paidAmount" stays the amount received. Purely additive: every column is
-- nullable and only the existing "Invoice" table is touched. No data loss.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "billToAddress" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "shipTo" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "poNumber" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "paymentTerms" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "taxRate" DOUBLE PRECISION;
ALTER TABLE "Invoice" ADD COLUMN "discount" DOUBLE PRECISION;
ALTER TABLE "Invoice" ADD COLUMN "shipping" DOUBLE PRECISION;
ALTER TABLE "Invoice" ADD COLUMN "subtotal" DOUBLE PRECISION;
ALTER TABLE "Invoice" ADD COLUMN "terms" TEXT;
