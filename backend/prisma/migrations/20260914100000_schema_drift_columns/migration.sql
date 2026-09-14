-- Columns that schema.prisma has carried for a while but no migration ever
-- created. Production got them through `prisma db push`, so a fresh database
-- built from `migrate deploy` alone was missing them and the punch list,
-- checklists, inspections and chat all failed on insert. Every statement is
-- IF NOT EXISTS so this is a no-op where the column already exists.

ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "taskId" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN IF NOT EXISTS "taskTitle" TEXT;

ALTER TABLE "Checklist" ADD COLUMN IF NOT EXISTS "assignedTo" TEXT;
ALTER TABLE "Checklist" ADD COLUMN IF NOT EXISTS "assignee" TEXT;
ALTER TABLE "Checklist" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "Checklist" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
ALTER TABLE "Checklist" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "Checklist" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "Checklist" ADD COLUMN IF NOT EXISTS "submittedBy" TEXT;
ALTER TABLE "Checklist" ADD COLUMN IF NOT EXISTS "templateId" TEXT;

ALTER TABLE "ChecklistTemplate" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "ChecklistTemplate" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "ChecklistTemplate" ADD COLUMN IF NOT EXISTS "isGlobal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChecklistTemplate" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "ChecklistTemplate" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "assignedTo" TEXT;
ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "checklistId" TEXT;
ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "drawingRef" TEXT;
ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "photos" TEXT;
ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "readinessPhotos" TEXT;
ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "templateId" TEXT;
ALTER TABLE "Inspection" ADD COLUMN IF NOT EXISTS "videos" TEXT;

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "taskId" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "taskType" TEXT;

ALTER TABLE "PunchItem" ADD COLUMN IF NOT EXISTS "assignedTo" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN IF NOT EXISTS "drawingRef" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN IF NOT EXISTS "linkedTaskId" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN IF NOT EXISTS "photos" TEXT;
ALTER TABLE "PunchItem" ADD COLUMN IF NOT EXISTS "videos" TEXT;
