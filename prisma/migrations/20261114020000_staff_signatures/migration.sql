ALTER TABLE "Encounter" ADD COLUMN "pendingDay0SignerId" TEXT, ADD COLUMN "pendingDay0Vaccinator" TEXT;
CREATE TABLE "StaffSignature" ("id" TEXT NOT NULL, "kind" TEXT NOT NULL, "name" TEXT NOT NULL, "employeeId" TEXT, "image" TEXT NOT NULL, "method" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "StaffSignature_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "StaffSignature_kind_employeeId_key" ON "StaffSignature"("kind", "employeeId");
CREATE INDEX "StaffSignature_kind_name_idx" ON "StaffSignature"("kind", "name");
CREATE UNIQUE INDEX "StaffSignature_doctor_name_key" ON "StaffSignature"(lower("name")) WHERE "kind" = 'Doctor';
