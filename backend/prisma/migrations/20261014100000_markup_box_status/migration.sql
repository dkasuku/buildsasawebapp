-- Plan markups: note-box size and open/resolved status.
ALTER TABLE "PlanMarkup" ADD COLUMN "w" DOUBLE PRECISION;
ALTER TABLE "PlanMarkup" ADD COLUMN "h" DOUBLE PRECISION;
ALTER TABLE "PlanMarkup" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'open';
