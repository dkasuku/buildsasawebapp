-- DB-managed platform admins, editable from the admin panel. Layered on top of
-- the PLATFORM_ADMIN_EMAILS env var (which remains the immutable root admins).
-- No seed: the env admins are the bootstrap set and are not stored here.

CREATE TABLE IF NOT EXISTS "PlatformAdmin" (
    "email" TEXT NOT NULL,
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("email")
);
