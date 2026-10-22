-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Branch" (
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "hours" TEXT NOT NULL,
    "accreditation" TEXT NOT NULL,
    "night" BOOLEAN NOT NULL,
    "main" BOOLEAN NOT NULL DEFAULT false,
    "morning" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'Active',

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "branchName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistryCounter" (
    "branchName" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL,

    CONSTRAINT "RegistryCounter_pkey" PRIMARY KEY ("branchName","year")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "first" TEXT NOT NULL,
    "middle" TEXT NOT NULL DEFAULT '',
    "last" TEXT NOT NULL,
    "suffix" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "birthday" TEXT NOT NULL,
    "age" INTEGER,
    "sex" TEXT NOT NULL,
    "contact" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "municipality" TEXT NOT NULL DEFAULT '',
    "municipalityOther" TEXT NOT NULL DEFAULT '',
    "guardian" TEXT NOT NULL DEFAULT '',
    "senior" BOOLEAN NOT NULL DEFAULT false,
    "pwd" BOOLEAN NOT NULL DEFAULT false,
    "vetmed" BOOLEAN NOT NULL DEFAULT false,
    "philhealth" BOOLEAN NOT NULL DEFAULT false,
    "branch" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'Walk-in',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL,
    "registry" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL DEFAULT '',
    "chief" TEXT NOT NULL DEFAULT '',
    "animal" TEXT NOT NULL DEFAULT 'Dog',
    "animalOther" TEXT NOT NULL DEFAULT '',
    "biteType" TEXT NOT NULL DEFAULT 'Bite',
    "pet" BOOLEAN NOT NULL DEFAULT true,
    "vaccinated" BOOLEAN NOT NULL DEFAULT false,
    "stray" BOOLEAN NOT NULL DEFAULT false,
    "owned" BOOLEAN NOT NULL DEFAULT true,
    "owner" TEXT NOT NULL DEFAULT '',
    "biteDate" TEXT NOT NULL DEFAULT '',
    "biteTime" TEXT NOT NULL DEFAULT '',
    "side" TEXT NOT NULL DEFAULT 'L',
    "site" TEXT NOT NULL DEFAULT '',
    "place" TEXT NOT NULL DEFAULT '',
    "washed" BOOLEAN NOT NULL DEFAULT true,
    "tandok" BOOLEAN NOT NULL DEFAULT false,
    "wound" JSONB NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "booster" BOOLEAN NOT NULL DEFAULT false,
    "preExp" BOOLEAN NOT NULL DEFAULT false,
    "vaccine" TEXT NOT NULL DEFAULT 'PVRV',
    "brand" TEXT NOT NULL DEFAULT 'Bioshoot',
    "regimen" TEXT NOT NULL DEFAULT 'ID',
    "history" JSONB NOT NULL,
    "bp" TEXT NOT NULL DEFAULT '',
    "weight" TEXT NOT NULL DEFAULT '',
    "temp" TEXT NOT NULL DEFAULT '',
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "consentBy" TEXT NOT NULL DEFAULT '',
    "tt" JSONB NOT NULL,
    "rig" TEXT NOT NULL DEFAULT '',
    "erig" JSONB NOT NULL,
    "pepEligible" BOOLEAN NOT NULL DEFAULT true,
    "stopAfter" INTEGER,
    "animalStatus" TEXT NOT NULL DEFAULT 'Alive',
    "progress" JSONB NOT NULL,
    "doctor" TEXT NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "transferredTo" TEXT NOT NULL DEFAULT '',
    "died" BOOLEAN NOT NULL DEFAULT false,
    "rer" BOOLEAN NOT NULL DEFAULT false,
    "billing" TEXT NOT NULL DEFAULT '',
    "past" BOOLEAN NOT NULL DEFAULT false,
    "seriesStartDate" TEXT,
    "continuedFromEncounterId" TEXT,
    "originRegistry" TEXT NOT NULL DEFAULT '',
    "referredFrom" TEXT NOT NULL DEFAULT '',
    "referredTo" TEXT NOT NULL DEFAULT '',
    "receivingRegistry" TEXT NOT NULL DEFAULT '',
    "receivingEncounterId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dose" (
    "id" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL DEFAULT '',
    "dose" TEXT NOT NULL DEFAULT '',
    "side" TEXT NOT NULL DEFAULT '',
    "brand" TEXT NOT NULL DEFAULT '',
    "batch" TEXT NOT NULL DEFAULT '',
    "route" TEXT NOT NULL DEFAULT 'ID',
    "advised" TEXT NOT NULL DEFAULT '',
    "animalStatus" TEXT NOT NULL DEFAULT 'Alive',
    "vaccinator" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressNote" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "s" JSONB NOT NULL,
    "animal" TEXT NOT NULL DEFAULT 'Alive',
    "o" JSONB NOT NULL,
    "a" JSONB NOT NULL,
    "p" JSONB NOT NULL,
    "staff" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "registry" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "patient" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL DEFAULT '—',
    "reference" TEXT NOT NULL DEFAULT '—',
    "status" TEXT NOT NULL,
    "remarks" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "patient" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "encounterId" TEXT NOT NULL,
    "registry" TEXT NOT NULL,
    "originRegistry" TEXT NOT NULL DEFAULT '',
    "receivingRegistry" TEXT NOT NULL DEFAULT '',
    "receivingEncounterId" TEXT NOT NULL DEFAULT '',
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "treatment" TEXT NOT NULL DEFAULT '',
    "next" TEXT NOT NULL DEFAULT '',
    "classification" TEXT NOT NULL DEFAULT 'PhilHealth',
    "status" TEXT NOT NULL,
    "remarks" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "record" TEXT NOT NULL DEFAULT '—',
    "oldValue" TEXT NOT NULL DEFAULT '—',
    "newValue" TEXT NOT NULL DEFAULT 'Saved',
    "time" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Patient_last_first_middle_birthday_idx" ON "Patient"("last", "first", "middle", "birthday");

-- CreateIndex
CREATE UNIQUE INDEX "Encounter_registry_key" ON "Encounter"("registry");

-- CreateIndex
CREATE UNIQUE INDEX "Dose_encounterId_day_key" ON "Dose"("encounterId", "day");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dose" ADD CONSTRAINT "Dose_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressNote" ADD CONSTRAINT "ProgressNote_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressNote" ADD CONSTRAINT "ProgressNote_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_encounterId_fkey" FOREIGN KEY ("encounterId") REFERENCES "Encounter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

