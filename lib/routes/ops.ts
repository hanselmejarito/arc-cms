import { ApiRouter } from '../router.js'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { audit } from '../audit.js'
import { canAccessBranch, hashPassword, requireAny, requireAuth, requirePage, type AuthedUser } from '../auth.js'
import { ALL_BRANCH_ROLES, canPage, clinicDate, refundEligible, refundRemaining } from '../clinical.js'
import { nextId } from '../ids.js'
import { catchUpBranch, closeShiftOnce } from '../shiftClose.js'
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
const clock = () => new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false })
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
function shiftEndMins(role: string, shift: string) {
  if (shift === 'Night Shift' || shift === 'NS') return 23 * 60
  if (role === 'PhilHealth Officer') return 17 * 60
  return 16 * 60
}
function overtimeRoom(role: string, shift: string, clockOut: string) {
  const out = toMins(clockOut)
  const end = shiftEndMins(role, shift)
  if (out == null || out <= end) return 0
  return Math.round((out - end) / 60 * 100) / 100
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
    canInv ? prisma.inventoryLine.findMany() : Promise.resolve([]),
    canInv ? prisma.ledgerRow.findMany({ orderBy: { date: 'asc' } }) : Promise.resolve([]),
    canInv ? prisma.receivedRow.findMany({ orderBy: { date: 'asc' } }) : Promise.resolve([]),
    canInv ? prisma.movement.findMany({ orderBy: [{ date: 'desc' }, { id: 'desc' }] }) : Promise.resolve([]),
    canFin || canPay ? prisma.financeEntry.findMany({ orderBy: { date: 'desc' } }) : Promise.resolve([]),
    canRef || canPay ? prisma.refund.findMany({ orderBy: { requested: 'desc' } }) : Promise.resolve([]),
    canEmp ? prisma.employee.findMany({ orderBy: { id: 'asc' }, include: { users: { select: { email: true } } } }) : Promise.resolve([]),
    prisma.attendance.findMany({
      where: payrollAdmin ? (user.allBranches ? {} : { branch: user.branchName || '' }) : { userId: user.id },
      include: { user: { select: { employeeId: true, name: true } } },
      orderBy: { date: 'desc' }
    }),
    canUsers || payrollAdmin ? prisma.user.findMany({ orderBy: { name: 'asc' } }) : Promise.resolve([]),
    canPage(user.role, 'payroll') || canPage(user.role, 'payslips')
      ? prisma.payrollInput.findMany()
      : Promise.resolve([]),
    seeContrib ? prisma.contributionOverride.findMany({ orderBy: { createdAt: 'desc' } }) : Promise.resolve([]),
    payrollAdmin
      ? prisma.auditLog.findMany({
        where: { action: 'Attendance correction', ...(user.allBranches ? {} : { branch: user.branchName || '' }) },
        orderBy: { createdAt: 'desc' },
        take: 200
      })
      : Promise.resolve([]),
    seeOt ? prisma.overtimeRequest.findMany({ orderBy: { date: 'desc' } }) : Promise.resolve([])
  ])
  if (canInv) {
    const names = user.allBranches
      ? (await prisma.branch.findMany({ select: { name: true } })).map(b => b.name)
      : (user.branchName ? [user.branchName] : [])
    for (const name of names) await prisma.$transaction(tx => catchUpBranch(tx, name))
  }
  const inBranch = (b: string) => user.allBranches || b === user.branchName
  return {
    branches: branches.map(branchClient),
    inventory: inventory.filter(x => inBranch(x.branch)).map(inventoryClient),
    ledger: ledger.filter(x => inBranch(x.branch)).map(ledgerClient),
    received: received.filter(x => inBranch(x.branch)).map(receivedClient),
    movements: movements.filter(x => inBranch(x.branch)).map(movementClient).sort(byWhen),
    finance: finance.filter(x => inBranch(x.branch)).map(financeClient),
    refunds: refunds.filter(x => inBranch(x.branch)).map(refundClient),
    employees: employees.filter(e => inBranch(e.branch)).map(employeeClient),
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
  const branchRow = await prisma.branch.findUnique({ where: { name: form.branch } })
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
  const branchRow = await prisma.branch.findUnique({ where: { name: form.branch } })
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
  const branchRow = await prisma.branch.findUnique({ where: { name: form.branch } })
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
    const movements = []
    let received = null
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
  if (!branchRow.night) return deny(res, branch + ' stays on the morning shift. There is no night shift to close.', 400)
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
  const result = await prisma.$transaction(tx => closeShiftOnce(tx, branchRow, ls, signature))
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


const employeeSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().min(1),
  password: z.string().min(8),
  branch: z.string().min(1),
  position: z.string().trim().min(1).optional().default('Clinic Staff'),
  role: z.enum(STAFF_ROLES),
  rate: z.coerce.number().positive(),
  hours: z.coerce.number().positive().optional().default(8),
  shift: z.enum(['Morning Shift', 'Night Shift']).optional().default('Morning Shift'),
  status: z.enum(['Active', 'Inactive']).optional().default('Active'),
  officer: z.boolean().optional().default(false),
  payroll: z.boolean().optional().default(true),
  benefits: z.boolean().optional().default(true)
})

opsRouter.post('/employees', requirePage('employees'), async (req, res) => {
  const parsed = employeeSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'Name, email, and password are required', 400)
  const form = parsed.data
  if (!req.user!.allBranches && form.branch !== req.user!.branchName) return deny(res, 'This is not your branch')
  const branchRow = await assertBranch(form.branch)
  if (form.shift === 'Night Shift' && !branchRow.night) {
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
  let emp = null
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
  const existing = await prisma.employee.findUnique({
    where: { id: req.params.id },
    include: { users: true }
  })
  if (!existing) return deny(res, 'Employee not found', 404)
  const parsed = employeePatchSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'Invalid employee update', 400)
  const form = parsed.data
  if (!req.user!.allBranches && form.branch !== req.user!.branchName) return deny(res, 'This is not your branch')
  const branchRow = await assertBranch(form.branch)
  if (form.shift === 'Night Shift' && !branchRow.night) {
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
    const emp = await tx.employee.update({
      where: { id: existing.id },
      data: {
        name: form.name,
        branch: form.branch,
        position: form.position,
        role: form.role,
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
    return tx.employee.findUniqueOrThrow({ where: { id: emp.id }, include: { users: true } })
  })
  const before = {
    Name: existing.name,
    Email: primary?.email || '',
    Branch: existing.branch,
    Position: existing.position,
    Role: existing.role,
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
    Email: email,
    Branch: form.branch,
    Position: form.position,
    Role: form.role,
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
  let emp = null
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
  night: z.boolean().optional()
})

opsRouter.patch('/branches/:name', requirePage('branches'), async (req, res) => {
  const existing = await prisma.branch.findUnique({ where: { name: req.params.name } })
  if (!existing) return deny(res, 'Unknown branch', 404)
  const parsed = branchSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, 'Invalid branch update', 400)
  const updated = await prisma.branch.update({
    where: { name: existing.name },
    data: parsed.data
  })
  await audit(req, { module: 'Admin', action: 'Branch configuration updated', record: updated.name, branch: updated.name })
  res.json(branchClient(updated))
})

opsRouter.post('/attendance/in', requirePage('attendance'), async (req, res) => {
  const user = req.user!
  if (NO_CLOCK_ROLES.includes(user.role)) return deny(res, 'Superadmin does not Time In')
  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: user.id, date: clinicDate() } } })
  if (existing?.clockIn) return deny(res, 'Time In already recorded', 409)
  const duty = user.employeeId ? (await prisma.employee.findUnique({ where: { id: user.employeeId } }))?.branch : null
  const where = String(req.body.branch || duty || user.branchName || 'Guimba')
  if (!user.allBranches && where !== user.branchName) return deny(res, 'This is not your branch')
  await assertBranch(where)
  const at = clock()
  const row = existing
    ? await prisma.attendance.update({ where: { id: existing.id }, data: { clockIn: at, branch: where, source: 'Time In button', device: 'Branch workstation' } })
    : await prisma.attendance.create({
      data: {
        id: await nextId(prisma.attendance, 'ATT-', 4),
        userId: user.id,
        date: clinicDate(),
        clockIn: at,
        clockOut: '',
        source: 'Time In button',
        branch: where,
        device: 'Branch workstation'
      }
    })
  await audit(req, { module: 'Attendance', action: 'Time In recorded at ' + at + ' · ' + where, record: user.name, branch: where })
  res.json(attendanceClient({ ...row, user: { employeeId: user.employeeId, name: user.name } }))
})

opsRouter.post('/attendance/out', requirePage('attendance'), async (req, res) => {
  const user = req.user!
  if (NO_CLOCK_ROLES.includes(user.role)) return deny(res, 'Superadmin does not Time Out')
  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: user.id, date: clinicDate() } } })
  if (!existing?.clockIn) return deny(res, 'Time In first', 409)
  if (existing.clockOut) return deny(res, 'Time Out already recorded', 409)
  const at = clock()
  const row = await prisma.attendance.update({ where: { id: existing.id }, data: { clockOut: at } })
  await audit(req, { module: 'Attendance', action: 'Time Out recorded at ' + at, record: user.name, branch: existing.branch })
  res.json(attendanceClient({ ...row, user: { employeeId: user.employeeId, name: user.name } }))
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
  const room = overtimeRoom(emp.role, emp.shift, attendance.clockOut)
  if (room <= 0) return deny(res, 'Time Out is still inside the shift. Overtime starts after the shift ends.', 400)
  const hours = Math.round(parsed.data.hours * 100) / 100
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
  field: z.enum(['Time In', 'Time Out']),
  updated: z.string().min(1),
  reason: z.string().trim().min(1),
  userId: z.string().optional()
})

opsRouter.post('/attendance/correct', requireAny('attendance'), async (req, res) => {
  if (!PEOPLE_ADMINS.includes(req.user!.role as typeof PEOPLE_ADMINS[number])) return deny(res, 'This role cannot access this module')
  const parsed = correctSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, 'Updated value and reason are required', 400)
  const targetId = parsed.data.userId || req.user!.id
  const k = parsed.data.field === 'Time In' ? 'clockIn' : 'clockOut'
  const row = await prisma.attendance.findUnique({ where: { userId_date: { userId: targetId, date: parsed.data.date } } })
  const original = row ? row[k] || '—' : '—'
  const saved = row
    ? await prisma.attendance.update({ where: { id: row.id }, data: { [k]: parsed.data.updated, corrected: true } })
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
  other: z.coerce.number().min(0).optional().default(0),
  reason: z.string().trim().min(1)
})

opsRouter.post('/payroll/inputs', requirePage('payroll'), async (req, res) => {
  if (!PEOPLE_ADMINS.includes(req.user!.role as typeof PEOPLE_ADMINS[number])) return deny(res, 'This role cannot access this module')
  const parsed = payrollInputSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'Reason is required to update payroll', 400)
  const { holidayRegular, holidaySpecial, ...form } = parsed.data
  const emp = await prisma.employee.findUnique({ where: { id: form.employeeId } })
  if (!emp) return deny(res, 'Employee not found', 400)
  if (!req.user!.allBranches && emp.branch !== req.user!.branchName) return deny(res, 'This is not your branch')
  const regular = holidayRegular ?? form.holiday
  const special = Number(holidaySpecial) || 0
  const by = req.user!.name + ' (' + req.user!.role + ')'
  const where = { employeeId_periodId: { employeeId: form.employeeId, periodId: form.periodId } }
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
    other: form.other,
    reason: form.reason,
    by
  }
  let saved
  try {
    saved = await prisma.payrollInput.upsert({
      where,
      create: { ...base, holidaySpecial: special, holidayType: 'Regular' },
      update: { ...base, holidaySpecial: special, holidayType: 'Regular' }
    })
  } catch (err) {
    if (!String((err as Error)?.message || err).includes('holidaySpecial')) throw err
    saved = await prisma.payrollInput.upsert({
      where,
      create: { ...base, holidayType: String(special) },
      update: { ...base, holidayType: String(special) }
    })
  }
  await audit(req, { module: 'Payroll', action: 'Payroll input updated from Time In', record: emp.name + ' · ' + form.periodId, branch: emp.branch, oldValue: 'Auto from Time In', newValue: form.reason })
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

