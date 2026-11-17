CREATE TABLE "PayrollEligibilityChange" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "effectivePeriod" TEXT NOT NULL,
  "previousEligible" BOOLEAN NOT NULL,
  "eligible" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollEligibilityChange_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayrollEligibilityChange_employeeId_effectivePeriod_key" ON "PayrollEligibilityChange"("employeeId", "effectivePeriod");
ALTER TABLE "PayrollEligibilityChange" ADD CONSTRAINT "PayrollEligibilityChange_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
