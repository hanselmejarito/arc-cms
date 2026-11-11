import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Prisma, InventoryLine, Movement } from '@prisma/client'
import { ApiRouter } from '../router.js'
import { requireAuth, requirePage, canAccessBranch } from '../auth.js'
import { prisma } from '../prisma.js'
import { BRANCH_CODES, canPage, clinicDate } from '../clinical.js'
import { otherTreatmentReference, otherPendingClients, OTHER_TREATMENTS } from '../otherTreatment.js'
import { catchUpBranch } from '../shiftClose.js'
import { inventoryClient, movementClient } from '../map.js'

export const otherTreatmentsRouter = new ApiRouter()
otherTreatmentsRouter.use(requireAuth)
const serviceEnum = z.enum(OTHER_TREATMENTS)
const createSchema = z.object({ patientId: z.string().min(1), branch: z.string().min(1), service: serviceEnum })
const givenSchema = z.object({
  stockLineId: z.string().min(1), stockQuantity: z.number().int().min(1).max(1000),
  brand: z.string().trim().max(100).optional().default(''),
  administeredQuantity: z.number().positive().max(100000).refine(n => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001, 'Use at most three decimal places.').optional(),
  administeredUnit: z.string().trim().max(30).optional().default(''),
  administeredBy: z.string().trim().min(1).max(150),
  remarks: z.string().trim().max(1000).optional().default('')
}).refine(x => (x.administeredQuantity == null) === !x.administeredUnit, 'Enter both administered quantity and unit.')
const priceCorrectionSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  items: z.array(z.object({ id: z.string().min(1), expectedPriceCentavos: z.number().int().positive(), priceCentavos: z.number().int().positive().max(100000000) })).min(1).max(7)
}).refine(x => new Set(x.items.map(item => item.id)).size === x.items.length, 'Duplicate services are not allowed.')

const paymentSchema = z.object({
  amountCentavos: z.number().int().min(1).max(100000000),
  discountType: z.enum(['Senior','PWD']).optional(),
  method: z.enum(['Cash','GCash','Bank transfer']),
  externalReference: z.string().trim().max(120).optional().default(''),
  priceCorrection: priceCorrectionSchema.optional(),
  expectedPrices: z.array(z.object({ id: z.string().min(1), priceCentavos: z.number().int().positive() })).min(1).max(7).optional()
})
const cancelSchema = z.object({ reason: z.string().trim().min(1).max(500) })
const allowedItem: Record<string, string> = { ERIG: 'ERIG (serum)', TT: 'Tetanus Toxoid', Flu: 'Flu', 'Flu Regular': 'Flu', 'Flu Student': 'Flu', 'Flu Senior-PWD': 'Flu', Pneumococcal: 'Pneumococcal', 'Hepatitis B': 'Hepatitis B' }
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
  const visitPayments = new Map(rows.filter(r => r.visitId && r.payment).map(r => [r.visitId, r.payment]))
  return res.json(rows.map(row => present(row.visitId && !row.payment ? { ...row, payment: visitPayments.get(row.visitId) || null } : row, canPage(user.role, 'payments'))))
})

otherTreatmentsRouter.get('/other-treatments/stock', requirePage('treatments'), async (req, res) => {
  const branch = String(req.query.branch || ''), service = String(req.query.service || '')
  if (!canAccessBranch(req.user!, branch)) return res.status(403).json({ error: 'This is not your branch.' })
  if (!allowedItem[service]) return res.status(400).json({ error: 'Select a valid treatment.' })
  const lines = await prisma.inventoryLine.findMany({
    where: { branch, item: allowedItem[service], unit: 'vials', stock: { gt: 0 }, expiry: { gte: clinicDate() } },
    select: { id: true, item: true, batch: true, expiry: true, stock: true, unit: true },
    orderBy: [{ expiry: 'asc' }, { date: 'asc' }, { id: 'asc' }]
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

const visitSchema = z.object({
  requestId: z.string().uuid(), patientId: z.string().min(1), branch: z.string().min(1),
  items: z.array(z.object({ service: serviceEnum, stockLineId: z.string().min(1), stockQuantity: z.number().int().min(1).max(1000), brand: z.string().trim().max(100).optional().default(''), administeredBy: z.string().trim().min(1).max(150), remarks: z.string().trim().max(1000).default(''), priceCentavos: z.number().int().positive().max(100000000) })).min(1).max(7)
}).refine(x => new Set(x.items.map(i => i.service)).size === x.items.length, 'Select each service only once.')
  .refine(x => new Set(x.items.map(i => i.administeredBy)).size === 1, 'Use one administering staff member for the visit.')

otherTreatmentsRouter.post('/other-treatment-visits', requirePage('treatments'), async (req, res) => {
  const parsed = visitSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Complete all treatment details.' })
  const { requestId, patientId, branch, items } = parsed.data, user = req.user!
  if (!canAccessBranch(user, branch)) return res.status(403).json({ error: 'This is not your branch.' })
  if (items.some(x => ['Flu Regular','Flu Student','Flu Senior-PWD'].includes(x.service))) return res.status(400).json({ error: 'Select Flu and apply any Senior/PWD discount at payment.' })
  if (items.some(x => x.service !== 'ERIG' && x.stockQuantity !== 1)) return res.status(400).json({ error: 'Each non-ERIG service uses one vial per patient.' })
  const [patient, branchRow] = await Promise.all([prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } }), prisma.branch.findUnique({ where: { name: branch }, select: { name: true } })])
  if (!patient || !branchRow || !BRANCH_CODES[branch]) return res.status(400).json({ error: 'Select a valid patient and branch.' })
  const date = clinicDate(), year = Number(date.slice(0, 4))
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'other-visit:' + requestId}))`
      const existing = await tx.otherTreatment.findMany({ where: { visitId: requestId }, include: includes, orderBy: { reference: 'asc' } })
      if (existing.length) {
        if (existing.some(x => x.patientId !== patientId || x.branch !== branch || x.createdById !== user.id)) throw new Error('This request ID is already in use.')
        return { treatments: existing, lines: [], movements: [] }
      }
      await catchUpBranch(tx, branch)
      const treatments: Prisma.OtherTreatmentGetPayload<{ include: typeof includes }>[] = []
      const lines: InventoryLine[] = [], movements: Movement[] = []
      let visitReference = ''
      const administeredAt = now()
      for (const item of items) {
        const line = await tx.inventoryLine.findUnique({ where: { id: item.stockLineId } })
        if (!line || line.branch !== branch || line.item !== allowedItem[item.service] || line.expiry < date || line.unit !== 'vials') throw new Error('Select a usable vial batch for each service.')
        const consumed = await tx.inventoryLine.updateMany({ where: { id: line.id, stock: { gte: item.stockQuantity }, expiry: { gte: date } }, data: { stock: { decrement: item.stockQuantity }, used: { increment: item.stockQuantity } } })
        if (!consumed.count) throw new Error('Insufficient usable stock. No treatments were saved.')
        const counter = await tx.otherTreatmentCounter.upsert({ where: { branch_year: { branch, year } }, create: { branch, year, lastSeq: 1 }, update: { lastSeq: { increment: 1 } } })
        const reference = otherTreatmentReference(BRANCH_CODES[branch], year, counter.lastSeq)
        if (!visitReference) visitReference = reference
        const treatment = await tx.otherTreatment.create({ data: { reference, visitId: requestId, priceCentavos: item.priceCentavos, patientId, branch, date, service: item.service, status: 'Given', product: line.item, brand: item.brand, batch: line.batch, stockLineId: line.id, stockExpiry: line.expiry, stockQuantity: item.stockQuantity, stockUnit: line.unit, administeredBy: item.administeredBy, administeredAt, remarks: item.remarks, createdById: user.id }, include: includes })
        const updated = await tx.inventoryLine.findUniqueOrThrow({ where: { id: line.id } })
        const movement = await tx.movement.create({ data: { id: 'OTM-' + randomUUID(), date, time: stamp(), by: user.name, shift: updated.shift, item: line.item, branch, type: 'Stock Out · treatment', qty: -item.stockQuantity, batch: line.batch, ref: visitReference, reason: 'Other treatment administered' } })
        await safeAudit(tx, req, 'Other treatment given', reference, branch, line.item + ' · ' + item.stockQuantity + ' ' + line.unit)
        treatments.push(treatment); lines.push(updated); movements.push(movement)
      }
      return { treatments, lines, movements }
    })
    return res.json({ treatments: result.treatments.map(t => present(t, canPage(user.role, 'payments'))), lines: result.lines.map(inventoryClient), movements: result.movements.map(movementClient) })
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/^(Select a usable|Insufficient usable|This request ID)/.test(message)) return res.status(409).json({ error: message })
    throw err
  }
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

otherTreatmentsRouter.get('/other-treatments/:id/prices', requirePage('payments'), async (req, res) => {
  const row = await prisma.otherTreatment.findUnique({ where: { id: req.params.id } })
  if (!row) return res.status(404).json({ error: 'Treatment not found.' })
  if (!canAccessBranch(req.user!, row.branch)) return res.status(403).json({ error: 'This is not your branch.' })
  if (!row.visitId) return res.status(400).json({ error: 'Price correction is available for new treatment visits only.' })
  const group = await prisma.otherTreatment.findMany({ where: { visitId: row.visitId }, include: includes, orderBy: { reference: 'asc' } })
  if (!group.length || group.some(t => t.priceCentavos == null)) return res.status(409).json({ error: 'Treatment details are not available.' })
  return res.json({ reference: group[0].reference, date: group[0].date, paid: group.some(t => !!t.payment), payment: group.find(t => t.payment)?.payment || null, items: group.map(t => ({ id: t.id, service: t.service, status: t.status, priceCentavos: t.priceCentavos, product: t.product, brand: t.brand, batch: t.batch, stockExpiry: t.stockExpiry, stockQuantity: t.stockQuantity, stockUnit: t.stockUnit, administeredQuantity: t.administeredQuantity == null ? null : Number(t.administeredQuantity), administeredUnit: t.administeredUnit, administeredBy: t.administeredBy, administeredAt: t.administeredAt, remarks: t.remarks })) })
})

otherTreatmentsRouter.patch('/other-treatments/:id/prices', requirePage('payments'), async (req, res) => {
  const parsed = priceCorrectionSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter valid prices for all services and a reason for the correction.' })
  const row = await prisma.otherTreatment.findUnique({ where: { id: req.params.id } })
  if (!row) return res.status(404).json({ error: 'Treatment not found.' })
  if (!canAccessBranch(req.user!, row.branch)) return res.status(403).json({ error: 'This is not your branch.' })
  if (!row.visitId) return res.status(400).json({ error: 'Price correction is available for new treatment visits only.' })
  const visitId = row.visitId
  try {
    const updated = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'other-payment:' + visitId}))`
      const group = await tx.otherTreatment.findMany({ where: { visitId }, include: includes, orderBy: { reference: 'asc' } })
      if (!group.length || group.some(t => t.status !== 'Given' || t.payment || t.priceCentavos == null)) throw new Error('Only unpaid treatment visits can be updated.')
      const changes = new Map(parsed.data.items.map(item => [item.id, item]))
      if (changes.size !== group.length || group.some(t => !changes.has(t.id))) throw new Error('The visit changed. Reload and try again.')
      if (group.some(t => changes.get(t.id)!.expectedPriceCentavos !== t.priceCentavos)) throw new Error('The prices changed. Reload and try again.')
      if (group.every(t => changes.get(t.id)!.priceCentavos === t.priceCentavos)) throw new Error('Change at least one price.')
      const before = group.map(t => t.service + ': ' + t.priceCentavos).join(' · ')
      for (const t of group) await tx.otherTreatment.update({ where: { id: t.id }, data: { priceCentavos: changes.get(t.id)!.priceCentavos } })
      const after = group.map(t => t.service + ': ' + changes.get(t.id)!.priceCentavos).join(' · ')
      await tx.auditLog.create({ data: { userId: req.user!.id, userName: req.user!.name + ' (' + req.user!.role + ')', module: 'Other treatment', action: 'Unpaid treatment prices corrected', record: group[0].reference, branch: row.branch, oldValue: before, newValue: after + ' · Reason: ' + parsed.data.reason, time: clinicDate() + ' · ' + stamp(), device: req.userAgent } })
      const rows = await tx.otherTreatment.findMany({ where: { visitId }, include: includes, orderBy: { reference: 'asc' } })
      return otherPendingClients(rows)[0]
    })
    return res.json(updated)
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/^(Only unpaid|The visit changed|The prices changed|Change at least)/.test(message)) return res.status(409).json({ error: message })
    throw err
  }
})

otherTreatmentsRouter.post('/other-treatments/:id/payment', requirePage('payments'), async (req, res) => {
  const parsed = paymentSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid amount and payment method.' })
  const row = await prisma.otherTreatment.findUnique({ where: { id: req.params.id }, include: includes })
  if (!row) return res.status(404).json({ error: 'Treatment not found.' })
  if (!canAccessBranch(req.user!, row.branch)) return res.status(403).json({ error: 'This is not your branch.' })
  try {
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'other-payment:' + (row.visitId || row.id)}))`
      const group = row.visitId ? await tx.otherTreatment.findMany({ where: { visitId: row.visitId }, include: includes, orderBy: { reference: 'asc' } }) : [await tx.otherTreatment.findUniqueOrThrow({ where: { id: row.id }, include: includes })]
      if (group.some(t => t.status === 'Cancelled' || t.payment)) throw new Error('This treatment visit is cancelled or already paid.')
      let discountCentavos = 0
      if (parsed.data.discountType && (!row.visitId || group.some(t => t.service === 'Flu Senior-PWD' || t.service === 'Flu Student'))) throw new Error('Use Flu for a Senior/PWD discount; legacy or student prices need review.')
      if (row.visitId) {
        if (group.some(t => t.priceCentavos == null)) throw new Error('A treatment price is missing.')
        if (parsed.data.expectedPrices) {
          const expected = new Map(parsed.data.expectedPrices.map(item => [item.id, item.priceCentavos]))
          if (expected.size !== group.length || group.some(t => expected.get(t.id) !== t.priceCentavos)) throw new Error('The prices changed. Reload and try again.')
        }
        const correction = parsed.data.priceCorrection
        let total = group.reduce((sum, t) => sum + (t.priceCentavos || 0), 0)
        if (correction) {
          if (group.some(t => t.status !== 'Given')) throw new Error('Only unpaid treatment visits can be updated.')
          const changes = new Map(correction.items.map(item => [item.id, item]))
          if (changes.size !== group.length || group.some(t => !changes.has(t.id))) throw new Error('The visit changed. Reload and try again.')
          if (group.some(t => changes.get(t.id)!.expectedPriceCentavos !== t.priceCentavos)) throw new Error('The prices changed. Reload and try again.')
          if (group.every(t => changes.get(t.id)!.priceCentavos === t.priceCentavos)) throw new Error('Change at least one price.')
          total = group.reduce((sum, t) => sum + changes.get(t.id)!.priceCentavos, 0)
          const before = group.map(t => t.service + ': ' + t.priceCentavos).join(' · ')
          for (const t of group) await tx.otherTreatment.update({ where: { id: t.id }, data: { priceCentavos: changes.get(t.id)!.priceCentavos } })
          const after = group.map(t => t.service + ': ' + changes.get(t.id)!.priceCentavos).join(' · ')
          await tx.auditLog.create({ data: { userId: req.user!.id, userName: req.user!.name + ' (' + req.user!.role + ')', module: 'Other treatment', action: 'Unpaid treatment prices corrected', record: group[0].reference, branch: row.branch, oldValue: before, newValue: after + ' · Reason: ' + correction.reason, time: clinicDate() + ' · ' + stamp(), device: req.userAgent } })
        }
        if (parsed.data.discountType) {
          const prices = correction ? correction.items.map(item => item.priceCentavos) : group.map(t => t.priceCentavos || 0)
          discountCentavos = Math.round(prices.reduce((sum, price) => sum + price, 0) * 0.2)
        }
        if (parsed.data.amountCentavos !== total - discountCentavos) throw new Error('Payment must equal the full visit total.')
      }
      if (!row.visitId && parsed.data.priceCorrection) throw new Error('Only grouped treatment visits support price correction.')
      const owner = group[0]
      const claim = await tx.otherTreatment.updateMany({ where: { id: owner.id, status: { not: 'Cancelled' }, payment: { is: null } }, data: { updatedAt: now() } })
      if (!claim.count) throw new Error('This treatment visit is cancelled or already paid.')
      await tx.otherTreatmentPayment.create({ data: { id: 'OTP-' + randomUUID(), treatmentId: owner.id, amountCentavos: parsed.data.amountCentavos, discountType: parsed.data.discountType || null, discountCentavos, method: parsed.data.method, externalReference: parsed.data.externalReference, paymentDate: clinicDate(), recordedById: req.user!.id } })
      await safeAudit(tx, req, 'Other treatment payment recorded', owner.reference, row.branch, 'Payment recorded')
      return tx.otherTreatment.findUniqueOrThrow({ where: { id: owner.id }, include: includes })
    })
    return res.json(present(result))
  } catch (err: any) {
    if (err?.code === 'P2002') return res.status(409).json({ error: 'This treatment is already paid.' })
    if (/^(This treatment visit|A treatment price|Payment must|Only unpaid|The visit changed|The prices changed|Change at least|Only grouped|Use Flu)/.test(err?.message || '')) return res.status(409).json({ error: err.message })
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