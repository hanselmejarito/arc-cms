import { randomUUID } from 'node:crypto'
import { ApiRouter } from '../router.js'
import { z } from 'zod'
import type { AuditLog, ContributionOverride, Employee, FinanceEntry, InventoryLine, LedgerRow, Movement, OvertimeRequest, PayrollInput, ReceivedRow, Refund, User } from '@prisma/client'
import { prisma } from '../prisma.js'
import { audit } from '../audit.js'
import { canAccessBranch, hashPassword, requireAny, requireAuth, requirePage, type AuthedUser } from '../auth.js'
import { ALL_BRANCH_ROLES, canPage, clinicDate, clinicTime, refundEligible, refundRemaining } from '../clinical.js'
import { nextId } from '../ids.js'
import { catchUpBranch, closeShiftOnce } from '../shiftClose.js'
import { readSignature } from '../signatureInput.js'
import { nursesByDuty } from '../nurseDuty.js'
import { branchNightAt } from '../branchSchedules.js'
import { shouldResetMorningBreak } from '../attendanceCorrection.js'
import { currentPayrollPeriod, nextPayrollPeriod, payrollEligibleForPeriod } from '../../src/payrollEligibility.js'
import { ADJUST_REASONS, ITEM_NAMES, itemMeta } from '../inventory.js'
import {
  attendanceClient, attendanceCorrectionClient, branchClient, contributionOverrideClient, employeeClient, financeClient, inventoryClient, overtimeRequestClient, payrollInputClient,
  ledgerClient, movementClient, receivedClient, refundClient, userClient
} from '../map.js'

export const opsRouter = new ApiRouter()
opsRouter.use(requireAuth)

const ROLES = ['Superadmin', 'Admin', 'Nurse', 'PhilHealth Officer', 'Secretary'] as const
const NO_CLOCK_ROLES = ['Superadmin']
const STAFF_ROLES = ['Admin', 'Nurse', 'PhilHealth Officer', 'Secretary'] as const
const PEOPLE_ADMINS = ['Superadmin', 'Admin'] as const
const FINANCE_CATS: Record<string, string[]> = {
  Income: ['Other income', 'PhilHealth reimbursement', 'Miscellaneous income'],
  Expense: ['Utilities', 'Rent', 'Medical supplies', 'Transportation', 'Repairs & maintenance', 'Office supplies', 'Miscellaneous']
}
const REFUND_APPROVERS = ['Superadmin', 'Admin', 'Nurse', 'PhilHealth Officer', 'Secretary']
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const nowTime = () => new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
const toMins = (t: string) => {
  const [h, m] = String(t || '').split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
}
const stampMins = (t: string) => {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i)
  if (!m) return -1
  let h = Number(m[1])
  const min = Number(m[2])
  const ap = (m[4] || '').toUpperCase()
  if (ap === 'PM' && h < 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + min
}
const byWhen = (a: { date?: string, time?: string, id?: string }, b: { date?: string, time?: string, id?: string }) =>
  (b.date || '').localeCompare(a.date || '') || stampMins(b.time || '') - stampMins(a.time || '') || String(b.id || '').localeCompare(String(a.id || ''))
function shiftEndMins(role: string, shift: string, date = '', branch = '') {
  if (shift === 'Night Shift' || shift === 'NS') return 23 * 60
  if (role === 'PhilHealth Officer' || (date >= '2026-11-14' && (['Admin', 'Secretary'].includes(role) || (role === 'Nurse' && !['Guimba', 'Cabanatuan'].includes(branch))))) return 17 * 60
  return 16 * 60
}
function overtimeRoom(role: string, shift: string, clockOut: string, branch = '', date = '', schedule?: { morningStart:string; morningEnd:string; nurseStart:string; nurseEnd:string } | null) {
  const out = toMins(clockOut)
  const policy = ['Muñoz', 'Palayan'].includes(branch) && date >= '2026-11-11' && shift !== 'Night Shift' && shift !== 'NS'
  const configuredEnd = schedule ? toMins(role === 'Nurse' ? schedule.nurseEnd : schedule.morningEnd) : null
  const end = configuredEnd ?? (policy ? 18 * 60 : shiftEndMins(role, shift, date, branch)), grace = policy || date >= '2026-11-14' ? 15 : 0
  if (out == null || out <= end + grace) return 0
  return grace ? Math.round((out - end - grace) / 60 * 10000) / 10000 : Math.round((out - end) / 60 * 100) / 100
}

function scopeBranch(user: AuthedUser, branch: string) {
  if (!canAccessBranch(user, branch)) return false
  return true
}

async function assertBranch(name: string) {
  const row = await prisma.branch.findUnique({ where: { name } })
  if (!row) throw Object.assign(new Error('Unknown branch'), { status: 400 })
  return row
}

function deny(res: { status: (n: number) => { json: (b: object) => unknown } }, msg: string, status = 403) {
  return res.status(status).json({ error: msg })
}

const invPages = ['stock', 'receiving', 'usage', 'adjustments', 'alerts', 'invreport'] as const

export async function workspaceExtras(user: AuthedUser) {
  const canInv = invPages.some(p => canPage(user.role, p))
  const canFin = canPage(user.role, 'finance')
  const canRef = canPage(user.role, 'refunds')
  const canEmp = ['employees', 'payroll', 'payslips', 'users'].some(p => canPage(user.role, p))
  const canUsers = canPage(user.role, 'users')
  const canPay = canPage(user.role, 'payments')
  const payrollAdmin = PEOPLE_ADMINS.includes(user.role as typeof PEOPLE_ADMINS[number])
  const seeContrib = canPage(user.role, 'payroll') || canPage(user.role, 'payslips')
  const seeOt = canPage(user.role, 'attendance') || canPage(user.role, 'payslips') || canPage(user.role, 'payroll')
  const [branches, inventory, ledger, received, movements, finance, refunds, employees, attendance, users, payrollInputs, contributionOverrides, attendanceCorrectionRows, overtimeRequests] = await Promise.all([
    prisma.branch.findMany({ orderBy: { name: 'asc' } }),
    canInv ? prisma.inventoryLine.findMany() : Promise.resolve([] as InventoryLine[]),
    canInv ? prisma.ledgerRow.findMany({ orderBy: { date: 'asc' } }) : Promise.resolve([] as LedgerRow[]),
    canInv ? prisma.receivedRow.findMany({ orderBy: { date: 'asc' } }) : Promise.resolve([] as ReceivedRow[]),
    canInv ? prisma.movement.findMany({ orderBy: [{ date: 'desc' }, { id: 'desc' }] }) : Promise.resolve([] as Movement[]),
    canFin || canPay ? prisma.financeEntry.findMany({ orderBy: { date: 'desc' } }) : Promise.resolve([] as FinanceEntry[]),
    canRef || canPay ? prisma.refund.findMany({ orderBy: { requested: 'desc' } }) : Promise.resolve([] as Refund[]),
    canEmp ? prisma.employee.findMany({ orderBy: { id: 'asc' }, include: { users: { select: { email: true } }, payrollEligibilityHistory: true } }) : Promise.resolve([] as Employee[]),
    prisma.attendance.findMany({
      where: payrollAdmin ? (user.allBranches ? {} : { branch: user.branchName || '' }) : { userId: user.id },
      include: { user: { select: { employeeId: true, name: true } } },
      orderBy: { date: 'desc' }
    }),
    canUsers || payrollAdmin ? prisma.user.findMany({ orderBy: { name: 'asc' } }) : Promise.resolve([] as User[]),
    canPage(user.role, 'payroll') || canPage(user.role, 'payslips')
      ? prisma.payrollInput.findMany()
      : Promise.resolve([] as PayrollInput[]),
    seeContrib ? prisma.contributionOverride.findMany({ orderBy: { createdAt: 'desc' } }) : Promise.resolve([] as ContributionOverride[]),
    payrollAdmin
      ? prisma.auditLog.findMany({
        where: { action: 'Attendance correction', ...(user.allBranches ? {} : { branch: user.branchName || '' }) },
        orderBy: { createdAt: 'desc' },
        take: 200
      })
      : Promise.resolve([] as AuditLog[]),
    seeOt ? prisma.overtimeRequest.findMany({ orderBy: { date: 'desc' } }) : Promise.resolve([] as OvertimeRequest[])
  ] as const)
  const staleBranches = new Set(canInv ? inventory.filter(row => row.date < clinicDate()).map(row => row.branch) : [])
  const namesToCatchUp = user.allBranches
    ? [...staleBranches]
    : (user.branchName && staleBranches.has(user.branchName) ? [user.branchName] : [])
  for (const name of namesToCatchUp) await prisma.$transaction(tx => catchUpBranch(tx, name))
  const [currentInventory, currentLedger] = namesToCatchUp.length
    ? await Promise.all([prisma.inventoryLine.findMany(), prisma.ledgerRow.findMany({ orderBy: { date: 'asc' } })])
    : [inventory, ledger]
  const inBranch = (b: string) => user.allBranches || b === user.branchName
  const nurseDuty = process.env.TEMPORARY_BRANCH_ENABLED === 'true' ? new Map((await nursesByDuty(prisma)).map(n=>[n.id,n.dutyBranch])) : null
  const schedules = process.env.TEMPORARY_BRANCH_ENABLED === 'true' ? await prisma.branchSchedule.findMany({orderBy:{effectiveFrom:'desc'}}) : []
  return {
    branches: branches.map(b=>{const versions=schedules.filter(s=>s.branchName===b.name);const current=versions.find(s=>s.effectiveFrom<=clinicDate());return {...branchClient(b),...(process.env.TEMPORARY_BRANCH_ENABLED==='true'?{night:current?.nightEnabled??b.night,schedules:versions}:{})}}),
    inventory: currentInventory.filter(x => inBranch(x.branch)).map(inventoryClient),
    ledger: currentLedger.filter(x => inBranch(x.branch)).map(ledgerClient),
    received: received.filter(x => inBranch(x.branch)).map(receivedClient),
    movements: movements.filter(x => inBranch(x.branch)).map(movementClient).sort(byWhen),
    finance: finance.filter(x => inBranch(x.branch)).map(financeClient),
    refunds: refunds.filter(x => inBranch(x.branch)).map(refundClient),
    employees: employees.filter(e => inBranch(e.branch) || e.id === user.employeeId || (!!nurseDuty?.get(e.id) && inBranch(nurseDuty.get(e.id)!))).map(e => ({ ...employeeClient(e), ...(nurseDuty?.has(e.id) ? { dutyBranch: nurseDuty.get(e.id) } : {}), ...(!payrollAdmin ? { referenceNumber: undefined, employmentClassification: undefined, workArrangement: undefined } : {}), ...(!payrollAdmin && e.id !== user.employeeId ? { rate: undefined, hours: undefined, officer: undefined, payroll: undefined, payrollEligibilityHistory: undefined, benefits: undefined, email: undefined, logins: undefined } : {}) })),
    attendance: attendance.map(attendanceClient),
    users: users.map(userClient),
    payrollInputs: payrollInputs.filter(row => {
      if (!payrollAdmin) return row.employeeId === user.employeeId
      if (user.allBranches) return true
      return employees.some(e => e.id === row.employeeId && e.branch === user.branchName)
    }).map(payrollInputClient),
    contributionOverrides: contributionOverrides.filter(row => {
      if (!payrollAdmin) return row.employeeId === user.employeeId
      if (user.allBranches) return true
      return employees.some(e => e.id === row.employeeId && e.branch === user.branchName)
    }).map(contributionOverrideClient),
    attendanceCorrections: attendanceCorrectionRows.map(attendanceCorrectionClient),
    overtimeRequests: overtimeRequests.filter(row => {
      if (!payrollAdmin) return row.employeeId === user.employeeId
      if (user.allBranches) return true
      return employees.some(e => e.id === row.employeeId && e.branch === user.branchName)
    }).map(overtimeRequestClient)
  }
}

opsRouter.get('/ops', requirePage('dashboard'), async (req, res) => {
  res.json(await workspaceExtras(req.user!))
})

opsRouter.get('/clock', requireAuth, (_req, res) => res.json({ serverTime: new Date().toISOString() }))

const stockInSchema = z.object({
  item: z.enum(ITEM_NAMES as unknown as [string, ...string[]]),
  branch: z.string().min(1),
  date: dateStr,
  shift: z.enum(['MS', 'NS']).optional().default('MS'),
  quantity: z.coerce.number().int().positive(),
  batch: z.string().trim().min(1),
  expiry: dateStr,
  remark: z.string().optional().default(''),
  signature: z.string().optional().default('')
})

opsRouter.post('/inventory/stock-in', requireAny('stock', 'receiving', 'alerts'), async (req, res) => {
  const parsed = stockInSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'Batch no. and expiration date are required', 400)
  const form = parsed.data
  if (form.expiry < clinicDate()) return deny(res, 'Expiration date cannot be before today', 400)
  if (!scopeBranch(req.user!, form.branch)) return deny(res, 'This is not your branch')
  const storedBranch = await prisma.branch.findUnique({ where: { name: form.branch } })
  const branchRow = storedBranch ? {...storedBranch,night:await branchNightAt(prisma,storedBranch,form.date)} : null
  if (branchRow && !branchRow.night) form.shift = 'MS'
  const meta = itemMeta(form.item)
  if (!meta) return deny(res, 'Unknown item', 400)
  const qty = form.quantity
  const result = await prisma.$transaction(async tx => {
    await catchUpBranch(tx, form.branch)
    const open = await tx.inventoryLine.findFirst({ where: { branch: form.branch } })
    if (open) {
      form.date = open.date
      form.shift = branchRow?.night && open.shift === 'NS' ? 'NS' : 'MS'
    }
    const existing = await tx.inventoryLine.findMany({ where: { item: form.item, branch: form.branch } })
    const before = existing.reduce((a, x) => a + x.stock, 0)
    const line = existing.find(x => x.batch === form.batch)
    let saved
    if (line) {
      saved = await tx.inventoryLine.update({
        where: { id: line.id },
        data: { received: line.received + qty, stock: line.stock + qty, expiry: form.expiry, ...(branchRow && !branchRow.night ? { shift: 'MS' as const } : {}) }
      })
    } else {
      saved = await tx.inventoryLine.create({
        data: {
          id: await nextId(tx.inventoryLine, 'STK-', 3),
          item: form.item,
          type: meta.type,
          branch: form.branch,
          batch: form.batch,
          expiry: form.expiry,
          stock: qty,
          begin: 0,
          received: qty,
          used: 0,
          uses: 0,
          usesPerVial: meta.usesPerVial || 0,
          date: form.date,
          shift: form.shift,
          unit: meta.unit,
          threshold: meta.threshold
        }
      })
    }
    const received = await tx.receivedRow.create({
      data: {
        id: await nextId(tx.receivedRow, 'RCV-', 3),
        date: form.date,
        shift: form.shift,
        item: form.item,
        branch: form.branch,
        batch: form.batch,
        expiry: form.expiry,
        received: qty,
        remaining: before,
        total: before + qty
      }
    })
    const movement = await tx.movement.create({
      data: {
        id: await nextId(tx.movement, 'MOV-', 4),
        date: form.date,
        time: nowTime(),
        by: req.user!.name,
        shift: form.shift,
        item: form.item,
        branch: form.branch,
        type: 'Stock In',
        qty,
        batch: form.batch,
        ref: 'Receiving',
        reason: form.remark || ''
      }
    })
    return { saved, received, movement }
  })
  await audit(req, { module: 'Inventory', action: 'Stock In recorded · ' + qty + ' ' + form.item + ' at ' + form.branch, record: result.saved.id, branch: form.branch })
  res.json({
    line: inventoryClient(result.saved),
    received: receivedClient(result.received),
    movement: movementClient(result.movement)
  })
})

const stockOutSchema = z.object({
  item: z.enum(ITEM_NAMES as unknown as [string, ...string[]]),
  branch: z.string().min(1),
  date: dateStr,
  shift: z.enum(['MS', 'NS']).optional().default('MS'),
  quantity: z.coerce.number().int().positive(),
  line: z.string().optional().default(''),
  remark: z.string().optional().default(''),
  signature: z.string().optional().default('')
})

opsRouter.post('/inventory/stock-out', requireAny('usage', 'stock'), async (req, res) => {
  const parsed = stockOutSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, 'Enter a valid quantity', 400)
  const form = parsed.data
  if (!scopeBranch(req.user!, form.branch)) return deny(res, 'This is not your branch')
  const storedBranch = await prisma.branch.findUnique({ where: { name: form.branch } })
  const branchRow = storedBranch ? {...storedBranch,night:await branchNightAt(prisma,storedBranch,form.date)} : null
  if (branchRow && !branchRow.night) form.shift = 'MS'
  const existing = await prisma.inventoryLine.findMany({ where: { item: form.item, branch: form.branch } })
  const fifo = existing.filter(x => x.stock > 0 && x.expiry >= clinicDate()).sort((a, b) => a.expiry.localeCompare(b.expiry))
  const line = existing.find(x => x.id === form.line) || fifo[0] || existing[0]
  if (!line) return deny(res, 'No stock line for this item at ' + form.branch, 400)
  if (form.quantity > line.stock) return deny(res, 'Insufficient stock on hand (' + line.stock + ')', 409)
  const result = await prisma.$transaction(async tx => {
    await catchUpBranch(tx, form.branch)
    const open = await tx.inventoryLine.findFirst({ where: { branch: form.branch } })
    if (open) {
      form.date = open.date
      form.shift = branchRow?.night && open.shift === 'NS' ? 'NS' : 'MS'
    }
    const current = await tx.inventoryLine.findUnique({ where: { id: line.id } })
    const live = current || line
    const saved = await tx.inventoryLine.update({
      where: { id: live.id },
      data: { stock: live.stock - form.quantity, used: live.used + form.quantity, ...(branchRow && !branchRow.night ? { shift: 'MS' as const } : {}) }
    })
    const movement = await tx.movement.create({
      data: {
        id: await nextId(tx.movement, 'MOV-', 4),
        date: form.date,
        time: nowTime(),
        by: req.user!.name,
        shift: form.shift,
        item: line.item,
        branch: line.branch,
        type: 'Stock Out',
        qty: -form.quantity,
        batch: line.batch,
        ref: '',
        reason: form.remark || ''
      }
    })
    return { saved, movement }
  })
  await audit(req, { module: 'Inventory', action: 'Stock Out recorded', record: line.item + ' ' + line.batch, branch: line.branch, oldValue: String(line.stock), newValue: String(result.saved.stock) })
  res.json({ line: inventoryClient(result.saved), movement: movementClient(result.movement) })
})

const adjustSchema = z.object({
  item: z.enum(ITEM_NAMES as unknown as [string, ...string[]]),
  branch: z.string().min(1),
  date: dateStr,
  shift: z.enum(['MS', 'NS']).optional().default('MS'),
  quantity: z.coerce.number().int().positive(),
  line: z.string().optional().default(''),
  reason: z.enum(ADJUST_REASONS),
  direction: z.enum(['Increase', 'Decrease']).optional().default('Decrease'),
  to: z.string().optional().default(''),
  remark: z.string().min(1, 'A reason / remark is required for adjustments'),
  signature: z.string().optional().default('')
})

opsRouter.post('/inventory/adjust', requirePage('adjustments'), async (req, res) => {
  const parsed = adjustSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'A reason / remark is required for adjustments', 400)
  const form = parsed.data
  if (!scopeBranch(req.user!, form.branch)) return deny(res, 'This is not your branch')
  const storedBranch = await prisma.branch.findUnique({ where: { name: form.branch } })
  const branchRow = storedBranch ? {...storedBranch,night:await branchNightAt(prisma,storedBranch,form.date)} : null
  if (branchRow && !branchRow.night) form.shift = 'MS'
  const existing = await prisma.inventoryLine.findMany({ where: { item: form.item, branch: form.branch } })
  const line = existing.find(x => x.id === form.line) || existing[0]
  if (!line) return deny(res, 'No stock line for this item at ' + form.branch, 400)
  const decrease = form.direction === 'Decrease' || form.reason === 'Transfer to other branch'
  if (decrease && form.quantity > line.stock) return deny(res, 'Insufficient stock on hand (' + line.stock + ')', 409)
  if (form.reason === 'Transfer to other branch') {
    if (!form.to || form.to === form.branch) return deny(res, 'Receiving branch is required', 400)
    await assertBranch(form.to)
  }
  const result = await prisma.$transaction(async tx => {
    await catchUpBranch(tx, form.branch)
    const open = await tx.inventoryLine.findFirst({ where: { branch: form.branch } })
    if (open) {
      form.date = open.date
      form.shift = branchRow?.night && open.shift === 'NS' ? 'NS' : 'MS'
    }
    const source = await tx.inventoryLine.update({
      where: { id: line.id },
      data: { stock: line.stock + (decrease ? -form.quantity : form.quantity), ...(branchRow && !branchRow.night ? { shift: 'MS' as const } : {}) }
    })
    const lines = [source]
    const movements: Movement[] = []
    let received: ReceivedRow | null = null
    movements.push(await tx.movement.create({
      data: {
        id: await nextId(tx.movement, 'MOV-', 4),
        date: form.date,
        time: nowTime(),
        by: req.user!.name,
        shift: form.shift,
        item: line.item,
        branch: line.branch,
        type: 'Adjustment · ' + form.reason,
        qty: decrease ? -form.quantity : form.quantity,
        batch: line.batch,
        ref: form.reason === 'Transfer to other branch' ? 'less ' + form.quantity + ' (' + form.to + ')' : '',
        reason: form.remark
      }
    }))
    if (form.reason === 'Transfer to other branch') {
      await catchUpBranch(tx, form.to)
      const destBranch = await tx.branch.findUnique({ where: { name: form.to } })
      const destAll = await tx.inventoryLine.findMany({ where: { item: line.item, branch: form.to } })
      const before = destAll.reduce((a, x) => a + x.stock, 0)
      const dest = destAll.find(x => x.batch === line.batch)
      const anyOpen = destAll[0] || await tx.inventoryLine.findFirst({ where: { branch: form.to } })
      const destShift = destBranch?.night ? (anyOpen?.shift || form.shift) : 'MS'
      const destDate = anyOpen?.date || form.date
      let destLine
      if (dest) {
        destLine = await tx.inventoryLine.update({
          where: { id: dest.id },
          data: { stock: dest.stock + form.quantity, received: dest.received + form.quantity, shift: destShift, date: destDate }
        })
      } else {
        destLine = await tx.inventoryLine.create({
          data: {
            id: await nextId(tx.inventoryLine, 'STK-', 3),
            item: line.item,
            type: line.type,
            branch: form.to,
            batch: line.batch,
            expiry: line.expiry,
            stock: form.quantity,
            begin: 0,
            received: form.quantity,
            used: 0,
            uses: 0,
            usesPerVial: line.usesPerVial,
            date: destDate,
            shift: destShift,
            unit: line.unit,
            threshold: line.threshold
          }
        })
      }
      if (!destBranch?.night) {
        await tx.inventoryLine.updateMany({ where: { branch: form.to, shift: 'NS' }, data: { shift: 'MS' } })
      }
      lines.push(destLine)
      received = await tx.receivedRow.create({
        data: {
          id: await nextId(tx.receivedRow, 'RCV-', 3),
          date: destDate,
          shift: destShift,
          item: line.item,
          branch: form.to,
          batch: line.batch,
          expiry: line.expiry,
          received: form.quantity,
          remaining: before,
          total: before + form.quantity
        }
      })
      movements.push(await tx.movement.create({
        data: {
          id: await nextId(tx.movement, 'MOV-', 4),
          date: destDate,
          time: nowTime(),
          by: req.user!.name,
          shift: destShift,
          item: line.item,
          branch: form.to,
          type: 'Transfer in',
          qty: form.quantity,
          batch: line.batch,
          ref: 'From ' + line.branch,
          reason: form.remark
        }
      }))
    }
    return { lines, movements, received }
  })
  await audit(req, {
    module: 'Inventory',
    action: 'Stock adjustment · ' + form.reason,
    record: line.item + ' ' + line.batch,
    branch: line.branch,
    oldValue: String(line.stock),
    newValue: String(result.lines[0].stock)
  })
  res.json({
    lines: result.lines.map(inventoryClient),
    movements: result.movements.map(movementClient),
    received: result.received ? receivedClient(result.received) : null
  })
})

opsRouter.post('/inventory/close-shift', requireAny(...invPages), async (req, res) => {
  const branch = String(req.body.branch || '')
  if (!branch) return deny(res, 'Branch is required', 400)
  if (!scopeBranch(req.user!, branch)) return deny(res, 'This is not your branch')
  const branchRow = await prisma.branch.findUnique({ where: { name: branch } })
  if (!branchRow) return deny(res, 'Unknown branch', 400)
  const nightAvailable = await branchNightAt(prisma,branchRow,clinicDate())
  if (!nightAvailable) return deny(res, branch + ' stays on the morning shift. There is no night shift to close.', 400)
  const ls = await prisma.inventoryLine.findMany({ where: { branch } })
  if (!ls.length) return deny(res, 'No stock lines at ' + branch, 400)
  const today = clinicDate()
  const signature = String(req.body.signature || req.user!.name)
  if (ls.some(x => x.date > today)) return deny(res, 'The open shift is already on a later date. Close only ends today’s morning. The next morning opens on its own.', 400)
  if (ls.some(x => x.date < today)) {
    const before = new Set((await prisma.ledgerRow.findMany({ where: { branch }, select: { id: true } })).map(x => x.id))
    await prisma.$transaction(tx => catchUpBranch(tx, branch, signature))
    const [ledger, inventory] = await Promise.all([
      prisma.ledgerRow.findMany({ where: { branch } }),
      prisma.inventoryLine.findMany({ where: { branch } })
    ])
    const msg = branch + ' missed shifts were filed. Today’s morning is open. Close it when the morning shift ends.'
    await audit(req, { module: 'Inventory', action: msg, record: branch, branch })
    return res.json({
      message: msg,
      ledger: ledger.filter(x => !before.has(x.id)).map(ledgerClient),
      inventory: inventory.map(inventoryClient)
    })
  }
  if (ls.some(x => x.shift === 'NS')) return deny(res, 'Night shift is already open. It stays on tonight. Tomorrow’s morning opens on its own.', 400)
  const result = await prisma.$transaction(tx => closeShiftOnce(tx, {...branchRow,night:nightAvailable}, ls, signature))
  const msg = branch + ' morning shift closed · Night Shift now open (4:00 PM – 11:00 PM). Tomorrow’s morning opens on its own.'
  await audit(req, { module: 'Inventory', action: msg, record: branch, branch })
  res.json({
    message: msg,
    ledger: result.ledger.map(ledgerClient),
    inventory: result.inventory.map(inventoryClient)
  })
})

const financeSchema = z.object({
  type: z.enum(['Income', 'Expense']),
  date: dateStr,
  branch: z.string().min(1),
  category: z.string().min(1),
  description: z.string().trim().min(1),
  amount: z.coerce.number().positive(),
  reference: z.string().optional().default(''),
  remarks: z.string().optional().default('')
})

opsRouter.post('/finance', requirePage('finance'), async (req, res) => {
  const parsed = financeSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, 'Description and amount are required', 400)
  const form = parsed.data
  if (!scopeBranch(req.user!, form.branch)) return deny(res, 'This is not your branch')
  await assertBranch(form.branch)
  const allowed = FINANCE_CATS[form.type] || []
  if (!allowed.includes(form.category)) return deny(res, 'Unknown finance category', 400)
  const created = await prisma.financeEntry.create({
    data: {
      id: await nextId(prisma.financeEntry, 'FIN-', 3),
      ...form,
      by: req.user!.name
    }
  })
  await audit(req, { module: 'Finance', action: form.type + ' entry recorded', record: created.id, branch: form.branch, newValue: String(form.amount) })
  res.json(financeClient(created))
})

const refundSchema = z.object({
  payment: z.string().min(1),
  amount: z.coerce.number().positive(),
  reason: z.string().trim().min(1),
  requested: dateStr.optional()
})

opsRouter.post('/refunds', requirePage('refunds'), async (req, res) => {
  const parsed = refundSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, 'Select a payment and enter an amount', 400)
  if (parsed.data.payment.startsWith('OTP-')) {
    const otherPay = await prisma.otherTreatmentPayment.findUnique({
      where: { id: parsed.data.payment }, include: { treatment: { include: { patient: { select: { name: true } } } } }
    })
    if (!otherPay) return deny(res, 'Select a paid treatment.', 400)
    const treatment = otherPay.treatment
    if (!scopeBranch(req.user!, treatment.branch)) return deny(res, 'This is not your branch')
    if (treatment.status !== 'Cancelled') return deny(res, 'Cancel the pending treatment before requesting a refund.', 409)
    const requestedCents = Math.round(parsed.data.amount * 100)
    if (!Number.isSafeInteger(requestedCents) || Math.abs(parsed.data.amount * 100 - requestedCents) > 0.000001)
      return deny(res, 'Enter an amount with at most two decimal places.', 400)
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'other-refund:' + otherPay.id}))`
      const refunds = await tx.refund.findMany({ where: { payment: otherPay.id, NOT: { status: 'Rejected' } } })
      const used = refunds.reduce((sum, x) => sum + Math.round(Number(x.amount) * 100), 0)
      if (requestedCents > otherPay.amountCentavos - used) return null
      const created = await tx.refund.create({ data: {
        id: 'RFO-' + randomUUID(), patient: treatment.patient.name, payment: otherPay.id,
        branch: treatment.branch, amount: requestedCents / 100, reason: parsed.data.reason,
        requested: parsed.data.requested || clinicDate(), status: 'Pending'
      } })
      await tx.auditLog.create({ data: {
        userId: req.user!.id, userName: req.user!.name + ' (' + req.user!.role + ')',
        module: 'Refund', action: 'Other treatment refund requested', record: created.id,
        branch: treatment.branch, time: clinicDate() + ' · ' + nowTime(), device: req.userAgent
      } })
      return created
    })
    if (!result) return deny(res, 'Refund exceeds the remaining payment amount.', 409)
    return res.json(refundClient(result))
  }
  const pay = await prisma.payment.findUnique({ where: { id: parsed.data.payment } })
  if (!pay || pay.status !== 'Paid') return deny(res, 'Select a payment and enter an amount', 400)
  if (!scopeBranch(req.user!, pay.branch)) return deny(res, 'This is not your branch')
  const siblings = pay.txn
    ? await prisma.payment.findMany({ where: { txn: pay.txn, status: 'Paid' } })
    : [pay]
  const cap = siblings.reduce((s, p) => s + Number(p.amount || 0), 0)
  const existing = await prisma.refund.findMany({
    where: { payment: { in: siblings.map(p => p.id) }, NOT: { status: 'Rejected' } }
  })
  const remaining = refundRemaining(cap, existing, siblings.map(p => p.id))
  if (remaining <= 0) return deny(res, 'This payment already has a refund', 409)
  if (parsed.data.amount > remaining) return deny(res, 'Refund cannot exceed the remaining amount', 400)
  const enc = await prisma.encounter.findUnique({ where: { id: pay.encounterId } })
  if (enc) {
    const doses = await prisma.dose.findMany({
      where: { encounterId: { in: [enc.id, enc.continuedFromEncounterId || '', enc.receivingEncounterId || ''].filter(Boolean) } }
    })
    if (!refundEligible(enc, doses)) {
      return deny(res, 'Refund window closed · allowed only until the scheduled Day 7', 409)
    }
  }
  const created = await prisma.refund.create({
    data: {
      id: await nextId(prisma.refund, 'RFD-', 3),
      patient: pay.patient,
      payment: pay.id,
      branch: pay.branch,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      requested: parsed.data.requested || clinicDate(),
      status: 'Pending'
    }
  })
  await audit(req, { module: 'Refund', action: 'Refund requested at original paying branch', record: created.id, branch: pay.branch })
  res.json(refundClient(created))
})

opsRouter.post('/refunds/:id/status', requirePage('refunds'), async (req, res) => {
  const status = String(req.body.status || '')
  if (!['Approved', 'Rejected', 'Refunded'].includes(status)) return deny(res, 'Unknown refund status', 400)
  const row = await prisma.refund.findUnique({ where: { id: req.params.id } })
  if (!row) return deny(res, 'Refund not found', 404)
  if (status === 'Approved' || status === 'Rejected') {
    if (!REFUND_APPROVERS.includes(req.user!.role)) return deny(res, 'Awaiting approver')
    if (row.status !== 'Pending') return deny(res, 'Refund is not pending', 409)
  }
  if (status === 'Refunded') {
    if (row.status !== 'Approved') return deny(res, 'Refund must be approved first', 409)
    if (!req.user!.allBranches && req.user!.branchName !== row.branch) {
      return deny(res, 'Process at ' + row.branch)
    }
  }
  const updated = await prisma.refund.update({
    where: { id: row.id },
    data: {
      status,
      approvedBy: ['Approved', 'Rejected'].includes(status) ? req.user!.name : row.approvedBy,
      processedBy: status === 'Refunded' ? req.user!.name : row.processedBy,
      refunded: status === 'Refunded' ? clinicDate() : row.refunded
    }
  })
  await audit(req, { module: 'Refund', action: 'Refund ' + status.toLowerCase(), record: row.id, branch: row.branch, oldValue: row.status, newValue: status })
  res.json(refundClient(updated))
})


async function activeOwnNurse(user: AuthedUser) {
  if (user.role !== 'Nurse' || !user.employeeId) return null
  const employee = await prisma.employee.findUnique({ where: { id: user.employeeId } })
  return employee?.role === 'Nurse' && employee.status === 'Active' ? employee : null
}

opsRouter.get('/my-signature', async (req, res) => {
  const employee = await activeOwnNurse(req.user!)
  if (!employee) return deny(res, 'An active nurse account linked to an employee is required.', 403)
  const row = await prisma.staffSignature.findFirst({ where: { kind: 'Nurse', employeeId: employee.id } })
  return res.json({ name: employee.name, branch: employee.branch, signature: row ? { image: row.image, method: row.method, active: row.active, updatedAt: row.updatedAt.toISOString() } : null })
})

opsRouter.post('/my-signature', async (req, res) => {
  const employee = await activeOwnNurse(req.user!)
  if (!employee) return deny(res, 'An active nurse account linked to an employee is required.', 403)
  const parsed = z.object({ image: z.string().min(1).max(350000), method: z.enum(['pen', 'upload']), expectedUpdatedAt: z.string().optional(), reason: z.string().trim().max(500).default('') }).strict().safeParse(req.body)
  if (!parsed.success) return deny(res, 'Enter valid signature details.', 400)
  const form = parsed.data
  let signature: ReturnType<typeof readSignature>
  try { signature = readSignature(form.image, form.method) } catch { return deny(res, 'Choose a valid signature.', 400) }
  if (!signature) return deny(res, 'Choose a valid signature.', 400)
  const existing = await prisma.staffSignature.findFirst({ where: { kind: 'Nurse', employeeId: employee.id } })
  if (existing && !existing.active) return deny(res, 'Your saved signature is disabled. Contact an administrator.', 409)
  if (existing && (!form.reason || !form.expectedUpdatedAt || form.expectedUpdatedAt !== existing.updatedAt.toISOString())) return deny(res, 'Enter a reason and reload if the signature changed.', 409)
  if (!existing && form.expectedUpdatedAt) return deny(res, 'Signature changed. Reload and try again.', 409)
  try {
    const saved = await prisma.$transaction(async tx => {
      let row
      if (existing) {
        const result = await tx.staffSignature.updateMany({ where: { id: existing.id, employeeId: employee.id, kind: 'Nurse', active: true, updatedAt: existing.updatedAt }, data: { name: employee.name, image: signature!.image, method: signature!.method } })
        if (!result.count) throw new Error('Signature changed. Reload and try again.')
        row = await tx.staffSignature.findUniqueOrThrow({ where: { id: existing.id } })
      } else row = await tx.staffSignature.create({ data: { kind: 'Nurse', employeeId: employee.id, name: employee.name, image: signature!.image, method: signature!.method, active: true } })
      await tx.auditLog.create({ data: { userId: req.user!.id, userName: req.user!.name + ' (Nurse)', module: 'Signature', action: existing ? 'Own signature updated' : 'Own signature created', record: employee.name, branch: employee.branch, oldValue: existing ? 'Active' : '', newValue: existing ? 'Active · ' + form.reason : 'Nurse', time: clinicDate(), device: req.userAgent } })
      return row
    })
    return res.json({ name: employee.name, branch: employee.branch, signature: { image: saved.image, method: saved.method, active: saved.active, updatedAt: saved.updatedAt.toISOString() } })
  } catch (err) {
    if ((err instanceof Error && err.message.startsWith('Signature changed')) || (typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002')) return deny(res, 'Signature changed. Reload and try again.', 409)
    throw err
  }
})

opsRouter.get('/staff-signatures', requireAny('employees','exposure','treatments','notes'), async (req, res) => {
  const user=req.user!, admin=PEOPLE_ADMINS.includes(user.role as typeof PEOPLE_ADMINS[number])
  const rows=await prisma.staffSignature.findMany({where:admin?{}:{active:true},orderBy:{name:'asc'}})
  const duty=process.env.TEMPORARY_BRANCH_ENABLED==='true'?new Map((await nursesByDuty(prisma)).map(n=>[n.id,n.dutyBranch])):null
  const employees=await prisma.employee.findMany({where:{id:{in:rows.flatMap(r=>r.employeeId?[r.employeeId]:[])},...(admin?{}:{role:'Nurse',status:'Active',...(!duty&&!user.allBranches?{branch:user.branchName||''}:{})})},select:{id:true,name:true,branch:true,role:true,status:true}})
  const byId=new Map(employees.map(e=>[e.id,e]))
  return res.json(rows.filter(r=>r.kind==='Doctor'||(r.employeeId&&byId.has(r.employeeId)&&(admin||!duty||duty.get(r.employeeId)===user.branchName))).map(r=>({id:r.id,kind:r.kind,name:r.employeeId?byId.get(r.employeeId)?.name||r.name:r.name,employeeId:r.employeeId,branch:r.employeeId?(duty?.has(r.employeeId)?duty.get(r.employeeId):byId.get(r.employeeId)?.branch)||'':'',image:r.image,method:r.method,active:r.active&&(!r.employeeId||(byId.get(r.employeeId)?.status==='Active'&&byId.get(r.employeeId)?.role==='Nurse')),updatedAt:r.updatedAt.toISOString()})))
})
opsRouter.post('/staff-signatures', requirePage('employees'), async (req,res)=>{
  if(!PEOPLE_ADMINS.includes(req.user!.role as typeof PEOPLE_ADMINS[number]))return deny(res,'This role cannot manage saved signatures')
  const p=z.object({id:z.string().optional(),kind:z.enum(['Doctor','Nurse']),name:z.string().trim().max(150).default(''),employeeId:z.string().optional(),image:z.string().min(1).max(350000),method:z.enum(['pen','upload']),active:z.boolean().default(true),reason:z.string().trim().max(500).default(''),expectedUpdatedAt:z.string().optional()}).safeParse(req.body)
  if(!p.success)return deny(res,'Enter valid signer and signature details.',400)
  const f=p.data; let signature:ReturnType<typeof readSignature>
  try{signature=readSignature(f.image,f.method)}catch{return deny(res,'Choose a valid signature.',400)}
  if(!signature)return deny(res,'Choose a valid signature.',400)
  const emp=f.kind==='Nurse'&&f.employeeId?await prisma.employee.findUnique({where:{id:f.employeeId}}):null
  if(f.kind==='Nurse'&&(!emp||emp.role!=='Nurse'||emp.status!=='Active'))return deny(res,'Select an active Nurse employee.',400)
  const name=emp?.name||f.name;if(!name)return deny(res,'Enter the doctor name.',400)
  const old=f.id?await prisma.staffSignature.findUnique({where:{id:f.id}}):null
  if(f.id&&!old)return deny(res,'Signer not found.',404)
  if(old&&(old.kind!==f.kind||(old.employeeId||'')!==(emp?.id||'')||(!emp&&old.name!==name)))return deny(res,'The signer identity cannot be changed.',409)
  if(old&&(!f.reason||!f.expectedUpdatedAt||old.updatedAt.toISOString()!==f.expectedUpdatedAt))return deny(res,'Enter a reason and reload if the signature changed.',409)
  if(!old&&await prisma.staffSignature.findFirst({where:f.kind==='Nurse'?{kind:'Nurse',employeeId:emp!.id}:{kind:'Doctor',name:{equals:name,mode:'insensitive'}}}))return deny(res,'This signer already has a saved signature.',409)
  try{
    const saved=await prisma.$transaction(async tx=>{
      let row
      if(old){const changed=await tx.staffSignature.updateMany({where:{id:old.id,updatedAt:old.updatedAt},data:{name,image:signature!.image,method:signature!.method,active:f.active}});if(!changed.count)throw new Error('Signature changed. Reload and try again.');row=await tx.staffSignature.findUniqueOrThrow({where:{id:old.id}})}
      else row=await tx.staffSignature.create({data:{kind:f.kind,name,employeeId:emp?.id||null,image:signature!.image,method:signature!.method,active:f.active}})
      await tx.auditLog.create({data:{userId:req.user!.id,userName:req.user!.name+' ('+req.user!.role+')',module:'Signature',action:old?'Saved staff signature updated':'Saved staff signature created',record:name,branch:emp?.branch||'All branches',oldValue:old?(old.active?'Active':'Disabled'):'',newValue:old?(f.active?'Active':'Disabled')+' · '+f.reason:f.kind,time:clinicDate(),device:req.userAgent}})
      return row
    });return res.json({id:saved.id,kind:saved.kind,name:saved.name,employeeId:saved.employeeId,image:saved.image,method:saved.method,active:saved.active,updatedAt:saved.updatedAt.toISOString()})
  }catch(err){if(err instanceof Error&&err.message.startsWith('Signature changed'))return deny(res,err.message,409);throw err}
})

const employeeSchema = z.object({
  name: z.string().trim().min(1),
  referenceNumber: z.string().trim().max(100).optional(),
  email: z.string().trim().min(1),
  password: z.string().min(8),
  branch: z.string().min(1),
  position: z.string().trim().min(1).optional().default('Clinic Staff'),
  role: z.enum(STAFF_ROLES),
  employmentClassification: z.enum(['', 'Regular', 'Probationary']).optional(),
  workArrangement: z.enum(['', 'Full-time', 'Part-time']).optional(),
  rate: z.coerce.number().positive(),
  hours: z.coerce.number().positive().optional().default(8),
  shift: z.enum(['Morning Shift', 'Morning/Night', 'Night Shift']).optional().default('Morning Shift'),
  status: z.enum(['Active', 'Inactive']).optional().default('Active'),
  officer: z.boolean().optional().default(false),
  payroll: z.boolean().optional().default(true),
  benefits: z.boolean().optional().default(true)
})

opsRouter.post('/employees', requirePage('employees'), async (req, res) => {
  if (!PEOPLE_ADMINS.includes(req.user!.role as typeof PEOPLE_ADMINS[number])) return deny(res, 'This role cannot access this module')
  const parsed = employeeSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'Name, email, and password are required', 400)
  const form = parsed.data
  if (!req.user!.allBranches && form.branch !== req.user!.branchName) return deny(res, 'This is not your branch')
  const branchRow = await assertBranch(form.branch)
  if (form.shift === 'Night Shift' && !await branchNightAt(prisma,branchRow,clinicDate())) {
    return deny(res, form.branch + ' is not configured for night duty', 400)
  }
  const { email: loginEmail, password, ...empFields } = form
  const email = loginEmail.trim().toLowerCase()
  const exists = await prisma.user.findFirst({ where: { email } })
  if (exists) return deny(res, 'Email is already in use', 409)
  const all = ALL_BRANCH_ROLES.includes(form.role)
  const branchName = all ? null : form.branch
  const empId = await nextId(prisma.employee, 'EMP-', 3)
  const passwordHash = await hashPassword(password)
  const created = await prisma.$transaction(async tx => {
    const emp = await tx.employee.create({ data: { id: empId, ...empFields } })
    const user = await tx.user.create({
      data: {
        name: emp.name,
        email,
        passwordHash,
        role: emp.role,
        branchName,
        employeeId: emp.id,
        status: emp.status
      }
    })
    return { emp, user }
  })
  await audit(req, { module: 'Employees', action: 'Employee added with login', record: created.emp.name + ' · ' + email, branch: created.emp.branch })
  res.json({
    ...employeeClient({ ...created.emp, users: [{ email }] }),
    user: userClient(created.user)
  })
})

const userSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().min(1),
  password: z.string().min(8),
  role: z.enum(ROLES),
  branch: z.string().optional().default('Guimba'),
  employee: z.string().trim().optional().default('')
})

opsRouter.post('/users', requirePage('users'), async (req, res) => {
  const parsed = userSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'Name and email are required', 400)
  const form = parsed.data
  const email = form.email.trim().toLowerCase()
  const exists = await prisma.user.findFirst({ where: { email } })
  if (exists) return deny(res, 'Email is already in use', 409)
  const all = ALL_BRANCH_ROLES.includes(form.role)
  const branchName = all || form.branch === 'All branches' ? null : form.branch
  if (!all) {
    if (!branchName) return deny(res, 'Branch is required for this role', 400)
    await assertBranch(branchName)
  }
  const isSuper = form.role === 'Superadmin'
  if (!isSuper && !form.employee) return deny(res, 'Linked employee is required', 400)
  let emp: Employee | null = null
  if (form.employee) {
    emp = await prisma.employee.findUnique({ where: { id: form.employee } })
    if (!emp) return deny(res, 'Linked employee not found', 400)
    if (!all && emp.branch !== branchName) return deny(res, 'Linked employee must belong to ' + branchName, 400)
  }
  const created = await prisma.user.create({
    data: {
      name: form.name,
      email,
      passwordHash: await hashPassword(form.password),
      role: form.role,
      branchName: all ? null : branchName,
      employeeId: isSuper ? null : emp?.id || null,
      status: 'Active'
    }
  })
  await audit(req, { module: 'Users', action: 'User account created', record: created.email, branch: branchName || req.user!.branchName || 'Guimba' })
  res.json(userClient(created))
})

function summarizeDiff(before: Record<string, string>, after: Record<string, string>) {
  const changed = Object.keys(after).filter(k => (before[k] || '') !== (after[k] || ''))
  if (!changed.length) return null
  return {
    oldValue: changed.map(k => k + ': ' + (before[k] || '—')).join(' · '),
    newValue: changed.map(k => k + ': ' + (after[k] || '—')).join(' · ')
  }
}

async function lastActiveSuperadmin(exceptId?: string) {
  return prisma.user.count({
    where: { role: 'Superadmin', status: 'Active', ...(exceptId ? { id: { not: exceptId } } : {}) }
  })
}

const employeePatchSchema = employeeSchema.extend({
  password: z.string().min(8).optional().or(z.literal(''))
})

opsRouter.patch('/employees/:id', requirePage('employees'), async (req, res) => {
  if (!PEOPLE_ADMINS.includes(req.user!.role as typeof PEOPLE_ADMINS[number])) return deny(res, 'This role cannot access this module')
  const existing = await prisma.employee.findUnique({
    where: { id: req.params.id },
    include: { users: true, payrollEligibilityHistory: true }
  })
  if (!existing) return deny(res, 'Employee not found', 404)
  const parsed = employeePatchSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'Invalid employee update', 400)
  const form = parsed.data
  if (!req.user!.allBranches && form.branch !== req.user!.branchName) return deny(res, 'This is not your branch')
  const branchRow = await assertBranch(form.branch)
  if (form.shift === 'Night Shift' && !await branchNightAt(prisma,branchRow,clinicDate())) {
    return deny(res, form.branch + ' is not configured for night duty', 400)
  }
  const email = form.email.trim().toLowerCase()
  const primary = existing.users.find(u => u.role === existing.role) || existing.users[0]
  if (primary && email !== primary.email) {
    const taken = await prisma.user.findFirst({ where: { email, id: { not: primary.id } } })
    if (taken) return deny(res, 'Email is already in use', 409)
  }
  const password = typeof form.password === 'string' ? form.password.trim() : ''
  const updated = await prisma.$transaction(async tx => {
    if (form.payroll !== existing.payroll) {
      const currentPeriod = currentPayrollPeriod(clinicDate())
      const effectivePeriod = nextPayrollPeriod(clinicDate())
      const currentEligible = payrollEligibleForPeriod(existing, currentPeriod)
      if (form.payroll === currentEligible) {
        await tx.payrollEligibilityChange.deleteMany({ where: { employeeId: existing.id, effectivePeriod } })
      } else {
        await tx.payrollEligibilityChange.upsert({
          where: { employeeId_effectivePeriod: { employeeId: existing.id, effectivePeriod } },
          create: { employeeId: existing.id, effectivePeriod, previousEligible: currentEligible, eligible: form.payroll },
          update: { eligible: form.payroll }
        })
      }
    }
    const emp = await tx.employee.update({
      where: { id: existing.id },
      data: {
        name: form.name,
        referenceNumber: form.referenceNumber ?? existing.referenceNumber,
        branch: form.branch,
        position: form.position,
        role: form.role,
        employmentClassification: form.employmentClassification ?? existing.employmentClassification,
        workArrangement: form.workArrangement ?? existing.workArrangement,
        rate: form.rate,
        hours: form.hours,
        shift: form.shift,
        status: form.status,
        officer: form.officer,
        payroll: form.payroll,
        benefits: form.benefits
      }
    })
    for (const u of existing.users) {
      const isPrimary = primary && u.id === primary.id
      await tx.user.update({
        where: { id: u.id },
        data: {
          name: form.name,
          email: isPrimary ? email : u.email,
          role: u.role === existing.role ? form.role : u.role,
          branchName: ALL_BRANCH_ROLES.includes(u.role === existing.role ? form.role : u.role) ? null : form.branch,
          status: form.status,
          ...(isPrimary && password ? { passwordHash: await hashPassword(password) } : {})
        }
      })
    }
    if (form.status === 'Inactive' && existing.users.length) {
      await tx.session.deleteMany({ where: { userId: { in: existing.users.map(u => u.id) } } })
    }
    return tx.employee.findUniqueOrThrow({ where: { id: emp.id }, include: { users: true, payrollEligibilityHistory: true } })
  })
  const before = {
    Name: existing.name,
    'Reference number': existing.referenceNumber,
    Email: primary?.email || '',
    Branch: existing.branch,
    Position: existing.position,
    Role: existing.role,
    'Employment classification': existing.employmentClassification,
    'Work arrangement': existing.workArrangement,
    Rate: String(existing.rate),
    Hours: String(existing.hours),
    Shift: existing.shift,
    Status: existing.status,
    Officer: existing.officer ? 'Yes' : 'No',
    Payroll: existing.payroll ? 'Yes' : 'No',
    Benefits: existing.benefits ? 'Yes' : 'No'
  }
  const after = {
    Name: form.name,
    'Reference number': form.referenceNumber ?? existing.referenceNumber,
    Email: email,
    Branch: form.branch,
    Position: form.position,
    Role: form.role,
    'Employment classification': form.employmentClassification ?? existing.employmentClassification,
    'Work arrangement': form.workArrangement ?? existing.workArrangement,
    Rate: String(form.rate),
    Hours: String(form.hours),
    Shift: form.shift,
    Status: form.status,
    Officer: form.officer ? 'Yes' : 'No',
    Payroll: form.payroll ? 'Yes' : 'No',
    Benefits: form.benefits ? 'Yes' : 'No',
    ...(password ? { Password: 'Reset' } : {})
  }
  const diff = summarizeDiff(before, { ...after, ...(password ? { Password: '••••' } : {}) })
  if (diff || password) {
    await audit(req, {
      module: 'Employees',
      action: 'Employee record updated',
      record: updated.name + ' · ' + updated.id,
      branch: updated.branch,
      oldValue: diff?.oldValue || (password ? 'Password: ••••' : '—'),
      newValue: password && diff ? diff.newValue.replace('Password: ••••', 'Password: Reset') : (diff?.newValue || 'Password: Reset')
    })
  }
  const users = updated.users
  res.json({
    ...employeeClient({ ...updated, users }),
    user: users[0] ? userClient(users[0]) : undefined,
    users: users.map(userClient)
  })
})

const userPatchSchema = userSchema.extend({
  password: z.string().min(8).optional().or(z.literal('')),
  status: z.enum(['Active', 'Inactive']).optional().default('Active')
})

opsRouter.patch('/users/:id', requirePage('users'), async (req, res) => {
  const existing = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!existing) return deny(res, 'User account not found', 404)
  const parsed = userPatchSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'Invalid user update', 400)
  const form = parsed.data
  const email = form.email.trim().toLowerCase()
  if (email !== existing.email) {
    const taken = await prisma.user.findFirst({ where: { email } })
    if (taken) return deny(res, 'Email is already in use', 409)
  }
  const leavingSuper = existing.role === 'Superadmin' && existing.status === 'Active' && (form.role !== 'Superadmin' || form.status === 'Inactive')
  if (leavingSuper && (await lastActiveSuperadmin(existing.id)) < 1) {
    return deny(res, 'The last Superadmin account cannot be deactivated or reassigned', 400)
  }
  const all = ALL_BRANCH_ROLES.includes(form.role)
  const branchName = all || form.branch === 'All branches' ? null : form.branch
  const isSuper = form.role === 'Superadmin'
  if (!isSuper && !form.employee) return deny(res, 'Linked employee is required', 400)
  if (!all && !isSuper) {
    if (!branchName) return deny(res, 'Branch is required for this role', 400)
    await assertBranch(branchName)
  }
  let emp: Employee | null = null
  if (!isSuper && form.employee) {
    emp = await prisma.employee.findUnique({ where: { id: form.employee } })
    if (!emp) return deny(res, 'Linked employee not found', 400)
    if (!all && emp.branch !== branchName) return deny(res, 'Linked employee must belong to ' + branchName, 400)
  }
  const password = typeof form.password === 'string' ? form.password.trim() : ''
  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: {
      name: form.name,
      email,
      role: form.role,
      branchName: all ? null : branchName,
      employeeId: isSuper ? null : emp?.id || null,
      status: form.status,
      ...(password ? { passwordHash: await hashPassword(password) } : {})
    }
  })
  if (form.status === 'Inactive') {
    await prisma.session.deleteMany({ where: { userId: updated.id } })
  }
  const before = {
    Name: existing.name,
    Email: existing.email,
    Role: existing.role,
    Branch: existing.branchName || 'All branches',
    Employee: existing.employeeId || '—',
    Status: existing.status
  }
  const after = {
    Name: updated.name,
    Email: updated.email,
    Role: updated.role,
    Branch: updated.branchName || 'All branches',
    Employee: updated.employeeId || '—',
    Status: updated.status,
    ...(password ? { Password: 'Reset' } : {})
  }
  const diff = summarizeDiff(before, { ...after, ...(password ? { Password: '••••' } : {}) })
  if (diff || password) {
    await audit(req, {
      module: 'Users',
      action: 'User account updated',
      record: updated.email,
      branch: updated.branchName || req.user!.branchName || 'Guimba',
      oldValue: diff?.oldValue || (password ? 'Password: ••••' : '—'),
      newValue: password && diff ? diff.newValue.replace('Password: ••••', 'Password: Reset') : (diff?.newValue || 'Password: Reset')
    })
  }
  res.json(userClient(updated))
})

const branchSchema = z.object({
  contact: z.string().optional(),
  hours: z.string().optional(),
  address: z.string().optional(),
  status: z.enum(['Active', 'Inactive']).optional(),
  accreditation: z.enum(['Accredited', 'Not accredited']).optional(),
  morning: z.boolean().optional(),
  night: z.boolean().optional(),
  schedule: z.unknown().optional()
})

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const branchScheduleSchema = z.object({
  effectiveFrom: dateStr, morningStart: timeOfDay, morningEnd: timeOfDay,
  nurseStart: timeOfDay, nurseEnd: timeOfDay,
  nightEnabled: z.boolean(), nightStart: timeOfDay.nullable(), nightEnd: timeOfDay.nullable()
}).strict()

opsRouter.get('/branches/:name/schedules', requirePage('branches'), async (req, res) => {
  if (!await prisma.branch.findUnique({ where: { name: req.params.name } })) return deny(res, 'Unknown branch', 404)
  return res.json(await prisma.branchSchedule.findMany({ where: { branchName: req.params.name }, orderBy: { effectiveFrom: 'desc' } }))
})

opsRouter.post('/branches/:name/schedules', requirePage('branches'), async (req, res) => {
  const branch = await prisma.branch.findUnique({ where: { name: req.params.name } })
  if (!branch) return deny(res, 'Unknown branch', 404)
  const parsed = branchScheduleSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, 'Enter valid schedule times.', 400)
  const f = parsed.data
  const parsedDate = new Date(f.effectiveFrom + 'T00:00:00Z')
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== f.effectiveFrom) return deny(res, 'Choose a valid effective date.', 400)
  if (f.effectiveFrom <= clinicDate()) return deny(res, 'Choose an effective date after today.', 400)
  if (f.morningStart >= f.morningEnd || f.nurseStart >= f.nurseEnd || (f.nightEnabled && (!f.nightStart || !f.nightEnd || f.nightStart >= f.nightEnd))) return deny(res, 'End time must be after start time on the same day.', 400)
  if (!f.nightEnabled && (f.nightStart || f.nightEnd)) return deny(res, 'Remove night times when night duty is disabled.', 400)
  try {
    const result = await prisma.$transaction(async tx => {
      const row = await tx.branchSchedule.create({ data: { ...f, branchName: branch.name } })
      await tx.auditLog.create({ data: { userId: req.user!.id, userName: req.user!.name, module: 'Admin', action: 'Branch schedule added', record: branch.name, branch: branch.name, newValue: 'Effective ' + f.effectiveFrom, time: clinicDate(), device: req.userAgent } })
      return row
    })
    return res.json(result)
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002') return deny(res, 'A schedule already exists for this date.', 409)
    throw err
  }
})

opsRouter.patch('/branches/:name', requirePage('branches'), async (req, res) => {
  const existing = await prisma.branch.findUnique({ where: { name: req.params.name } })
  if (!existing) return deny(res, 'Unknown branch', 404)
  const parsed = branchSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, 'Invalid branch update', 400)
  const { schedule, ...branchData } = parsed.data
  let newSchedule: z.infer<typeof branchScheduleSchema> | undefined
  if (schedule !== undefined) {
    const checked = branchScheduleSchema.safeParse(schedule)
    if (!checked.success) return deny(res, 'Enter valid schedule times.', 400)
    newSchedule = checked.data
    const d = new Date(newSchedule.effectiveFrom + 'T00:00:00Z')
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== newSchedule.effectiveFrom || newSchedule.effectiveFrom <= clinicDate()) return deny(res, 'Choose a valid effective date after today.', 400)
    if (newSchedule.morningStart >= newSchedule.morningEnd || newSchedule.nurseStart >= newSchedule.nurseEnd || (newSchedule.nightEnabled && (!newSchedule.nightStart || !newSchedule.nightEnd || newSchedule.nightStart >= newSchedule.nightEnd)) || (!newSchedule.nightEnabled && (newSchedule.nightStart || newSchedule.nightEnd))) return deny(res, 'Enter valid same-day shift times.', 400)
    if (process.env.TEMPORARY_BRANCH_ENABLED !== 'true' && branchData.night !== undefined && branchData.night !== newSchedule.nightEnabled) return deny(res, 'Night duty settings must match.', 400)
  }
  if (process.env.TEMPORARY_BRANCH_ENABLED === 'true') delete branchData.night
  try {
    const updated = await prisma.$transaction(async tx => {
      const row = await tx.branch.update({ where: { name: existing.name }, data: branchData })
      if (newSchedule) await tx.branchSchedule.create({ data: { ...newSchedule, branchName: existing.name } })
      await tx.auditLog.create({ data: { userId: req.user!.id, userName: req.user!.name, module: 'Admin', action: 'Branch configuration updated', record: row.name, branch: row.name, newValue: newSchedule ? 'Schedule effective ' + newSchedule.effectiveFrom : 'Branch details updated', time: clinicDate(), device: req.userAgent } })
      return row
    })
    const activeSchedule = process.env.TEMPORARY_BRANCH_ENABLED === 'true' ? await prisma.branchSchedule.findFirst({where:{branchName:updated.name,effectiveFrom:{lte:clinicDate()}},orderBy:{effectiveFrom:'desc'}}) : null
    res.json({...branchClient(updated),...(process.env.TEMPORARY_BRANCH_ENABLED==='true'?{night:activeSchedule?.nightEnabled??updated.night}:{})})
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002') return deny(res, 'A schedule already exists for this date. No changes were saved.', 409)
    throw err
  }
})

opsRouter.post('/attendance/in', requirePage('attendance'), async (req, res) => {
  const user = req.user!
  const instant = new Date(), date = clinicDate(instant), at = clinicTime(instant)
  if (NO_CLOCK_ROLES.includes(user.role)) return deny(res, 'Superadmin does not Time In')
  if (process.env.TEMPORARY_BRANCH_ENABLED === 'true' && await prisma.attendance.findFirst({ where: { userId:user.id, date:{lt:date}, OR:[{clockIn:{not:''},clockOut:''},{nightClockIn:{not:''},nightClockOut:''}] }, select:{id:true} })) return deny(res, 'A previous duty is still open. Ask an administrator to correct it.', 409)
  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: user.id, date } } })
  if (existing?.clockIn) return deny(res, 'Time In already recorded', 409)
  if (existing?.nightClockIn) return deny(res, 'Morning Time In cannot start after night duty.', 409)
  const dutyEmployee = user.employeeId ? await prisma.employee.findUnique({ where: { id: user.employeeId } }) : null
  const duty = dutyEmployee?.branch || null
  const where = String(req.body.branch || duty || user.branchName || 'Guimba')
  if (process.env.TEMPORARY_BRANCH_ENABLED !== 'true' && !user.allBranches && where !== user.branchName) return deny(res, 'This is not your branch')
  const dutyBranch = await assertBranch(where)
  if (process.env.TEMPORARY_BRANCH_ENABLED === 'true' && (dutyBranch.status !== 'Active' || !dutyBranch.morning)) return deny(res, 'Morning duty is not available at this branch.', 400)
  const row = existing
    ? await prisma.attendance.update({ where: { id: existing.id }, data: { clockIn: at, branch: where, homeBranchAtMorning: duty || user.homeBranchName || user.branchName, roleAtMorning: dutyEmployee?.role || user.role, rateAtMorning: dutyEmployee?.rate ?? null, officerAtMorning: dutyEmployee?.officer ?? null, benefitsAtMorning: dutyEmployee?.benefits ?? null, source: 'Time In button', device: 'Branch workstation' } })
    : await prisma.attendance.create({
      data: {
        id: await nextId(prisma.attendance, 'ATT-', 4),
        userId: user.id,
        date,
        clockIn: at,
        clockOut: '',
        source: 'Time In button',
        branch: where,
        homeBranchAtMorning: duty || user.homeBranchName || user.branchName,
        roleAtMorning: dutyEmployee?.role || user.role,
        rateAtMorning: dutyEmployee?.rate ?? null,
        officerAtMorning: dutyEmployee?.officer ?? null,
        benefitsAtMorning: dutyEmployee?.benefits ?? null,
        device: 'Branch workstation'
      }
    })
  await audit(req, { module: 'Attendance', action: 'Time In recorded at ' + at + ' · ' + where, record: user.name, branch: where })
  res.json(attendanceClient({ ...row, user: { employeeId: user.employeeId, name: user.name } }))
})

opsRouter.post('/attendance/out', requirePage('attendance'), async (req, res) => {
  const user = req.user!
  const instant = new Date(), date = clinicDate(instant), at = clinicTime(instant)
  if (NO_CLOCK_ROLES.includes(user.role)) return deny(res, 'Superadmin does not Time Out')
  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: user.id, date } } })
  if (!existing?.clockIn) return deny(res, 'Time In first', 409)
  if (existing.clockOut) return deny(res, 'Time Out already recorded', 409)
  const row = await prisma.attendance.update({ where: { id: existing.id }, data: { clockOut: at } })
  await audit(req, { module: 'Attendance', action: 'Time Out recorded at ' + at, record: user.name, branch: existing.branch })
  res.json(attendanceClient({ ...row, user: { employeeId: user.employeeId, name: user.name } }))
})

// A second pair of clock stamps is reserved for night duty at the two branches.
opsRouter.post('/attendance/night/in', requirePage('attendance'), async (req, res) => {
  const user = req.user!, instant = new Date(), date = clinicDate(instant), at = clinicTime(instant)
  if (NO_CLOCK_ROLES.includes(user.role) || !user.employeeId) return deny(res, 'An employee login is required.', 400)
  if (process.env.TEMPORARY_BRANCH_ENABLED === 'true' && await prisma.attendance.findFirst({ where: { userId:user.id, date:{lt:date}, OR:[{clockIn:{not:''},clockOut:''},{nightClockIn:{not:''},nightClockOut:''}] }, select:{id:true} })) return deny(res, 'A previous duty is still open. Ask an administrator to correct it.', 409)
  const emp = await prisma.employee.findUnique({ where: { id: user.employeeId } })
  if (!emp) return deny(res, 'An employee record is required.', 403)
  const dutyBranchName = process.env.TEMPORARY_BRANCH_ENABLED === 'true' ? String(req.body.branch || emp.branch) : emp.branch
  const dutyBranch = await assertBranch(dutyBranchName)
  const dutySchedule = process.env.TEMPORARY_BRANCH_ENABLED === 'true' ? await prisma.branchSchedule.findFirst({where:{branchName:dutyBranchName,effectiveFrom:{lte:date}},orderBy:{effectiveFrom:'desc'}}) : null
  if (process.env.TEMPORARY_BRANCH_ENABLED === 'true' ? (dutyBranch.status !== 'Active' || !(dutySchedule?.nightEnabled ?? dutyBranch.night)) : !['Guimba', 'Cabanatuan'].includes(emp.branch)) return deny(res, 'Night duty is not available at this branch.', 403)
  if (process.env.TEMPORARY_BRANCH_ENABLED !== 'true' && !user.allBranches && emp.branch !== user.branchName) return deny(res, 'This is not your branch.', 403)
  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: user.id, date } } })
  if (existing?.nightClockIn) return deny(res, 'Night Time In already recorded.', 409)
  if (existing?.clockIn && !existing.clockOut) return deny(res, 'Time Out of the morning shift first.', 409)
  if (existing?.clockOut && existing.clockOut > at) return deny(res, 'Night Time In cannot precede morning Time Out.', 409)
  const row = existing
    ? await prisma.attendance.updateMany({ where: { id: existing.id, nightClockIn: '', nightClockOut: '', ...(existing.clockIn ? { clockOut: existing.clockOut } : { clockIn: '' }) }, data: { nightClockIn: at, nightBranch: dutyBranchName, homeBranchAtNight: emp.branch, roleAtNight: emp.role, rateAtNight: emp.rate, officerAtNight: emp.officer, benefitsAtNight: emp.benefits } }).then(async result => result.count ? prisma.attendance.findUniqueOrThrow({ where: { id: existing.id } }) : null)
    : await prisma.attendance.create({ data: { id: await nextId(prisma.attendance, 'ATT-', 4), userId: user.id, date, branch: dutyBranchName, nightBranch: dutyBranchName, homeBranchAtNight: emp.branch, roleAtNight: emp.role, rateAtNight: emp.rate, officerAtNight: emp.officer, benefitsAtNight: emp.benefits, nightClockIn: at, source: 'Time In button', device: 'Branch workstation' } })
  if (!row) return deny(res, 'Attendance changed. Reload and try again.', 409)
  await audit(req, { module: 'Attendance', action: 'Night Time In recorded at ' + at, record: user.name, branch: dutyBranchName })
  return res.json(attendanceClient({ ...row, user: { employeeId: user.employeeId, name: user.name } }))
})

opsRouter.post('/attendance/night/out', requirePage('attendance'), async (req, res) => {
  const user = req.user!, instant = new Date(), date = clinicDate(instant), at = clinicTime(instant)
  if (NO_CLOCK_ROLES.includes(user.role)) return deny(res, 'Superadmin does not Time Out', 400)
  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: user.id, date } } })
  if (!existing?.nightClockIn) return deny(res, 'Night Time In first.', 409)
  if (existing.nightClockOut) return deny(res, 'Night Time Out already recorded.', 409)
  const nightBranch = process.env.TEMPORARY_BRANCH_ENABLED === 'true' ? (existing.nightBranch || existing.branch) : existing.branch
  if (!user.allBranches && nightBranch !== user.branchName) return deny(res, 'This is not your branch.', 403)
  if (at <= existing.nightClockIn) return deny(res, 'Night Time Out must be after Time In.', 409)
  const changed = await prisma.attendance.updateMany({ where: { id: existing.id, nightClockIn: existing.nightClockIn, nightClockOut: '' }, data: { nightClockOut: at } })
  if (!changed.count) return deny(res, 'Attendance changed. Reload and try again.', 409)
  const row = await prisma.attendance.findUniqueOrThrow({ where: { id: existing.id } })
  await audit(req, { module: 'Attendance', action: 'Night Time Out recorded at ' + at, record: user.name, branch: row.branch })
  return res.json(attendanceClient({ ...row, user: { employeeId: user.employeeId, name: user.name } }))
})

const overtimeFileSchema = z.object({
  hours: z.coerce.number().positive(),
  reason: z.string().trim().min(1)
})

opsRouter.post('/attendance/overtime', requirePage('attendance'), async (req, res) => {
  const user = req.user!
  if (NO_CLOCK_ROLES.includes(user.role) || !user.employeeId) return deny(res, 'Overtime is filed from an employee login')
  const parsed = overtimeFileSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, 'Hours and a reason are required', 400)
  const emp = await prisma.employee.findUnique({ where: { id: user.employeeId } })
  if (!emp) return deny(res, 'Employee record is required to file overtime', 400)
  const date = clinicDate()
  const attendance = await prisma.attendance.findUnique({ where: { userId_date: { userId: user.id, date } } })
  if (!attendance?.clockOut) return deny(res, 'Time Out first', 400)
  const schedule = process.env.TEMPORARY_BRANCH_ENABLED === 'true' ? await prisma.branchSchedule.findFirst({ where:{branchName:attendance.branch,effectiveFrom:{lte:date}},orderBy:{effectiveFrom:'desc'} }) : null
  const room = overtimeRoom(attendance.roleAtMorning || emp.role, attendance.roleAtMorning ? 'Morning Shift' : emp.shift, attendance.clockOut, attendance.branch, date, schedule)
  if (room <= 0) return deny(res, 'Time Out is still inside the shift. Overtime starts after the shift ends.', 400)
  const newPolicy = date >= '2026-11-14' || (['Muñoz', 'Palayan'].includes(attendance.branch) && date >= '2026-11-11' && emp.shift !== 'Night Shift' && emp.shift !== 'NS')
  const hours = newPolicy ? Math.round(parsed.data.hours * 10000) / 10000 : Math.round(parsed.data.hours * 100) / 100
  if (hours > room + 0.001) return deny(res, 'Overtime cannot exceed the time after the shift ends (' + room + ' hours)', 400)
  const existing = await prisma.overtimeRequest.findUnique({ where: { employeeId_date: { employeeId: emp.id, date } } })
  if (existing && existing.status !== 'Pending') return deny(res, 'This request is already decided', 409)
  const saved = existing
    ? await prisma.overtimeRequest.update({ where: { id: existing.id }, data: { hours, reason: parsed.data.reason } })
    : await prisma.overtimeRequest.create({ data: { employeeId: emp.id, date, hours, reason: parsed.data.reason, status: 'Pending' } })
  await audit(req, { module: 'Attendance', action: 'Overtime requested', record: emp.name + ' · ' + date, branch: emp.branch, newValue: hours + ' h · ' + parsed.data.reason })
  res.json(overtimeRequestClient(saved))
})

const overtimeDecideSchema = z.object({
  status: z.enum(['Approved', 'Rejected']),
  reason: z.string().trim().min(1)
})

opsRouter.post('/attendance/overtime/:id/decide', requirePage('payroll'), async (req, res) => {
  if (!PEOPLE_ADMINS.includes(req.user!.role as typeof PEOPLE_ADMINS[number])) return deny(res, 'This role cannot access this module')
  const parsed = overtimeDecideSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, 'A reason is required', 400)
  const row = await prisma.overtimeRequest.findUnique({ where: { id: String(req.params.id) } })
  if (!row) return deny(res, 'Overtime request not found', 404)
  if (req.user!.employeeId && req.user!.employeeId === row.employeeId) return deny(res, 'You cannot approve your own overtime')
  const emp = await prisma.employee.findUnique({ where: { id: row.employeeId } })
  if (!emp) return deny(res, 'Employee not found', 400)
  if (!req.user!.allBranches && emp.branch !== req.user!.branchName) return deny(res, 'This is not your branch')
  const saved = await prisma.overtimeRequest.update({
    where: { id: row.id },
    data: { status: parsed.data.status, decisionReason: parsed.data.reason, by: req.user!.name + ' (' + req.user!.role + ')', decidedAt: new Date() }
  })
  await audit(req, { module: 'Payroll', action: 'Overtime ' + parsed.data.status.toLowerCase(), record: emp.name + ' · ' + row.date, branch: emp.branch, oldValue: row.status, newValue: parsed.data.status + ' · ' + parsed.data.reason })
  res.json(overtimeRequestClient(saved))
})

const correctSchema = z.object({
  date: dateStr,
  field: z.enum(['Time In', 'Time Out', 'Night Time In', 'Night Time Out']),
  updated: z.string().min(1),
  reason: z.string().trim().min(1),
  userId: z.string().optional()
})

const correctBranchSchema = z.object({
  userId: z.string().trim().min(1), date: dateStr, shift: z.enum(['morning', 'night']),
  branch: z.string().trim().min(1), expectedBranch: z.string().trim().min(1), reason: z.string().trim().min(1).max(500)
}).strict()

opsRouter.post('/attendance/correct-branch', requireAny('attendance'), async (req, res) => {
  if (process.env.TEMPORARY_BRANCH_ENABLED !== 'true') return deny(res, 'Branch correction is not available yet.', 403)
  if (!PEOPLE_ADMINS.includes(req.user!.role as typeof PEOPLE_ADMINS[number])) return deny(res, 'This role cannot correct attendance.', 403)
  const parsed = correctBranchSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, 'Select a duty, branch and reason.', 400)
  const f = parsed.data
  const row = await prisma.attendance.findUnique({ where: { userId_date: { userId: f.userId, date: f.date } }, include: { user: { select: { employeeId: true, name: true } } } })
  if (!row || (f.shift === 'morning' ? !row.clockIn : !row.nightClockIn)) return deny(res, 'Duty record not found.', 404)
  const original = f.shift === 'morning' ? row.branch : row.nightBranch || row.branch
  if (!req.user!.allBranches && (req.user!.branchName !== original || req.user!.branchName !== f.branch)) return deny(res, 'This is not your branch.', 403)
  if (original !== f.expectedBranch) return deny(res, 'Attendance changed. Reload and try again.', 409)
  if (original === f.branch) return deny(res, 'Choose a different branch.', 400)
  const destination = await prisma.branch.findUnique({ where: { name: f.branch } })
  const destinationSchedule = f.shift === 'night' ? await prisma.branchSchedule.findFirst({where:{branchName:f.branch,effectiveFrom:{lte:f.date}},orderBy:{effectiveFrom:'desc'}}) : null
  if (!destination || destination.status !== 'Active' || (f.shift === 'night' ? !(destinationSchedule?.nightEnabled ?? destination.night) : !destination.morning)) return deny(res, 'The selected branch does not offer this duty.', 400)
  try {
    const saved = await prisma.$transaction(async tx => {
      const where = f.shift === 'morning' ? { id: row.id, branch: row.branch } : { id: row.id, nightBranch: row.nightBranch }
      const data = f.shift === 'morning' ? { branch: f.branch, corrected: true, reviewedBreakMinutes: null, breakReviewedAt: null, breakReviewedBy: null } : { nightBranch: f.branch, corrected: true }
      const changed = await tx.attendance.updateMany({ where, data })
      if (!changed.count) throw new Error('Attendance changed. Reload and try again.')
      const entry = await tx.auditLog.create({ data: { userId: req.user!.id, userName: req.user!.name + ' (' + req.user!.role + ')', module: 'Attendance', action: 'Attendance correction', record: f.date + ' · ' + (f.shift === 'morning' ? 'Morning branch' : 'Night branch'), oldValue: original, newValue: f.branch + ' · ' + f.reason, branch: f.branch, time: clinicDate() + ' · ' + clinicTime(), device: req.userAgent } })
      return { attendance: await tx.attendance.findUniqueOrThrow({ where: { id: row.id } }), entry }
    })
    return res.json({ attendance: attendanceClient({ ...saved.attendance, user: row.user }), correction: attendanceCorrectionClient(saved.entry) })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Attendance changed')) return deny(res, err.message, 409)
    throw err
  }
})

opsRouter.post('/attendance/correct', requireAny('attendance'), async (req, res) => {
  if (!PEOPLE_ADMINS.includes(req.user!.role as typeof PEOPLE_ADMINS[number])) return deny(res, 'This role cannot access this module')
  const parsed = correctSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, 'Updated value and reason are required', 400)
  const targetId = parsed.data.userId || req.user!.id
  const k = parsed.data.field === 'Time In' ? 'clockIn' : parsed.data.field === 'Time Out' ? 'clockOut' : parsed.data.field === 'Night Time In' ? 'nightClockIn' : 'nightClockOut'
  const row = await prisma.attendance.findUnique({ where: { userId_date: { userId: targetId, date: parsed.data.date } } })
  if (k.startsWith('night') && (!row || !['Guimba', 'Cabanatuan'].includes(row.branch))) return deny(res, 'A Guimba or Cabanatuan attendance record is required.', 400)
  if (row && !req.user!.allBranches && row.branch !== req.user!.branchName) return deny(res, 'This is not your branch.', 403)
  if (k.startsWith('night') && !/^([01]\d|2[0-3]):[0-5]\d$/.test(parsed.data.updated)) return deny(res, 'Enter a valid time.', 400)
  if (row && k === 'nightClockIn' && row.nightClockOut && parsed.data.updated >= row.nightClockOut) return deny(res, 'Night Time In must be before Night Time Out.', 400)
  if (row && k === 'nightClockOut' && (!row.nightClockIn || parsed.data.updated <= row.nightClockIn)) return deny(res, 'Night Time Out must be after Night Time In.', 400)
  if (row && k === 'nightClockIn' && row.clockIn && !row.clockOut) return deny(res, 'Time Out of the morning shift first.', 409)
  if (row && k === 'nightClockIn' && row.clockOut && parsed.data.updated < row.clockOut) return deny(res, 'Night Time In cannot precede morning Time Out.', 400)
  if (row && k === 'clockOut' && row.nightClockIn && parsed.data.updated > row.nightClockIn) return deny(res, 'Morning Time Out cannot be after Night Time In.', 400)
  if (row && k === 'clockIn' && row.nightClockIn && !row.clockOut) return deny(res, 'Correct morning Time Out before Night Time In.', 400)
  const configuredBreak = row && process.env.TEMPORARY_BRANCH_ENABLED === 'true' ? await prisma.branchSchedule.findFirst({where:{branchName:row.branch,effectiveFrom:{lte:row.date}},select:{id:true}}) : null
  const original = row ? row[k] || '—' : '—'
  const resetBreak = row && shouldResetMorningBreak(k, row[k], parsed.data.updated, !!(configuredBreak || (process.env.TEMPORARY_BRANCH_ENABLED === 'true' && row.roleAtMorning) || (['Muñoz', 'Palayan'].includes(row.branch) && row.date >= '2026-11-11')))
  const saved = row
    ? await prisma.attendance.update({ where: { id: row.id }, data: { [k]: parsed.data.updated, corrected: true, ...(resetBreak ? { reviewedBreakMinutes: null, breakReviewedAt: null, breakReviewedBy: null } : {}) } })
    : await prisma.attendance.create({
      data: {
        id: await nextId(prisma.attendance, 'ATT-', 4),
        userId: targetId,
        date: parsed.data.date,
        clockIn: k === 'clockIn' ? parsed.data.updated : '',
        clockOut: k === 'clockOut' ? parsed.data.updated : '',
        source: 'Correction',
        branch: req.user!.branchName || 'Guimba',
        device: 'Branch workstation',
        corrected: true
      }
    })
  const entry = await audit(req, {
    module: 'Attendance',
    action: 'Attendance correction',
    record: parsed.data.date + ' · ' + parsed.data.field,
    oldValue: original,
    newValue: parsed.data.updated + ' · ' + parsed.data.reason,
    branch: saved.branch
  })
  const target = await prisma.user.findUnique({ where: { id: targetId } })
  res.json({
    attendance: attendanceClient({ ...saved, user: { employeeId: target?.employeeId || null, name: target?.name || req.user!.name } }),
    correction: attendanceCorrectionClient(entry)
  })
})

const breakReviewSchema = z.object({
  attendanceId: z.string().trim().min(1),
  minutes: z.number().int().min(0).max(60),
  reason: z.string().trim().min(1).max(500)
})

opsRouter.post('/attendance/break-review', requirePage('attendance'), async (req, res) => {
  if (!PEOPLE_ADMINS.includes(req.user!.role as typeof PEOPLE_ADMINS[number])) return deny(res, 'This role cannot access this module')
  const parsed = breakReviewSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, 'Enter break minutes between 0 and 60 and a reason.', 400)
  const row = await prisma.attendance.findUnique({ where: { id: parsed.data.attendanceId }, include: { user: { select: { employeeId: true, name: true } } } })
  if (!row) return deny(res, 'Attendance record not found.', 404)
  if (!req.user!.allBranches && row.branch !== req.user!.branchName) return deny(res, 'This is not your branch.')
  const configured = process.env.TEMPORARY_BRANCH_ENABLED === 'true' ? await prisma.branchSchedule.findFirst({where:{branchName:row.branch,effectiveFrom:{lte:row.date}},orderBy:{effectiveFrom:'desc'}}) : null
  if ((!['Muñoz', 'Palayan'].includes(row.branch) || row.date < '2026-11-05') && !configured && !(process.env.TEMPORARY_BRANCH_ENABLED === 'true' && row.roleAtMorning)) return deny(res, 'This attendance record does not use the break-review policy.', 400)
  const start = toMins(row.clockIn), end = toMins(row.clockOut)
  if (start == null || end == null || end <= start || parsed.data.minutes > end - start) return deny(res, 'Time In and Time Out must be valid and the break cannot exceed the recorded time.', 400)
  if (row.date >= '2026-11-11' && parsed.data.minutes > Math.max(0, Math.min(end, 13 * 60) - Math.max(start, 12 * 60))) return deny(res, 'Break cannot exceed the recorded overlap with 12:00–1:00 PM.', 400)
  const now = new Date(), user = req.user!
  const saved = await prisma.$transaction(async tx => {
    const changed = await tx.attendance.update({ where: { id: row.id }, data: { reviewedBreakMinutes: parsed.data.minutes, breakReviewedAt: now, breakReviewedBy: user.id } })
    await tx.auditLog.create({ data: {
      userId: user.id, userName: user.name + ' (' + user.role + ')', module: 'Attendance', action: 'Meal break reviewed',
      record: row.id + ' · ' + row.date, oldValue: row.reviewedBreakMinutes == null ? 'Not reviewed' : String(row.reviewedBreakMinutes) + ' min',
      newValue: parsed.data.minutes + ' min · ' + parsed.data.reason, branch: row.branch,
      time: clinicDate() + ' · ' + now.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }), device: req.userAgent
    } })
    return changed
  })
  res.json(attendanceClient({ ...saved, user: row.user }))
})

const payrollInputSchema = z.object({
  employeeId: z.string().trim().min(1),
  periodId: z.string().trim().min(1),
  days: z.coerce.number().min(0),
  late: z.coerce.number().min(0),
  undertime: z.coerce.number().min(0),
  night: z.coerce.number().min(0),
  ot: z.coerce.number().min(0).optional().default(0),
  otApproved: z.boolean().optional().default(false),
  holiday: z.coerce.number().min(0).optional().default(0),
  holidayRegular: z.coerce.number().min(0).optional(),
  holidaySpecial: z.coerce.number().min(0).optional().default(0),
  holidayType: z.enum(['Regular', 'Special']).optional().default('Regular'),
  obCount: z.coerce.number().int().min(0).max(100).optional(),
  other: z.coerce.number().min(0).optional().default(0),
  reason: z.string().trim().min(1)
})

opsRouter.post('/payroll/inputs', requirePage('payroll'), async (req, res) => {
  if (!PEOPLE_ADMINS.includes(req.user!.role as typeof PEOPLE_ADMINS[number])) return deny(res, 'This role cannot access this module')
  const parsed = payrollInputSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'Reason is required to update payroll', 400)
  const { holidayRegular, holidaySpecial, ...form } = parsed.data
  const emp = await prisma.employee.findUnique({ where: { id: form.employeeId }, include: { payrollEligibilityHistory: true } })
  if (!emp) return deny(res, 'Employee not found', 400)
  if (!payrollEligibleForPeriod(emp, form.periodId)) return deny(res, 'Employee is not payroll eligible for this cutoff.', 409)
  if (!req.user!.allBranches && emp.branch !== req.user!.branchName) return deny(res, 'This is not your branch')
  const regular = holidayRegular ?? form.holiday
  const special = Number(holidaySpecial) || 0
  const by = req.user!.name + ' (' + req.user!.role + ')'
  const where = { employeeId_periodId: { employeeId: form.employeeId, periodId: form.periodId } }
  const previous = await prisma.payrollInput.findUnique({ where })
  const base = {
    employeeId: form.employeeId,
    periodId: form.periodId,
    days: form.days,
    late: form.late,
    undertime: form.undertime,
    night: form.night,
    ot: form.ot,
    otApproved: form.otApproved,
    holiday: regular,
    obCount: form.obCount ?? previous?.obCount ?? 0,
    obHomeBranch: previous?.obHomeBranch || ((form.obCount ?? 0) > 0 ? emp.branch : ''),
    other: form.other,
    reason: form.reason,
    by
  }
  const saved = await prisma.payrollInput.upsert({
    where,
    create: { ...base, holidaySpecial: special, holidayType: 'Regular' },
    update: { ...base, holidaySpecial: special, holidayType: 'Regular' }
  })
  await audit(req, { module: 'Payroll', action: 'Payroll input updated from Time In', record: emp.name + ' · ' + form.periodId, branch: emp.branch, oldValue: 'OB count: ' + (previous?.obCount ?? 0), newValue: 'OB count: ' + saved.obCount + ' · OB branch: ' + (saved.obHomeBranch || '—') + ' · Reason: ' + form.reason })
  res.json(payrollInputClient(saved))
})

opsRouter.delete('/payroll/inputs/:employeeId/:periodId', requirePage('payroll'), async (req, res) => {
  if (!PEOPLE_ADMINS.includes(req.user!.role as typeof PEOPLE_ADMINS[number])) return deny(res, 'This role cannot access this module')
  const employeeId = String(req.params.employeeId)
  const periodId = String(req.params.periodId)
  const existing = await prisma.payrollInput.findUnique({ where: { employeeId_periodId: { employeeId, periodId } } })
  if (!existing) return deny(res, 'No payroll update to reset', 404)
  await prisma.payrollInput.delete({ where: { id: existing.id } })
  await audit(req, { module: 'Payroll', action: 'Payroll reset to Time In', record: employeeId + ' · ' + periodId, branch: req.user!.branchName || 'Guimba' })
  res.json({ ok: true, employeeId, periodId })
})

const amountOrNull = z.preprocess(v => {
  if (v === '' || v === undefined || v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : v
}, z.number().min(0).nullable())
const contributionOverrideSchema = z.object({
  employeeId: z.string().trim().min(1),
  fromPeriod: z.string().trim().regex(/^\d{4}-\d{2}-[AB]$/),
  sss: amountOrNull,
  phil: amountOrNull,
  pagibig: amountOrNull,
  reason: z.string().trim().min(1)
})

opsRouter.post('/payroll/overrides', requirePage('payroll'), async (req, res) => {
  if (!PEOPLE_ADMINS.includes(req.user!.role as typeof PEOPLE_ADMINS[number])) return deny(res, 'This role cannot access this module')
  const parsed = contributionOverrideSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'Reason is required for a contribution override', 400)
  const form = parsed.data
  const emp = await prisma.employee.findUnique({ where: { id: form.employeeId } })
  if (!emp) return deny(res, 'Employee not found', 400)
  if (!req.user!.allBranches && emp.branch !== req.user!.branchName) return deny(res, 'This is not your branch')
  const blank = (v: number | '' | null | undefined) => v === '' || v === undefined || v === null ? null : v
  const saved = await prisma.contributionOverride.create({
    data: {
      employeeId: form.employeeId,
      fromPeriod: form.fromPeriod,
      sss: blank(form.sss),
      phil: blank(form.phil),
      pagibig: blank(form.pagibig),
      reason: form.reason,
      by: req.user!.name + ' (' + req.user!.role + ')'
    }
  })
  await audit(req, {
    module: 'Payroll',
    action: 'Contribution override saved',
    record: emp.name + ' · ' + form.fromPeriod,
    branch: emp.branch,
    newValue: form.reason
  })
  res.json(contributionOverrideClient(saved))
})

