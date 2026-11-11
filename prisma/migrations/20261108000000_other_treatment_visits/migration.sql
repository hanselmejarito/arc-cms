ALTER TABLE "OtherTreatment" ADD COLUMN "visitId" TEXT, ADD COLUMN "priceCentavos" INTEGER;
CREATE INDEX "OtherTreatment_visitId_idx" ON "OtherTreatment"("visitId");
