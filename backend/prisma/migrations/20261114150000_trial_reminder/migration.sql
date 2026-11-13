-- When the "your free trial ends tomorrow" email was sent (once per company).
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "trialReminderAt" TIMESTAMP(3);
