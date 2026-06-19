-- Contractor-reported field progress for a checklist/work item (0-100),
-- kept separate from QA completion (answered questions / total).
ALTER TABLE "Checklist" ADD COLUMN "reportedProgress" INTEGER;
