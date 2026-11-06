CREATE TABLE "SignatureCorrection" (
 "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "recordId" TEXT NOT NULL, "encounterId" TEXT NOT NULL,
 "previousImage" TEXT NOT NULL, "previousSigner" TEXT NOT NULL, "previousMethod" TEXT,
 "previousSignedAt" TIMESTAMP(3), "previousRecordedBy" TEXT, "newSigner" TEXT NOT NULL,
 "newMethod" TEXT NOT NULL, "reason" TEXT NOT NULL, "correctedById" TEXT NOT NULL,
 "correctedByName" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SignatureCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SignatureCorrection_kind_recordId_createdAt_idx" ON "SignatureCorrection"("kind", "recordId", "createdAt");
