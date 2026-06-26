-- Multi-tenant foundation: companies (workspaces) and the user -> workspace link.
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "User" ADD COLUMN "workspaceId" TEXT;

-- Backfill: put all existing users into one default workspace so nothing breaks.
INSERT INTO "Workspace" ("id", "name", "createdAt", "updatedAt")
VALUES ('ws_default', 'Default Workspace', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

UPDATE "User" SET "workspaceId" = 'ws_default' WHERE "workspaceId" IS NULL;
