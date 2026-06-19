-- Add password hash for real authentication (nullable for existing demo/seed users)
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
