-- Existing employees remain unspecified; payroll and benefits are unchanged.
ALTER TABLE "Employee"
  ADD COLUMN "employmentClassification" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "workArrangement" TEXT NOT NULL DEFAULT '';
