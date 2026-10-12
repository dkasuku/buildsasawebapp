-- Daily log: videos, map position and client visibility.
ALTER TABLE "DailyLog" ADD COLUMN "videos" TEXT;
ALTER TABLE "DailyLog" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "DailyLog" ADD COLUMN "lng" DOUBLE PRECISION;
ALTER TABLE "DailyLog" ADD COLUMN "clientVisible" BOOLEAN NOT NULL DEFAULT true;
