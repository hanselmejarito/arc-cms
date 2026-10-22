-- CreateTable
CREATE TABLE "PayrollInput" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "late" DOUBLE PRECISION NOT NULL,
    "undertime" DOUBLE PRECISION NOT NULL,
    "night" DOUBLE PRECISION NOT NULL,
    "ot" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otApproved" BOOLEAN NOT NULL DEFAULT false,
    "holiday" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holidayType" TEXT NOT NULL DEFAULT 'Regular',
    "other" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollInput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollInput_employeeId_periodId_key" ON "PayrollInput"("employeeId", "periodId");
