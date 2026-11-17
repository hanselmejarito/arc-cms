ALTER TABLE "Encounter" ADD COLUMN "day14Workflow" TEXT NOT NULL DEFAULT 'legacy';
CREATE TABLE "AnimalObservation" (
  "id" TEXT NOT NULL,
  "encounterId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "observedDate" TEXT,
  "reportedDate" TEXT NOT NULL,
  "remarks" TEXT NOT NULL DEFAULT '',
  "recordedBy" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnimalObservation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AnimalObservation_encounterId_reportedDate_idx" ON "AnimalObservation"("encounterId", "reportedDate");
ALTER TABLE "AnimalObservation" ADD CONSTRAINT "AnimalObservation_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
