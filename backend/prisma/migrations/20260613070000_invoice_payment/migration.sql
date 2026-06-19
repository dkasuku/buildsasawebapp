-- Track actual payment received against an invoice (who got paid, when, how much)
ALTER TABLE "Invoice" ADD COLUMN "paidDate" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "paidAmount" INTEGER;
