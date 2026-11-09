-- Remember on the account (not in one browser) that someone has seen the
-- first-sign-in welcome. Everyone who already has an account has signed in
-- before, so they are marked as welcomed; only new sign-ups see it.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "welcomedAt" TIMESTAMP(3);
UPDATE "User" SET "welcomedAt" = CURRENT_TIMESTAMP WHERE "welcomedAt" IS NULL;
