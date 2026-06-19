-- Extra checklist-item fields carried from the upload template, stored per
-- question so imported data integrity is preserved end-to-end.
ALTER TABLE "ChecklistQuestion" ADD COLUMN "questionGroup" TEXT;
ALTER TABLE "ChecklistQuestion" ADD COLUMN "defaultAnswer" TEXT;
ALTER TABLE "ChecklistQuestion" ADD COLUMN "photoAvailable" TEXT DEFAULT 'No';
ALTER TABLE "ChecklistQuestion" ADD COLUMN "correctiveOption" TEXT;
ALTER TABLE "ChecklistQuestion" ADD COLUMN "correctiveActions" TEXT;
ALTER TABLE "ChecklistQuestion" ADD COLUMN "policy" TEXT;
