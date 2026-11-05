ALTER TABLE "Encounter" ADD COLUMN "consentSignature" TEXT, ADD COLUMN "consentSignedAt" TIMESTAMP(3), ADD COLUMN "consentRecordedBy" TEXT;
ALTER TABLE "Encounter" ADD COLUMN "doctorSignature" TEXT, ADD COLUMN "doctorSignatureMethod" TEXT, ADD COLUMN "doctorSignedAt" TIMESTAMP(3), ADD COLUMN "doctorRecordedBy" TEXT;
