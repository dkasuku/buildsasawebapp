-- Shareable links for checklist templates + public submissions.
ALTER TABLE "ChecklistTemplate" ADD COLUMN "shareToken" TEXT;
ALTER TABLE "ChecklistTemplate" ADD COLUMN "sharePublic" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "ChecklistTemplate_shareToken_key" ON "ChecklistTemplate"("shareToken");

CREATE TABLE "FormSubmission" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "respondentName" TEXT,
    "respondentEmail" TEXT,
    "data" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'public_link',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FormSubmission_templateId_idx" ON "FormSubmission"("templateId");
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
