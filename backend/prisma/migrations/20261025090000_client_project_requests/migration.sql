-- Project requests sent from the client panel.
ALTER TABLE "ProjectRequest" ADD COLUMN IF NOT EXISTS "clientUserId" TEXT;
CREATE INDEX IF NOT EXISTS "ProjectRequest_clientUserId_idx" ON "ProjectRequest"("clientUserId");
