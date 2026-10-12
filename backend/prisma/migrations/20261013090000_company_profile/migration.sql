-- Company profile shown on quotes, invoices and the client portal.
ALTER TABLE "Workspace" ADD COLUMN "logoUrl" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "phone" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "email" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "address" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "kraPin" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "paymentDetails" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "quoteTerms" TEXT;
