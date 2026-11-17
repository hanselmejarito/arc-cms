ALTER TABLE "Attendance" ADD COLUMN "nightBranch" TEXT;
UPDATE "Attendance" SET "nightBranch" = "branch" WHERE "nightClockIn" <> '';
