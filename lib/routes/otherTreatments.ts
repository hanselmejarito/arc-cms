import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiRouter } from '../router.js'
import { requireAuth, requirePage, canAccessBranch } from '../auth.js'
import { prisma } from '../prisma.js'
import { BRANCH_CODES, canPage, clinicDate } from '../clinical.js'
import { otherTreatmentReference, OTHER_TREATMENTS } from '../otherTreatment.js'
import { catchUpBranch } from '../shiftClose.js'
import { inventoryClient, movementClient } from '../map.js'

export const otherTreatmentsRouter = new ApiRouter()
otherTreatmentsRouter.use(requireAuth)
const serviceEnum = z.enum(OTHER_TREATMENTS)
const createSchema = z.object({ patientId: z.string().min(1), branch: z.string().min(1), service: serviceEnum })
const givenSchema = z.object({
  stockLineId: z.string().min(1), stockQuantity: z.number().int().min(1).max(1000),
  brand: z.string().trim().min(1).max(100),
  administeredQuantity: z.number().positive().max(100000).refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001, 'Use at most three decimal places.').optional(),
  administeredUnit: z.string().trim().max(30).optional().default(''),
  administeredBy: z.string().trim().min(1).max(150),
  remarks: z.string().trim().max(1000).optional().default('')
}).refine(x => (x.administeredQuantity == null) === !x.administeredUnit, 'Enter both administered quantity and unit.')
const paymentSchema = z.object({
  amountCentavos: z.number().int().min(1).max(100000000),
  method: z.enum(['Cash','GCash','Bank transfer']),
  externalReference: z.string().trim().max(120).optional().default('')
})
const cancelSchema = z.object({ reason: z.string().trim().min(1).max(500) })
const allowedItem: Record<string, string> = { ERIG: 'ERIG (serum)', TT: 'Tetanus Toxoid', Flu: 'Influvac', Pneumococcal: 'Pneumococcal', 'Hepatitis B': 'Hepatitis B' }
const now = () => new Date()
const stamp = () => new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })
function present(t: any, seePayment = true) {
  return { ...t, administeredQuantity: t.administeredQuantity == null ? null : Number(t.administeredQuantity),
    patient: t.patient ? { id: t.patient.id, name: t.patient.name } : undefined,
    payment: t.payment ? (seePayment ? { ...t.payment } : { paid: true }) : null }
}
const includes = { patient: { select: { id: true, name: true } }, payment: true } as const
async function safeAudit(tx: any, req: any, action: string, record: string, branch: string, detail = '') {
  const user = req.user, time = now()
  await tx.auditLog.create({ data: { userId: user.id, userName: user.name + ' (' + user.role + ')', module: 'Other treatment', action, record, branch, newValue: detail || 'Saved', time: clinicDate() + ' · ' + stamp(), device: req.userAgent } })
}

otherTreatmentsRouter.get('/other-treatments', requirePage('treatments'), async (req, res) => {
  const user = req.user!
  const rows = await prisma.otherTreatment.findMany({ where: { ...(user.allBranches ? {} : { branch: user.branchName || '' }), ...(req.query.patientId ? { patientId: String(req.query.patientId) } : {}) }, include: includes, orderBy: { createdAt: 'desc' } })
  return res.json(rows.map(row => present(row, canPage(user.role, 'payments'))))
})

otherTreatmentsRouter.get('/other-treatments/stock', requirePage('treatments'), async (req, res) => {
  const branch = String(req.query.branch || ''), service = String(req.query.service || '')
  if (!canAccessBranch(req.user!, branch)) return res.status(403).json({ error: 'This is not your branch.' })
  if (!allowedItem[service]) return res.status(400).json({ error: 'Select a valid treatment.' })
  const lines = await prisma.inventoryLine.findMany({
    where: { branch, item: allowedItem[service], unit: 'vials', stock: { gt: 0 }, expiry: { gte: clinicDate() } },
    select: { id: true, item: true, batch: true, expiry: true, stock: true, unit: true },
    orderBy: { expiry: 'asc' }
  })
  return res.json(lines)
})

otherTreatmentsRouter.post('/other-treatments', requirePage('treatments'), async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Select a patient, branch and treatment.' })
  const { patientId, branch, service } = parsed.data, user = req.user!
  if (!canAccessBranch(user, branch)) return res.status(403).json({ error: 'This is not your branch.' })
  const [patient, branchRow] = await Promise.all([prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } }), prisma.branch.findUnique({ where: { name: branch }, select: { name: true } })])
  if (!patient || !branchRow || !BRANCH_CODES[branch]) return res.status(400).json({ error: 'Select a valid patient and branch.' })
  const date = clinicDate(), year = Number(date.slice(0, 4))
  const result = await prisma.$transaction(async tx => {
    const counter = await tx.otherTreatmentCounter.upsert({ where: { branch_year: { branch, year } }, create: { branch, year, lastSeq: 1 }, update: { lastSeq: { increment: 1 } } })
    const reference = otherTreatmentReference(BRANCH_CODES[branch], year, counter.lastSeq)
    const row = await tx.otherTreatment.create({ data: { reference, patientId, branch, date, service, createdById: user.id }, include: includes })
    await safeAudit(tx, req, 'Other treatment created', reference, branch, service)
    return row
  })
  return res.json(present(result, canPage(req.user!.role, 'payments')))
})

otherTreatmentsRouter.post('/other-treatments/:id/give', requirePage('treatments'), async (req, res) => {
  const parsed = givenSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Complete the treatment details.' })
  const row = await prisma.otherTreatment.findUnique({ where: { id: req.params.id } })
  if (!row) return res.status(404).json({ error: 'Treatment not found.' })
  if (!canAccessBranch(req.user!, row.branch)) return res.status(403).json({ error: 'This is not your branch.' })
  if (row.status !== 'Pending') return res.status(409).json({ error: 'Only a pending treatment can be marked given.' })
  if (row.service !== 'ERIG' && parsed.data.stockQuantity !== 1) return res.status(400).json({ error: 'This service uses one vial per patient.' })
  try {
    const result = await prisma.$transaction(async tx => {
      await catchUpBranch(tx, row.branch)
      const line = await tx.inventoryLine.findUnique({ where: { id: parsed.data.stockLineId } })
      if (!line || line.branch !== row.branch || line.item !== allowedItem[row.service] || line.expiry < clinicDate() || line.unit !== 'vials')
        throw new Error('Select a usable vial batch for this treatment and branch.')
      const claimed = await tx.otherTreatment.updateMany({ where: { id: row.id, status: 'Pending' }, data: { status: 'Given', product: line.item, brand: parsed.data.brand, batch: line.batch, stockLineId: line.id, stockExpiry: line.expiry, stockQuantity: parsed.data.stockQuantity, stockUnit: line.unit, administeredQuantity: parsed.data.administeredQuantity, administeredUnit: parsed.data.administeredUnit, administeredBy: parsed.data.administeredBy, administeredAt: now(), remarks: parsed.data.remarks } })
      if (!claimed.count) throw new Error('Treatment has already been updated. Reload and try again.')
      const consumed = await tx.inventoryLine.updateMany({ where: { id: line.id, stock: { gte: parsed.data.stockQuantity }, expiry: { gte: clinicDate() } }, data: { stock: { decrement: parsed.data.stockQuantity }, used: { increment: parsed.data.stockQuantity } } })
      if (!consumed.count) throw new Error('Insufficient usable stock. Reload and try again.')
      const updatedLine = await tx.inventoryLine.findUniqueOrThrow({ where: { id: line.id } })
      const movement = await tx.movement.create({ data: { id: 'OTM-' + randomUUID(), date: clinicDate(), time: stamp(), by: req.user!.name, shift: updatedLine.shift, item: line.item, branch: line.branch, type: 'Stock Out · treatment', qty: -parsed.data.stockQuantity, batch: line.batch, ref: row.reference, reason: 'Other treatment administered' } })
      await safeAudit(tx, req, 'Other treatment given', row.reference, row.branch, line.item + ' · ' + parsed.data.stockQuantity + ' ' + line.unit)
      return { treatment: await tx.otherTreatment.findUniqueOrThrow({ where: { id: row.id }, include: includes }), line: updatedLine, movement }
    })
    return res.json({ treatment: present(result.treatment, canPage(req.user!.role, 'payments')), line: inventoryClient(result.line), movement: movementClient(result.movement) })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/^(Select a usable|Treatment has already|Insufficient usable)/.test(message)) return res.status(409).json({ error: message })
    throw err
  }
})

otherTreatmentsRouter.post('/other-treatments/:id/payment', requirePage('payments'), async (req, res) => {
  const parsed = paymentSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid amount and payment method.' })
  const row = await prisma.otherTreatment.findUnique({ where: { id: req.params.id }, include: includes })
  if (!row) return res.status(404).json({ error: 'Treatment not found.' })
  if (!canAccessBranch(req.user!, row.branch)) return res.status(403).json({ error: 'This is not your branch.' })
  if (row.status === 'Cancelled' || row.payment) return res.status(409).json({ error: 'This treatment is cancelled or already paid.' })
  const paymentDate = clinicDate()
  try {
    const result = await prisma.$transaction(async tx => {
      // Conditional claim serializes payment against cancellation and prevents duplicate payments.
      const claim = await tx.otherTreatment.updateMany({ where: { id: row.id, status: { not: 'Cancelled' }, payment: { is: null } }, data: { updatedAt: now() } })
      if (!claim.count) return null
      const pay = await tx.otherTreatmentPayment.create({ data: { id: 'OTP-' + randomUUID(), treatmentId: row.id, amountCentavos: parsed.data.amountCentavos, method: parsed.data.method, externalReference: parsed.data.externalReference, paymentDate, recordedById: req.user!.id } })
      await safeAudit(tx, req, 'Other treatment payment recorded', row.reference, row.branch, 'Payment recorded')
      return pay
    })
    if (!result) return res.status(409).json({ error: 'This treatment is cancelled or already paid.' })
    return res.json(present(await prisma.otherTreatment.findUniqueOrThrow({ where: { id: row.id }, include: includes })))
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'This treatment is already paid.' })
    throw err
  }
})

otherTreatmentsRouter.post('/other-treatments/:id/cancel', requirePage('treatments'), async (req, res) => {
  const parsed = cancelSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a reason for cancellation.' })
  const row = await prisma.otherTreatment.findUnique({ where: { id: req.params.id } })
  if (!row) return res.status(404).json({ error: 'Treatment not found.' })
  if (!canAccessBranch(req.user!, row.branch)) return res.status(403).json({ error: 'This is not your branch.' })
  const result = await prisma.$transaction(async tx => {
    const claim = await tx.otherTreatment.updateMany({ where: { id: row.id, status: 'Pending' }, data: { status: 'Cancelled', remarks: parsed.data.reason } })
    if (!claim.count) return null
    await safeAudit(tx, req, 'Other treatment cancelled', row.reference, row.branch, parsed.data.reason)
    return tx.otherTreatment.findUniqueOrThrow({ where: { id: row.id }, include: includes })
  })
  if (!result) return res.status(409).json({ error: 'Only a pending treatment can be cancelled.' })
  return res.json(present(result, canPage(req.user!.role, 'payments')))
})