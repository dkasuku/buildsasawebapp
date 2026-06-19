-- Add a trade field to Checklist so assignments can be grouped by trade
-- independently of the source template.
ALTER TABLE "Checklist" ADD COLUMN "trade" TEXT;
