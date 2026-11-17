ALTER TABLE "Payment" ADD COLUMN "claimValueCentavos" INTEGER, ADD COLUMN "followUpDay" TEXT;
CREATE UNIQUE INDEX "Payment_encounterId_followUpDay_key" ON "Payment"("encounterId", "followUpDay");
