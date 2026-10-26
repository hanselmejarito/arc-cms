-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "benefits" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Encounter" ALTER COLUMN "animal" SET DEFAULT '',
ALTER COLUMN "biteType" SET DEFAULT '',
ALTER COLUMN "pet" DROP NOT NULL,
ALTER COLUMN "pet" DROP DEFAULT,
ALTER COLUMN "vaccinated" DROP NOT NULL,
ALTER COLUMN "vaccinated" DROP DEFAULT,
ALTER COLUMN "stray" DROP NOT NULL,
ALTER COLUMN "stray" DROP DEFAULT,
ALTER COLUMN "owned" DROP NOT NULL,
ALTER COLUMN "owned" DROP DEFAULT,
ALTER COLUMN "side" SET DEFAULT '',
ALTER COLUMN "washed" DROP NOT NULL,
ALTER COLUMN "washed" DROP DEFAULT,
ALTER COLUMN "tandok" DROP NOT NULL,
ALTER COLUMN "tandok" DROP DEFAULT,
ALTER COLUMN "vaccine" SET DEFAULT '',
ALTER COLUMN "brand" SET DEFAULT '',
ALTER COLUMN "regimen" SET DEFAULT '',
ALTER COLUMN "pepEligible" SET DEFAULT false,
ALTER COLUMN "animalStatus" SET DEFAULT '';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "txn" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "PayrollInput" ADD COLUMN     "holidaySpecial" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OvertimeRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "decisionReason" TEXT NOT NULL DEFAULT '',
    "by" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OvertimeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionOverride" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromPeriod" TEXT NOT NULL,
    "sss" DOUBLE PRECISION,
    "phil" DOUBLE PRECISION,
    "pagibig" DOUBLE PRECISION,
    "reason" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContributionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OvertimeRequest_employeeId_date_idx" ON "OvertimeRequest"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "OvertimeRequest_employeeId_date_key" ON "OvertimeRequest"("employeeId", "date");

-- CreateIndex
CREATE INDEX "ContributionOverride_employeeId_fromPeriod_idx" ON "ContributionOverride"("employeeId", "fromPeriod");
