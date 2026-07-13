-- Platform-level tables for the admin panel: marketing leads (contact form +
-- demo requests), internal notes, editable site content and an admin audit
-- trail. None of these are tenant-scoped.

-- User: platform admins can suspend an account without deleting it.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';

-- Lead
CREATE TABLE IF NOT EXISTS "Lead" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'contact',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "interest" TEXT,
    "message" TEXT,
    "companySize" TEXT,
    "role" TEXT,
    "preferredDate" TIMESTAMP(3),
    "useCase" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "assignedTo" TEXT,
    "contactedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'website',
    "pageUrl" TEXT,
    "referrer" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Lead_kind_status_idx" ON "Lead"("kind", "status");
CREATE INDEX IF NOT EXISTS "Lead_createdAt_idx" ON "Lead"("createdAt");

-- LeadNote
CREATE TABLE IF NOT EXISTS "LeadNote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LeadNote_leadId_idx" ON "LeadNote"("leadId");

DO $$ BEGIN
    ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_leadId_fkey"
        FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- SiteContent
CREATE TABLE IF NOT EXISTS "SiteContent" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteContent_pkey" PRIMARY KEY ("key")
);

-- AdminAudit
CREATE TABLE IF NOT EXISTS "AdminAudit" (
    "id" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "meta" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");
CREATE INDEX IF NOT EXISTS "AdminAudit_actorEmail_idx" ON "AdminAudit"("actorEmail");
