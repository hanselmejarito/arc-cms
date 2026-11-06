CREATE TABLE "OtherTreatment" (
 "id" TEXT NOT NULL, "reference" TEXT NOT NULL, "patientId" TEXT NOT NULL, "branch" TEXT NOT NULL,
 "date" TEXT NOT NULL, "service" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'Pending',
 "product" TEXT NOT NULL DEFAULT '', "batch" TEXT NOT NULL DEFAULT '', "stockLineId" TEXT,
 "stockQuantity" INTEGER, "stockUnit" TEXT NOT NULL DEFAULT '', "administeredQuantity" DECIMAL(12,3),
 "administeredUnit" TEXT NOT NULL DEFAULT '', "administeredBy" TEXT NOT NULL DEFAULT '', "administeredAt" TIMESTAMP(3),
 "remarks" TEXT NOT NULL DEFAULT '', "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "OtherTreatment_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "OtherTreatment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OtherTreatment_reference_key" ON "OtherTreatment"("reference");
CREATE INDEX "OtherTreatment_branch_date_idx" ON "OtherTreatment"("branch", "date");
CREATE INDEX "OtherTreatment_patientId_date_idx" ON "OtherTreatment"("patientId", "date");
CREATE TABLE "OtherTreatmentPayment" (
 "id" TEXT NOT NULL, "treatmentId" TEXT NOT NULL, "amountCentavos" INTEGER NOT NULL,
 "method" TEXT NOT NULL, "externalReference" TEXT NOT NULL DEFAULT '', "paymentDate" TEXT NOT NULL,
 "recordedById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "OtherTreatmentPayment_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "OtherTreatmentPayment_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "OtherTreatment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OtherTreatmentPayment_treatmentId_key" ON "OtherTreatmentPayment"("treatmentId");
CREATE INDEX "OtherTreatmentPayment_paymentDate_idx" ON "OtherTreatmentPayment"("paymentDate");
CREATE TABLE "OtherTreatmentCounter" ("branch" TEXT NOT NULL, "year" INTEGER NOT NULL, "lastSeq" INTEGER NOT NULL, CONSTRAINT "OtherTreatmentCounter_pkey" PRIMARY KEY ("branch", "year"));
