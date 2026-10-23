import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { audit } from '../audit.js'
import { canAccessBranch, hashPassword, requireAny, requireAuth, requirePage, type AuthedUser } from '../auth.js'
import { ALL_BRANCH_ROLES, addDays, canPage, clinicDate } from '../clinical.js'
import { nextId } from '../ids.js'
import { ADJUST_REASONS, ITEM_NAMES, itemMeta } from '../inventory.js'
import {
  attendanceClient, branchClient, employeeClient, financeClient, inventoryClient, payrollInputClient,
  ledgerClient, movementClient, receivedClient, refundClient, userClient
} from '../map.js'

export const opsRouter = Router()
opsRouter.use(requireAuth)

const ROLES = ['Admin', 'Nurse / Staff', 'PO / PhilHealth Officer', 'Secretary'] as const
const NO_CLOCK_ROLES = ['Admin']
const STAFF_ROLES = ['Nurse / Staff', 'PO / PhilHealth Officer', 'Secretary'] as const
const FINANCE_CATS: Record<string, string[]> = {
  Income: ['Other income', 'PhilHealth reimbursement', 'Miscellaneous income'],
  Expense: ['Utilities', 'Rent', 'Medical supplies', 'Transportation', 'Repairs & maintenance', 'Office supplies', 'Miscellaneous']
}
const REFUND_APPROVERS = ['Admin', 'PO / PhilHealth Officer']
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const nowTime = () => new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
const clock = () => new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: false })

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
  const payrollAdmin = user.role === 'Admin'
  const [branches, inventory, ledger, received, movements, finance, refunds, employees, attendance, users, payrollInputs] = await Promise.all([
    prisma.branch.findMany({ orderBy: { name: 'asc' } }),
    canInv ? prisma.inventoryLine.findMany() : Promise.resolve([]),
    canInv ? prisma.ledgerRow.findMany({ orderBy: { date: 'asc' } }) : Promise.resolve([]),
    canInv ? prisma.receivedRow.findMany({ orderBy: { date: 'asc' } }) : Promise.resolve([]),
    canInv ? prisma.movement.findMany({ orderBy: { date: 'desc' } }) : Promise.resolve([]),
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
      : Promise.resolve([])
  ])
  const inBranch = (b: string) => user.allBranches || b === user.branchName
  return {
    branches: branches.map(branchClient),
    inventory: inventory.filter(x => inBranch(x.branch)).map(inventoryClient),
    ledger: ledger.filter(x => inBranch(x.branch)).map(ledgerClient),
    received: received.filter(x => inBranch(x.branch)).map(receivedClient),
    movements: movements.filter(x => inBranch(x.branch)).map(movementClient),
    finance: finance.filter(x => inBranch(x.branch)).map(financeClient),
    refunds: refunds.filter(x => inBranch(x.branch)).map(refundClient),
    employees: employees.filter(e => inBranch(e.branch)).map(employeeClient),
    attendance: attendance.map(attendanceClient),
    users: users.map(userClient),
    payrollInputs: payrollInputs.map(payrollInputClient)
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
  if (!scopeBranch(req.user!, form.branch)) return deny(res, 'Hindi ito ang branch mo')
  const meta = itemMeta(form.item)
  if (!meta) return deny(res, 'Unknown item', 400)
  const qty = form.quantity
  const result = await prisma.$transaction(async tx => {
    const existing = await tx.inventoryLine.findMany({ where: { item: form.item, branch: form.branch } })
    const before = existing.reduce((a, x) => a + x.stock, 0)
    const line = existing.find(x => x.batch === form.batch)
    let saved
    if (line) {
      saved = await tx.inventoryLine.update({
        where: { id: line.id },
        data: { received: line.received + qty, stock: line.stock + qty, expiry: form.expiry }
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
  if (!scopeBranch(req.user!, form.branch)) return deny(res, 'Hindi ito ang branch mo')
  const existing = await prisma.inventoryLine.findMany({ where: { item: form.item, branch: form.branch } })
  const fifo = existing.filter(x => x.stock > 0 && x.expiry >= clinicDate()).sort((a, b) => a.expiry.localeCompare(b.expiry))
  const line = existing.find(x => x.id === form.line) || fifo[0] || existing[0]
  if (!line) return deny(res, 'No stock line for this item at ' + form.branch, 400)
  if (form.quantity > line.stock) return deny(res, 'Insufficient stock on hand (' + line.stock + ')', 409)
  const result = await prisma.$transaction(async tx => {
    const saved = await tx.inventoryLine.update({
      where: { id: line.id },
      data: { stock: line.stock - form.quantity, used: line.used + form.quantity }
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
  if (!scopeBranch(req.user!, form.branch)) return deny(res, 'Hindi ito ang branch mo')
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
    const source = await tx.inventoryLine.update({
      where: { id: line.id },
      data: { stock: line.stock + (decrease ? -form.quantity : form.quantity) }
    })
    const lines = [source]
    const movements = []
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
      const destRows = await tx.inventoryLine.findMany({ where: { item: line.item, branch: form.to, batch: line.batch } })
      const dest = destRows[0]
      let destLine
      if (dest) {
        destLine = await tx.inventoryLine.update({
          where: { id: dest.id },
          data: { stock: dest.stock + form.quantity, received: dest.received + form.quantity }
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
            date: form.date,
            shift: form.shift,
            unit: line.unit,
            threshold: line.threshold
          }
        })
      }
      lines.push(destLine)
      const destOpen = await tx.inventoryLine.findFirst({ where: { branch: form.to } })
      movements.push(await tx.movement.create({
        data: {
          id: await nextId(tx.movement, 'MOV-', 4),
          date: form.date,
          time: nowTime(),
          by: req.user!.name,
          shift: destOpen?.shift || 'MS',
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
    return { lines, movements }
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
    movements: result.movements.map(movementClient)
  })
})

opsRouter.post('/inventory/close-shift', requireAny(...invPages), async (req, res) => {
  const branch = String(req.body.branch || '')
  if (!branch) return deny(res, 'Branch is required', 400)
  if (!scopeBranch(req.user!, branch)) return deny(res, 'Hindi ito ang branch mo')
  const branchRow = await prisma.branch.findUnique({ where: { name: branch } })
  if (!branchRow) return deny(res, 'Unknown branch', 400)
  const ls = await prisma.inventoryLine.findMany({ where: { branch } })
  if (!ls.length) return deny(res, 'No stock lines at ' + branch, 400)
  const closing = ls[0].shift || 'MS'
  const toNight = closing === 'MS' && branchRow.night
  const signature = String(req.body.signature || req.user!.name)
  const result = await prisma.$transaction(async tx => {
    const movements = await tx.movement.findMany({ where: { branch } })
    const ledger = []
    const inventory = []
    for (const x of ls) {
      ledger.push(await tx.ledgerRow.create({
        data: {
          id: await nextId(tx.ledgerRow, 'LED-', 4),
          stockId: x.id,
          item: x.item,
          branch,
          date: x.date,
          shift: x.shift,
          begin: x.begin,
          received: x.received,
          batch: x.received ? x.batch : '',
          used: x.used,
          stock: x.stock,
          remarks: movements.filter(m => m.item === x.item && m.date === x.date && m.ref.startsWith('less')).map(m => m.ref).join(', '),
          signature
        }
      }))
      const nextNight = x.shift === 'MS' && branchRow.night
      inventory.push(await tx.inventoryLine.update({
        where: { id: x.id },
        data: {
          begin: x.stock,
          received: 0,
          used: 0,
          shift: nextNight ? 'NS' : 'MS',
          date: nextNight ? x.date : addDays(x.date, 1)
        }
      }))
    }
    return { ledger, inventory, closing, toNight }
  })
  const msg = closing === 'MS'
    ? (toNight
      ? branch + ' morning shift closed at 4:00 PM cutoff · Night Shift now open (4:00 PM – 11:00 PM)'
      : branch + ' morning shift closed at 4:00 PM cutoff · next 7:00 AM – 4:00 PM')
    : branch + ' night shift closed at 11:00 PM · next 7:00 AM – 4:00 PM'
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
  if (!scopeBranch(req.user!, form.branch)) return deny(res, 'Hindi ito ang branch mo')
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
  if (!scopeBranch(req.user!, pay.branch)) return deny(res, 'Hindi ito ang branch mo')
  if (parsed.data.amount > pay.amount) return deny(res, 'Refund cannot exceed the original payment', 400)
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
  payroll: z.boolean().optional().default(true)
})

opsRouter.post('/employees', requirePage('employees'), async (req, res) => {
  const parsed = employeeSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'Name, email, and password are required', 400)
  const form = parsed.data
  if (!req.user!.allBranches && form.branch !== req.user!.branchName) return deny(res, 'Hindi ito ang branch mo')
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
  const isAdmin = form.role === 'Admin'
  if (!isAdmin && !form.employee) return deny(res, 'Linked employee is required', 400)
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
      branchName,
      employeeId: emp?.id || null,
      status: 'Active'
    }
  })
  await audit(req, { module: 'Users', action: 'User account created', record: created.email, branch: branchName || req.user!.branchName || 'Guimba' })
  res.json(userClient(created))
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
  if (NO_CLOCK_ROLES.includes(user.role)) return deny(res, 'Admin does not Time In')
  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: user.id, date: clinicDate() } } })
  if (existing?.clockIn) return deny(res, 'Time In already recorded', 409)
  const where = String(req.body.branch || (user.allBranches ? 'Guimba' : user.branchName) || 'Guimba')
  if (!user.allBranches && where !== user.branchName) return deny(res, 'Hindi ito ang branch mo')
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
  if (NO_CLOCK_ROLES.includes(user.role)) return deny(res, 'Admin does not Time Out')
  const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: user.id, date: clinicDate() } } })
  if (!existing?.clockIn) return deny(res, 'Time In first', 409)
  if (existing.clockOut) return deny(res, 'Time Out already recorded', 409)
  const at = clock()
  const row = await prisma.attendance.update({ where: { id: existing.id }, data: { clockOut: at } })
  await audit(req, { module: 'Attendance', action: 'Time Out recorded at ' + at, record: user.name, branch: existing.branch })
  res.json(attendanceClient({ ...row, user: { employeeId: user.employeeId, name: user.name } }))
})

const correctSchema = z.object({
  date: dateStr,
  field: z.enum(['Time In', 'Time Out']),
  updated: z.string().min(1),
  reason: z.string().trim().min(1),
  userId: z.string().optional()
})

opsRouter.post('/attendance/correct', requireAny('attendance'), async (req, res) => {
  if (req.user!.role !== 'Admin') return deny(res, 'Walang access ang role na ito sa module na ito')
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
  await audit(req, {
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
    correction: {
      id: Date.now(),
      date: parsed.data.date,
      field: parsed.data.field,
      original,
      updated: parsed.data.updated,
      reason: parsed.data.reason,
      by: req.user!.name + ' (' + req.user!.role + ')',
      timestamp: new Date().toLocaleString('en-PH')
    }
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
  holidayType: z.enum(['Regular', 'Special']).optional().default('Regular'),
  other: z.coerce.number().min(0).optional().default(0),
  reason: z.string().trim().min(1)
})

opsRouter.post('/payroll/inputs', requirePage('payroll'), async (req, res) => {
  if (req.user!.role !== 'Admin') return deny(res, 'Walang access ang role na ito sa module na ito')
  const parsed = payrollInputSchema.safeParse(req.body)
  if (!parsed.success) return deny(res, parsed.error.issues[0]?.message || 'Reason is required to update payroll', 400)
  const form = parsed.data
  const emp = await prisma.employee.findUnique({ where: { id: form.employeeId } })
  if (!emp) return deny(res, 'Employee not found', 400)
  if (!req.user!.allBranches && emp.branch !== req.user!.branchName) return deny(res, 'Hindi ito ang branch mo')
  const saved = await prisma.payrollInput.upsert({
    where: { employeeId_periodId: { employeeId: form.employeeId, periodId: form.periodId } },
    create: { ...form, by: req.user!.name + ' (' + req.user!.role + ')' },
    update: { ...form, by: req.user!.name + ' (' + req.user!.role + ')' }
  })
  await audit(req, { module: 'Payroll', action: 'Payroll input updated from Time In', record: emp.name + ' · ' + form.periodId, branch: emp.branch, oldValue: 'Auto from Time In', newValue: form.reason })
  res.json(payrollInputClient(saved))
})

opsRouter.delete('/payroll/inputs/:employeeId/:periodId', requirePage('payroll'), async (req, res) => {
  if (req.user!.role !== 'Admin') return deny(res, 'Walang access ang role na ito sa module na ito')
  const employeeId = String(req.params.employeeId)
  const periodId = String(req.params.periodId)
  const existing = await prisma.payrollInput.findUnique({ where: { employeeId_periodId: { employeeId, periodId } } })
  if (!existing) return deny(res, 'No payroll update to reset', 404)
  await prisma.payrollInput.delete({ where: { id: existing.id } })
  await audit(req, { module: 'Payroll', action: 'Payroll reset to Time In', record: employeeId + ' · ' + periodId, branch: req.user!.branchName || 'Guimba' })
  res.json({ ok: true, employeeId, periodId })
})

