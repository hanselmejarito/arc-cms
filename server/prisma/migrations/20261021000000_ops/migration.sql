-- AlterTable
ALTER TABLE "User" ADD COLUMN "employeeId" TEXT;

-- CreateTable
CREATE TABLE "InventoryLine" (
    "id" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "expiry" TEXT NOT NULL,
    "stock" INTEGER NOT NULL,
    "begin" INTEGER NOT NULL,
    "received" INTEGER NOT NULL DEFAULT 0,
    "used" INTEGER NOT NULL DEFAULT 0,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "usesPerVial" INTEGER NOT NULL DEFAULT 0,
    "date" TEXT NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'MS',
    "unit" TEXT NOT NULL DEFAULT 'vials',
    "threshold" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InventoryLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerRow" (
    "id" TEXT NOT NULL,
    "stockId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "shift" TEXT NOT NULL,
    "begin" INTEGER NOT NULL,
    "received" INTEGER NOT NULL DEFAULT 0,
    "batch" TEXT NOT NULL DEFAULT '',
    "used" INTEGER NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL,
    "remarks" TEXT NOT NULL DEFAULT '',
    "signature" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "LedgerRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivedRow" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'MS',
    "item" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "batch" TEXT NOT NULL,
    "expiry" TEXT NOT NULL,
    "received" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,

    CONSTRAINT "ReceivedRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movement" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT NOT NULL DEFAULT '',
    "by" TEXT NOT NULL DEFAULT '',
    "shift" TEXT NOT NULL DEFAULT 'MS',
    "item" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "batch" TEXT NOT NULL DEFAULT '',
    "ref" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceEntry" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "remarks" TEXT NOT NULL DEFAULT '',
    "by" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "FinanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "patient" TEXT NOT NULL,
    "payment" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "requested" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL DEFAULT '—',
    "processedBy" TEXT NOT NULL DEFAULT '—',
    "refunded" TEXT NOT NULL DEFAULT '—',
    "status" TEXT NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "hours" INTEGER NOT NULL DEFAULT 8,
    "shift" TEXT NOT NULL DEFAULT 'Morning Shift',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "officer" BOOLEAN NOT NULL DEFAULT false,
    "payroll" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "clockIn" TEXT NOT NULL DEFAULT '',
    "clockOut" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'Time In button',
    "branch" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT 'Branch workstation',
    "corrected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryLine_branch_item_idx" ON "InventoryLine"("branch", "item");

-- CreateIndex
CREATE INDEX "LedgerRow_branch_item_date_idx" ON "LedgerRow"("branch", "item", "date");

-- CreateIndex
CREATE INDEX "ReceivedRow_branch_date_idx" ON "ReceivedRow"("branch", "date");

-- CreateIndex
CREATE INDEX "Movement_branch_date_idx" ON "Movement"("branch", "date");

-- CreateIndex
CREATE INDEX "FinanceEntry_branch_date_idx" ON "FinanceEntry"("branch", "date");

-- CreateIndex
CREATE INDEX "Refund_branch_status_idx" ON "Refund"("branch", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_userId_date_key" ON "Attendance"("userId", "date");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
