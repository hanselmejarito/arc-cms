CREATE TABLE "BranchSchedule" (
 "id" TEXT NOT NULL, "branchName" TEXT NOT NULL, "effectiveFrom" TEXT NOT NULL,
 "morningStart" TEXT NOT NULL, "morningEnd" TEXT NOT NULL,
 "nurseStart" TEXT NOT NULL, "nurseEnd" TEXT NOT NULL,
 "nightEnabled" BOOLEAN NOT NULL DEFAULT false, "nightStart" TEXT, "nightEnd" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BranchSchedule_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "BranchSchedule_branchName_fkey" FOREIGN KEY ("branchName") REFERENCES "Branch"("name") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BranchSchedule_branchName_effectiveFrom_key" ON "BranchSchedule"("branchName", "effectiveFrom");
CREATE INDEX "BranchSchedule_branchName_effectiveFrom_idx" ON "BranchSchedule"("branchName", "effectiveFrom");
