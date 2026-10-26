import { ApiRouter } from '../router.js'
import { z } from 'zod'
import type { Encounter, InventoryLine, Movement, Payment, Prisma, Refund } from '@prisma/client'
import { prisma } from '../prisma.js'
import { audit, publicAudit } from '../audit.js'
import { canAccessBranch, requireAuth, requirePage, servicingBranch, type AuthedUser } from '../auth.js'
import {
  ALL_BRANCH_ROLES, HIGH_RISK_SITES, NURSE_ROLE, ageFrom, blankErig, blankHistory, clinicDate,
  blankProgress, blankTt, canPage, caseInfo, fullName, protocolOf, refundEligible, samePerson, statusOf,
  visitNeedsPay, visitPaid
} from '../clinical.js'
import { autoDay0Skip, createDoseInTx, day0DoseOf, resolveVaccinator, tryAutoDay0 } from '../doses.js'
import { applyConsume, applyRestore, doseUses } from '../inventory.js'
import { nextId } from '../ids.js'
import {
  doseClient, encounterClient, inventoryClient, movementClient, noteClient, patientClient, patientDirectory,
  paymentClient, referralClient, refundClient
} from '../map.js'
import { issueRegistry, issueTxn, nextPrefixedId, peekRegistry } from '../registry.js'
import { workspaceExtras } from './ops.js'

export const clinicalRouter = new ApiRouter()
clinicalRouter.use(requireAuth)

function inScopeEncounter(user: AuthedUser, e: { branch: string; transferredTo: string }) {
  if (user.allBranches) return true
  return servicingBranch(e) === user.branchName || e.branch === user.branchName
}

clinicalRouter.get('/clinical', requirePage('dashboard'), async (req, res) => {
  const user = req.user!
  const extras = await workspaceExtras(user)
  const canClinical = ['patients', 'admissions', 'exposure', 'treatments', 'notes', 'schedule'].some(p => canPage(user.role, p))
  if (!canClinical) {
    return res.json({ patients: [], encounters: [], doses: [], notes: [], payments: [], referrals: [], audit: [], ...extras })
  }
  const [patients, encounters, doses, notes, paymentRows, referrals, auditRows] = await Promise.all([
    prisma.patient.findMany({ orderBy: { name: 'asc' } }),
    prisma.encounter.findMany(),
    prisma.dose.findMany(),
    prisma.progressNote.findMany({ orderBy: { date: 'desc' } }),
    prisma.payment.findMany({ orderBy: { date: 'desc' } }),
    prisma.referral.findMany({ orderBy: { date: 'desc' } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 80 })
  ])
  const scopedEnc = encounters.filter(e => inScopeEncounter(user, e))
  const payments = await repairStaleOpenBills(scopedEnc, paymentRows)
  const scopedIds = new Set(scopedEnc.map(e => e.id))
  const lastByPatient = new Map<string, string>()
  for (const e of [...encounters].sort((a, b) => b.date.localeCompare(a.date))) {
    if (!lastByPatient.has(e.patientId)) lastByPatient.set(e.patientId, e.registry)
  }
  const patientRows = patients.map(p => {
    const hasScopedVisit = scopedEnc.some(e => e.patientId === p.id)
    const home = user.allBranches || p.branch === user.branchName
    if (home || hasScopedVisit) return patientClient(p)
    return {
      ...patientDirectory(p, lastByPatient.get(p.id)),
      age: p.age, sex: p.sex, municipality: p.municipality, municipalityOther: p.municipalityOther,
      guardian: '', senior: false, pwd: false, vetmed: false, philhealth: p.philhealth,
      classification: p.classification
    }
  })
  res.json({
    patients: patientRows,
    encounters: scopedEnc.map(encounterClient),
    doses: doses.filter(d => scopedIds.has(d.encounterId) || d.branch === user.branchName || user.allBranches).map(doseClient),
    notes: notes.filter(n => scopedIds.has(n.encounterId) || user.allBranches).map(noteClient),
    payments: (user.allBranches || canPage(user.role, 'payments')
      ? payments.filter(p => user.allBranches || p.branch === user.branchName)
      : payments.filter(p => scopedIds.has(p.encounterId))).map(paymentClient),
    referrals: referrals.filter(r => user.allBranches || r.from === user.branchName || r.to === user.branchName).map(referralClient),
    audit: (user.allBranches || ALL_BRANCH_ROLES.includes(user.role) ? auditRows : auditRows.filter(a => a.branch === user.branchName)).map(publicAudit),
    ...extras
  })
})

clinicalRouter.get('/registry/next', requirePage('admissions'), async (req, res) => {
  const branch = String(req.query.branch || req.user!.branchName || 'Guimba')
  const date = String(req.query.date || clinicDate())
  if (!req.user!.allBranches && branch !== req.user!.branchName) {
    return res.status(403).json({ error: 'This is not your branch' })
  }
  const registry = await peekRegistry(prisma, branch, date)
  res.json({ registry })
})

const patientSchema = z.object({
  first: z.string().trim().min(1),
  last: z.string().trim().min(1),
  middle: z.string().optional().default(''),
  suffix: z.string().optional().default(''),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: z.enum(['Female', 'Male']),
  contact: z.string().trim().min(1, 'Cellphone number is required'),
  address: z.string().optional().default(''),
  municipality: z.string().optional().default(''),
  municipalityOther: z.string().optional().default(''),
  guardian: z.string().optional().default(''),
  senior: z.boolean().optional().default(false),
  pwd: z.boolean().optional().default(false),
  vetmed: z.boolean().optional().default(false),
  philhealth: z.boolean().optional().default(false),
  branch: z.string().min(1)
})

clinicalRouter.get('/patients/match', requirePage('admissions'), async (req, res) => {
  const last = String(req.query.last || ''), first = String(req.query.first || '')
  const middle = String(req.query.middle || ''), birthday = String(req.query.birthday || '')
  if (!last || !first || !birthday) return res.json({ match: null })
  const all = await prisma.patient.findMany()
  const hit = all.find(p => samePerson(p, { last, first, middle, birthday }))
  if (!hit) return res.json({ match: null })
  const lastEnc = await prisma.encounter.findFirst({ where: { patientId: hit.id }, orderBy: { date: 'desc' } })
  res.json({
    match: {
      id: hit.id,
      name: hit.name,
      birthday: hit.birthday,
      branch: hit.branch,
      lastRegistry: lastEnc?.registry || '',
      sameBranch: hit.branch === (req.query.branch || req.user!.branchName)
    }
  })
})

clinicalRouter.post('/patients', requirePage('patients'), async (req, res) => {
  const parsed = patientSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Last name, first name, birthday, gender and cellphone are required' })
  const form = parsed.data
  if (!req.user!.allBranches && form.branch !== req.user!.branchName) {
    return res.status(403).json({ error: 'This is not your branch' })
  }
  const all = await prisma.patient.findMany()
  const hit = all.find(p => samePerson(p, form))
  if (hit) {
    const lastEnc = await prisma.encounter.findFirst({ where: { patientId: hit.id }, orderBy: { date: 'desc' } })
    return res.status(409).json({
      error: hit.branch === form.branch
        ? 'Existing patient found — use Returning patient instead'
        : 'Same person found at ' + hit.branch + ' · use Returning patient (same patient, not New patient). Complete last case = new admission + new registry',
      match: { id: hit.id, name: hit.name, birthday: hit.birthday, branch: hit.branch, lastRegistry: lastEnc?.registry || '' }
    })
  }
  const created = await prisma.$transaction(async tx => {
    const id = await nextPrefixedId(tx, 'Patient', 'PT-')
    const age = ageFrom(form.birthday)
    return tx.patient.create({
      data: {
        id,
        ...form,
        middle: form.middle || '',
        name: fullName(form),
        age,
        senior: age >= 60,
        classification: form.philhealth ? 'PhilHealth' : 'Walk-in'
      }
    })
  })
  await audit(req, { module: 'Patients', action: 'Created patient master record', record: created.name, branch: created.branch })
  res.json(patientClient(created))
})

clinicalRouter.patch('/patients/:id', requirePage('patients'), async (req, res) => {
  const parsed = patientSchema.partial().extend({
    first: z.string().trim().min(1).optional(),
    last: z.string().trim().min(1).optional(),
    birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sex: z.enum(['Female', 'Male']).optional()
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Last name, first name, birthday and gender are required' })
  const existing = await prisma.patient.findUnique({ where: { id: req.params.id } })
  if (!existing) return res.status(404).json({ error: 'Patient not found' })
  const next = { ...existing, ...parsed.data }
  const age = ageFrom(next.birthday)
  const turnOnPh = !existing.philhealth && !!next.philhealth
  const result = await prisma.$transaction(async tx => {
    const patient = await tx.patient.update({
      where: { id: existing.id },
      data: {
        ...parsed.data,
        name: fullName(next),
        age,
        senior: age >= 60,
        classification: next.philhealth ? 'PhilHealth' : 'Walk-in'
      }
    })
    let encounter: Encounter | null = null
    let refunds: Awaited<ReturnType<typeof reclassifyWalkInInTx>>['refunds'] = []
    let eligible = false
    let payments: Awaited<ReturnType<typeof reclassifyWalkInInTx>>['payments'] = []
    if (turnOnPh) {
      const visits = await tx.encounter.findMany({
        where: { patientId: existing.id, past: false },
        orderBy: { date: 'desc' }
      })
      const walkIn = visits.find(enc => enc.billing === 'Walk-in' && !enc.booster && inScopeEncounter(req.user!, enc))
      if (walkIn) {
        const branchRow = await tx.branch.findUnique({ where: { name: walkIn.branch } })
        const billing = branchRow?.accreditation === 'Accredited' ? 'PhilHealth' : 'For PhilHealth'
        const done = await reclassifyWalkInInTx(tx, walkIn, patient.name, billing)
        encounter = done.updated
        refunds = done.refunds
        eligible = done.eligible
        payments = done.payments
      }
    }
    return { patient, encounter, refunds, eligible, payments }
  })
  await audit(req, { module: 'Patients', action: 'Updated patient details', record: result.patient.name, branch: result.patient.branch })
  if (result.encounter) {
    await audit(req, {
      module: 'Payment',
      action: 'Reclassified ' + result.encounter.registry + ' to ' + result.encounter.billing + (result.refunds.length ? ' · refund requested' : result.eligible ? '' : ' · refund window closed'),
      record: result.encounter.registry,
      branch: result.encounter.branch
    })
  }
  res.json({
    patient: patientClient(result.patient),
    encounter: result.encounter ? encounterClient(result.encounter) : null,
    payments: result.payments.map(paymentClient),
    refunds: result.refunds.map(refundClient),
    refundEligible: result.eligible
  })
})

const admitSchema = z.object({
  mode: z.enum(['Returning patient', 'New patient']),
  patientId: z.string().optional(),
  patient: patientSchema.optional(),
  visit: z.object({
    branch: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    billing: z.string().optional().default('')
  })
})

clinicalRouter.post('/admissions', requirePage('admissions'), async (req, res) => {
  const parsed = admitSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Incomplete admission' })
  const { mode, visit } = parsed.data
  const user = req.user!
  if (!user.allBranches && visit.branch !== user.branchName) {
    return res.status(403).json({ error: 'This is not your branch' })
  }
  const branchRow = await prisma.branch.findUnique({ where: { name: visit.branch } })
  if (!branchRow) return res.status(400).json({ error: 'Unknown branch' })
  const accredited = branchRow.accreditation === 'Accredited'
  if (!accredited && visit.billing !== 'Walk-in' && visit.billing !== 'For PhilHealth') {
    return res.status(400).json({ error: 'Select Pay now or For PhilHealth' })
  }

  let patient = parsed.data.patientId
    ? await prisma.patient.findUnique({ where: { id: parsed.data.patientId } })
    : null

  if (mode === 'New patient') {
    if (!parsed.data.patient) return res.status(400).json({ error: 'Last name, first name, birthday, gender and cellphone are required' })
    const form = parsed.data.patient
    const all = await prisma.patient.findMany()
    const hit = all.find(p => samePerson(p, form))
    if (hit) {
      const lastEnc = await prisma.encounter.findFirst({ where: { patientId: hit.id }, orderBy: { date: 'desc' } })
      return res.status(409).json({
        error: hit.branch === visit.branch
          ? 'Existing patient found — use Returning patient instead'
          : 'Same person found at ' + hit.branch + ' · use Returning patient (same patient, not New patient). Complete last case = new admission + new registry',
        match: { id: hit.id, name: hit.name, birthday: hit.birthday, branch: hit.branch, lastRegistry: lastEnc?.registry || '' }
      })
    }
  } else if (!patient) {
    return res.status(400).json({ error: 'Select the returning patient' })
  }

  const allEnc = await prisma.encounter.findMany({ where: patient ? { patientId: patient.id } : undefined })
  const allDoses = await prisma.dose.findMany()
  if (patient) {
    const open = allEnc
      .filter(e => !e.past && ['Ongoing', 'For RER'].includes(statusOf(e, allDoses)))
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    if (open) {
      const other = servicingBranch(open) !== visit.branch && !canAccessBranch(user, servicingBranch(open))
      return res.json({
        continued: true,
        otherBranch: other || servicingBranch(open) !== visit.branch,
        caseBranch: servicingBranch(open),
        encounter: encounterClient(open)
      })
    }
  }

  const result = await prisma.$transaction(async tx => {
    if (mode === 'New patient' && parsed.data.patient) {
      const form = parsed.data.patient
      const forPH = visit.billing === 'For PhilHealth'
      const id = await nextPrefixedId(tx, 'Patient', 'PT-')
      const age = ageFrom(form.birthday)
      patient = await tx.patient.create({
        data: {
          id, ...form, name: fullName(form), age,
          senior: age >= 60,
          philhealth: form.philhealth || forPH,
          classification: (form.philhealth || forPH) ? 'PhilHealth' : 'Walk-in'
        }
      })
    }
    if (!patient) throw new Error('Select the returning patient')
    if (visit.billing === 'For PhilHealth' && !patient.philhealth) {
      patient = await tx.patient.update({
        where: { id: patient.id },
        data: { philhealth: true, classification: 'PhilHealth' }
      })
    }
    const billing = accredited
      ? (patient.philhealth ? 'PhilHealth' : 'Walk-in')
      : visit.billing
    const registry = await issueRegistry(tx, visit.branch, visit.date)
    const encId = await nextPrefixedId(tx, 'Encounter', 'ENC-')
    const now = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
    const enc = await tx.encounter.create({
      data: {
        id: encId,
        registry,
        patientId: patient.id,
        branch: visit.branch,
        date: visit.date,
        time: now,
        consentBy: patient.guardian ? patient.guardian.split(' (')[0] : patient.name,
        animal: '',
        biteType: '',
        pet: null,
        vaccinated: null,
        stray: null,
        owned: null,
        washed: null,
        tandok: null,
        side: '',
        biteDate: '',
        pepEligible: false,
        animalStatus: '',
        vaccine: '',
        brand: '',
        regimen: '',
        wound: [],
        history: blankHistory,
        tt: blankTt,
        erig: blankErig,
        progress: blankProgress,
        billing,
        rer: false
      }
    })
    const payId = await nextPrefixedId(tx, 'Payment', 'PAY-')
    const payment = await tx.payment.create({
      data: {
        id: payId,
        registry,
        encounterId: enc.id,
        patient: patient.name,
        branch: visit.branch,
        date: visit.date,
        service: billing === 'Walk-in' ? 'Not set yet' : 'Anti-rabies vaccine',
        classification: billing,
        amount: 0,
        method: billing === 'PhilHealth' ? 'PhilHealth' : '—',
        reference: '—',
        status: billing === 'Walk-in' ? 'Pending' : 'Not billed',
        remarks: billing === 'For PhilHealth'
          ? 'Not billed · give Day 0 then refer for PhilHealth'
          : billing === 'PhilHealth' ? '₱0 · PhilHealth' : 'Not yet paid',
        txn: await issueTxn(tx, visit.branch, visit.date)
      }
    })
    return { patient, enc, payment, billing, registry }
  })

  await audit(req, {
    module: 'Admission',
    action: 'Admission ' + result.registry + ' created',
    record: result.registry,
    branch: visit.branch,
    newValue: mode
  })
  res.json({
    continued: false,
    patient: patientClient(result.patient),
    encounter: encounterClient(result.enc),
    payment: paymentClient(result.payment),
    billing: result.billing,
    registry: result.registry
  })
})

function openBillLines(enc: { billing: string, booster: boolean, preExp: boolean, category: string }) {
  if (enc.booster) return [{ service: 'Booster dose', price: 750, status: 'Pending' as const, remarks: 'Not yet paid' }]
  if (enc.billing === 'PhilHealth') return [{ service: 'Anti-rabies vaccine', price: 0, status: 'Not billed' as const, remarks: '₱0 · PhilHealth' }]
  if (enc.billing === 'For PhilHealth') return [{ service: 'Anti-rabies vaccine', price: 0, status: 'Not billed' as const, remarks: 'Not billed · give Day 0 then refer for PhilHealth' }]
  if (enc.billing && enc.billing !== 'Walk-in') return []
  if (enc.preExp || enc.category === 'II') return [{ service: 'Anti-rabies vaccine', price: 750, status: 'Pending' as const, remarks: 'Not yet paid' }]
  if (enc.category === 'III') return [
    { service: 'Anti-rabies vaccine', price: 750, status: 'Pending' as const, remarks: 'Not yet paid' },
    { service: 'ERIG (serum)', price: 2600, status: 'Pending' as const, remarks: 'Not yet paid' },
    { service: 'Tetanus Toxoid', price: 300, status: 'Pending' as const, remarks: 'Not yet paid' }
  ]
  if (enc.category === 'I') return [{ service: 'Category I', price: 0, status: 'Not billed' as const, remarks: 'Category I · no charge' }]
  return []
}

function openBillsMatch(
  open: { service: string, amount: number, status: string }[],
  specs: { service: string, price: number, status: string }[]
) {
  if (open.length !== specs.length) return false
  const used = new Set<number>()
  return specs.every(spec => {
    const i = open.findIndex((p, idx) => !used.has(idx) && p.service === spec.service && Number(p.amount) === spec.price && p.status === spec.status)
    if (i < 0) return false
    used.add(i)
    return true
  })
}

function needsOpenBillRewrite(enc: Encounter, rows: Payment[]) {
  if (rows.some(p => p.status === 'Paid' && Number(p.amount) > 0)) return false
  const specs = openBillLines(enc)
  if (!specs.length) return false
  const open = rows.filter(p => p.status === 'Pending' || p.status === 'Not billed')
  return !openBillsMatch(open, specs)
}

async function repairStaleOpenBills(encounters: Encounter[], payments: Payment[]) {
  const stale = encounters.filter(enc => !enc.past && enc.rer && needsOpenBillRewrite(enc, payments.filter(p => p.encounterId === enc.id)))
  if (!stale.length) return payments
  const names = new Map((await prisma.patient.findMany({
    where: { id: { in: stale.map(e => e.patientId) } },
    select: { id: true, name: true }
  })).map(p => [p.id, p.name]))
  const rewritten = await prisma.$transaction(async tx => {
    const out: Payment[] = []
    for (const enc of stale) out.push(...await syncOpenBill(tx, enc, enc, names.get(enc.patientId) || ''))
    return out
  })
  const staleIds = new Set(stale.map(e => e.id))
  return [...payments.filter(p => !staleIds.has(p.encounterId)), ...rewritten]
}

async function syncOpenBill(tx: Prisma.TransactionClient, _before: Encounter, updated: Encounter, patientName: string) {
  const rows = await tx.payment.findMany({ where: { encounterId: updated.id }, orderBy: { createdAt: 'asc' } })
  if (!needsOpenBillRewrite(updated, rows)) return rows
  const specs = openBillLines(updated)
  const open = rows.filter(p => p.status === 'Pending' || p.status === 'Not billed')
  const txn = rows.find(p => p.txn)?.txn || await issueTxn(tx, updated.branch, updated.date)
  if (open.length) await tx.payment.deleteMany({ where: { id: { in: open.map(p => p.id) } } })
  const created: Payment[] = []
  for (const spec of specs) {
    created.push(await tx.payment.create({
      data: {
        id: await nextPrefixedId(tx, 'Payment', 'PAY-'),
        registry: updated.registry,
        encounterId: updated.id,
        patient: patientName || rows[0]?.patient || '',
        branch: updated.branch,
        date: updated.date,
        service: spec.service,
        classification: updated.booster ? 'Walk-in' : (updated.billing || 'Walk-in'),
        amount: spec.price,
        method: spec.status === 'Not billed' && updated.billing === 'PhilHealth' ? 'PhilHealth' : '—',
        reference: '—',
        status: spec.status,
        remarks: spec.remarks,
        txn
      }
    }))
  }
  return [...rows.filter(p => p.status === 'Paid'), ...created]
}

clinicalRouter.patch('/encounters/:id', requirePage('exposure'), async (req, res) => {
  const existing = await prisma.encounter.findUnique({ where: { id: req.params.id } })
  if (!existing) return res.status(404).json({ error: 'Admission not found' })
  if (!inScopeEncounter(req.user!, existing)) return res.status(403).json({ error: 'This is not your branch' })
  const body = req.body as Record<string, unknown>
  if (body.site && HIGH_RISK_SITES.has(String(body.site))) body.category = 'III'
  if (body.category === 'III' && !body.booster && !body.preExp && !existing.booster) body.rig = body.rig || 'ERIG'
  const becomingBooster = body.booster === true
  const leavingBooster = body.booster === false && existing.booster
  if (!body.preExp && (becomingBooster || (existing.booster && !leavingBooster))) {
    body.rig = ''
    body.erig = blankErig
  }
  if (becomingBooster) body.billing = 'Walk-in'
  if (leavingBooster) {
    const paid = await prisma.payment.findFirst({ where: { encounterId: existing.id, status: 'Paid', amount: { gt: 0 } } })
    if (!paid) {
      const [patient, branchRow] = await Promise.all([
        prisma.patient.findUnique({ where: { id: existing.patientId } }),
        prisma.branch.findUnique({ where: { name: existing.branch } })
      ])
      body.billing = patient?.philhealth
        ? (branchRow?.accreditation === 'Accredited' ? 'PhilHealth' : 'For PhilHealth')
        : 'Walk-in'
    }
  }
  if (body.preExp) {
    body.rig = ''
    body.animal = ''
    body.animalOther = ''
    body.biteType = ''
    body.pet = null
    body.vaccinated = null
    body.stray = null
    body.owned = null
    body.owner = ''
    body.biteDate = ''
    body.biteTime = ''
    body.side = ''
    body.site = ''
    body.place = ''
    body.washed = null
    body.tandok = null
    body.wound = []
    body.category = ''
    body.pepEligible = false
    body.animalStatus = ''
    body.tt = blankTt
    body.erig = blankErig
  } else if (body.category === 'I') {
    body.pepEligible = false
  } else if ((body.category === 'II' || body.category === 'III') && body.pepEligible == null) {
    body.pepEligible = true
  }
  const allowed = [
    'chief', 'animal', 'animalOther', 'biteType', 'pet', 'vaccinated', 'stray', 'owned', 'owner',
    'biteDate', 'biteTime', 'side', 'site', 'place', 'washed', 'tandok', 'wound', 'category',
    'booster', 'preExp', 'vaccine', 'brand', 'regimen', 'history', 'bp', 'weight', 'temp',
    'consent', 'consentBy', 'tt', 'rig', 'erig', 'pepEligible', 'animalStatus', 'progress',
    'doctor', 'rer', 'billing'
  ]
  const data: Record<string, unknown> = {}
  for (const k of allowed) if (k in body) data[k] = body[k]
  const prevTt = (existing.tt || {}) as { given?: boolean; refused?: boolean }
  const nextTt = ('tt' in data ? data.tt : prevTt) as { given?: boolean; refused?: boolean }
  const firstTt = !!nextTt.given && !prevTt.given && !nextTt.refused
  const servicing = servicingBranch(existing)
  try {
    const result = await prisma.$transaction(async tx => {
      let line: InventoryLine | null = null
      let movement: Movement | null = null
      if (firstTt) {
        const consumed = await applyConsume(tx, 'Tetanus Toxoid', servicing, 1)
        if ('error' in consumed) throw new Error(consumed.error)
        line = consumed.line
        movement = await tx.movement.create({
          data: {
            id: await nextId(tx.movement, 'MOV-', 4),
            date: clinicDate(),
            time: new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
            by: req.user!.name,
            shift: consumed.line.shift,
            item: 'Tetanus Toxoid',
            branch: servicing,
            type: 'Stock Out · treatment',
            qty: consumed.vials,
            uses: 1,
            batch: consumed.line.batch,
            ref: existing.registry,
            reason: 'Treatment usage'
          }
        })
      }
      const updated = await tx.encounter.update({ where: { id: existing.id }, data })
      const patient = await tx.patient.findUnique({ where: { id: updated.patientId } })
      const payments = await syncOpenBill(tx, existing, updated, patient?.name || '')
      return { updated, line, movement, payments }
    })
    await audit(req, { module: 'RER', action: 'RER saved for ' + result.updated.registry, record: result.updated.registry, branch: servicing })
    const day0 = body.day0 as { given?: boolean; dose?: string; time?: string; side?: string; vaccinator?: string; batch?: string; animalStatus?: string } | undefined
    const vaccinator = String(day0?.vaccinator || body.vaccinator || '')
    const auto = day0?.given === true
      ? await autoDay0Extras(result.updated, req.user!.name, vaccinator, day0)
      : {}
    if (auto.dose) {
      await audit(req, { module: 'Treatment', action: 'Day 0 recorded with RER · ' + result.updated.registry, record: result.updated.registry, branch: servicing })
    }
    res.json({
      ...encounterClient(result.updated),
      ...(result.line ? { line: inventoryClient(result.line), movement: movementClient(result.movement!) } : {}),
      payments: result.payments.map(paymentClient),
      ...auto
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to save'
    if (msg.startsWith('No usable') || msg.startsWith('Insufficient')) return res.status(409).json({ error: msg })
    throw err
  }
})

const doseSchema = z.object({
  day: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().min(1),
  dose: z.string().min(1),
  side: z.enum(['L', 'R']),
  animalStatus: z.enum(['Alive', 'Lost/Stray', 'Dead']),
  vaccinator: z.string().min(1),
  batch: z.string().optional().default('')
})

clinicalRouter.post('/encounters/:id/doses', requirePage('treatments'), async (req, res) => {
  const parsed = doseSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Incomplete dose' })
  const enc = await prisma.encounter.findUnique({ where: { id: req.params.id } })
  if (!enc) return res.status(404).json({ error: 'Admission not found' })
  if (!inScopeEncounter(req.user!, enc)) return res.status(403).json({ error: 'This is not your branch' })
  const servicing = servicingBranch(enc)
  const nurse = await prisma.employee.findFirst({
    where: { name: parsed.data.vaccinator, branch: servicing, role: NURSE_ROLE, status: 'Active' }
  })
  if (!nurse) {
    return res.status(400).json({ error: 'Vaccinator must be an active Nurse at ' + servicing })
  }
  const doses = await prisma.dose.findMany({ where: { encounterId: { in: [enc.id, enc.continuedFromEncounterId || '', enc.receivingEncounterId || ''].filter(Boolean) } } })
  const info = caseInfo(enc, doses)
  if (info.status === 'No PEP') {
    return res.status(409).json({ error: 'This case is locked · no further doses' })
  }
  const pays = await prisma.payment.findMany({ where: { encounterId: enc.id } })
  if (visitNeedsPay(enc) && !visitPaid(pays, enc.id)) {
    return res.status(409).json({ error: 'Collect walk-in payment before recording a dose' })
  }
  if (doses.some(d => d.day === parsed.data.day && d.encounterId === enc.id)) {
    return res.status(409).json({ error: 'This dose day is already recorded' })
  }
  const reported = [...doses, { encounterId: enc.id, day: parsed.data.day, date: parsed.data.date, animalStatus: parsed.data.animalStatus }]
  const protocol = protocolOf({ ...enc, animalStatus: parsed.data.animalStatus }, reported)
  const k = protocol.days.findIndex(x => x[0] === parsed.data.day)
  if (k < 0) return res.status(400).json({ error: 'Day is not on this protocol' })
  if (k > 0) {
    const prev = protocol.days[k - 1][0]
    const linked = new Set([enc.id, enc.continuedFromEncounterId, enc.receivingEncounterId].filter(Boolean) as string[])
    const all = await prisma.dose.findMany({ where: { encounterId: { in: [...linked] } } })
    if (!all.some(d => d.day === prev)) {
      return res.status(409).json({
        error: prev === 'D14'
          ? 'Record Day 14 first. The animal was reported lost or dead within 14 days.'
          : 'Record the previous dose first'
      })
    }
  }
  try {
    const result = await prisma.$transaction(async tx => createDoseInTx(tx, enc, parsed.data, req.user!.name, doses))
    await audit(req, { module: 'Treatment', action: 'Recorded ' + parsed.data.day + ' · ' + enc.registry, record: enc.registry, branch: servicingBranch(enc) })
    res.json({
      ...doseClient(result.created),
      line: inventoryClient(result.consumed.line),
      movement: movementClient(result.movement)
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to record dose'
    if (msg.startsWith('No usable') || msg.startsWith('Insufficient')) return res.status(409).json({ error: msg })
    throw err
  }
})

clinicalRouter.patch('/encounters/:id/doses/:day', requirePage('treatments'), async (req, res) => {
  const parsed = doseSchema.omit({ day: true }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Incomplete dose' })
  const enc = await prisma.encounter.findUnique({ where: { id: req.params.id } })
  if (!enc) return res.status(404).json({ error: 'Admission not found' })
  if (!inScopeEncounter(req.user!, enc)) return res.status(403).json({ error: 'This is not your branch' })
  const servicing = servicingBranch(enc)
  const existing = await prisma.dose.findFirst({ where: { encounterId: enc.id, day: req.params.day } })
  if (!existing) return res.status(404).json({ error: 'Dose not found' })
  const nurse = await prisma.employee.findFirst({
    where: { name: parsed.data.vaccinator, branch: servicing, role: NURSE_ROLE, status: 'Active' }
  })
  if (!nurse) {
    return res.status(400).json({ error: 'Vaccinator must be an active Nurse at ' + servicing })
  }
  const oldUses = doseUses(existing.dose, enc.vaccine)
  const newUses = doseUses(parsed.data.dose, enc.vaccine)
  const delta = newUses - oldUses
  try {
    const result = await prisma.$transaction(async tx => {
      let line: InventoryLine | null = null
      let movement: Movement | null = null
      if (delta > 0) {
        const consumed = await applyConsume(tx, enc.brand, servicing, delta)
        if ('error' in consumed) throw new Error(consumed.error)
        line = consumed.line
        movement = await tx.movement.create({
          data: {
            id: await nextId(tx.movement, 'MOV-', 4),
            date: parsed.data.date,
            time: parsed.data.time,
            by: req.user!.name,
            shift: consumed.line.shift,
            item: enc.brand,
            branch: servicing,
            type: 'Stock correction · dose',
            qty: consumed.vials,
            uses: delta,
            batch: consumed.line.batch,
            ref: enc.registry,
            reason: 'Corrected ' + req.params.day
          }
        })
      } else if (delta < 0) {
        const restored = await applyRestore(tx, enc.brand, servicing, existing.batch, -delta)
        if ('error' in restored) throw new Error(restored.error)
        line = restored.line
        movement = await tx.movement.create({
          data: {
            id: await nextId(tx.movement, 'MOV-', 4),
            date: parsed.data.date,
            time: parsed.data.time,
            by: req.user!.name,
            shift: restored.line.shift,
            item: enc.brand,
            branch: servicing,
            type: 'Stock correction · dose',
            qty: restored.vials,
            uses: delta,
            batch: existing.batch,
            ref: enc.registry,
            reason: 'Corrected ' + req.params.day
          }
        })
      }
      const updated = await tx.dose.update({
        where: { id: existing.id },
        data: {
          date: parsed.data.date,
          time: parsed.data.time,
          dose: parsed.data.dose,
          side: parsed.data.side,
          route: parsed.data.dose.includes('IM') ? 'IM' : 'ID',
          animalStatus: parsed.data.animalStatus,
          vaccinator: parsed.data.vaccinator,
          batch: line && delta > 0 ? line.batch : existing.batch
        }
      })
      await tx.encounter.update({ where: { id: enc.id }, data: { animalStatus: parsed.data.animalStatus } })
      return { updated, line, movement }
    })
    await audit(req, { module: 'Treatment', action: 'Corrected ' + req.params.day + ' · ' + enc.registry, record: enc.registry, branch: servicing })
    res.json({
      ...doseClient(result.updated),
      ...(result.line ? { line: inventoryClient(result.line), movement: movementClient(result.movement!) } : {})
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to correct dose'
    if (msg.startsWith('No usable') || msg.startsWith('Insufficient') || msg.startsWith('Cannot reverse')) {
      return res.status(409).json({ error: msg })
    }
    throw err
  }
})

type AutoDay0Extras = {
  dose?: ReturnType<typeof doseClient>
  line?: ReturnType<typeof inventoryClient>
  movement?: ReturnType<typeof movementClient>
  doseSkip?: 'pay'
  doseError?: string
}

async function autoDay0Extras(
  enc: Encounter,
  by: string,
  vaccinator?: string,
  day0?: { dose?: string; time?: string; side?: string; vaccinator?: string; batch?: string; animalStatus?: string }
): Promise<AutoDay0Extras> {
  try {
    return await prisma.$transaction(async tx => {
      const pays = await tx.payment.findMany({ where: { encounterId: enc.id } })
      const skip = autoDay0Skip(enc, pays)
      if (skip) return { doseSkip: skip === 'pay' ? 'pay' as const : undefined }
      const existing = await tx.dose.findFirst({ where: { encounterId: enc.id, day: 'D0' } })
      if (existing) return {}
      if (!day0) {
        const auto = await tryAutoDay0(tx, enc, pays, by, vaccinator)
        if ('skipped' in auto) return { doseSkip: auto.reason === 'pay' ? 'pay' as const : undefined }
        return {
          dose: doseClient(auto.created),
          line: inventoryClient(auto.consumed.line),
          movement: movementClient(auto.movement)
        }
      }
      const servicing = servicingBranch(enc)
      const nurse = await resolveVaccinator(tx, servicing, day0.vaccinator || vaccinator, by)
      if (!nurse) throw new Error('No Nurse at ' + servicing + ' · add an employee first')
      const result = await createDoseInTx(tx, enc, {
        day: 'D0',
        date: enc.date,
        time: day0.time || enc.time || new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
        dose: day0.dose || day0DoseOf(enc),
        side: day0.side === 'R' ? 'R' : 'L',
        animalStatus: day0.animalStatus === 'Lost/Stray' || day0.animalStatus === 'Dead' ? day0.animalStatus : 'Alive',
        vaccinator: nurse.name,
        batch: day0.batch || ''
      }, by)
      return {
        dose: doseClient(result.created),
        line: inventoryClient(result.consumed.line),
        movement: movementClient(result.movement)
      }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unable to record Day 0'
    if (msg.startsWith('No usable') || msg.startsWith('Insufficient') || msg.startsWith('Day is not') || msg.startsWith('No Nurse')) {
      return { doseError: msg }
    }
    throw err
  }
}

clinicalRouter.post('/notes', requirePage('notes'), async (req, res) => {
  const patientId = String(req.body.patientId || '')
  const encounterId = String(req.body.encounterId || '')
  if (!patientId) return res.status(400).json({ error: 'Select a patient' })
  if (!encounterId) return res.status(400).json({ error: 'Select the registry this SOAP belongs to' })
  const enc = await prisma.encounter.findUnique({ where: { id: encounterId } })
  if (!enc || enc.patientId !== patientId) return res.status(400).json({ error: 'SOAP must be tied to this visit registry' })
  if (!inScopeEncounter(req.user!, enc)) return res.status(403).json({ error: 'This is not your branch' })
  const created = await prisma.$transaction(async tx => {
    const id = await nextPrefixedId(tx, 'ProgressNote', 'PN-', 5)
    return tx.progressNote.create({
      data: {
        id,
        patientId,
        encounterId,
        date: String(req.body.date || clinicDate()),
        s: req.body.s || {},
        animal: String(req.body.animal || ''),
        o: req.body.o || {},
        a: req.body.a || {},
        p: req.body.p || {},
        staff: String(req.body.staff || req.user!.name),
        branch: servicingBranch(enc)
      }
    })
  })
  await audit(req, { module: 'Progress note', action: 'Progress note linked to ' + enc.registry, record: enc.registry, branch: created.branch })
  res.json(noteClient(created))
})

const SERVICE_PRICES: Record<string, number> = {
  'Anti-rabies vaccine': 750,
  'ERIG (serum)': 2600,
  'Booster dose': 750,
  'Tetanus Toxoid': 300,
  Speeda: 1500,
  'Hepatitis B': 1100,
  'Pneumococcal vaccine': 2500,
  'Flu Regular': 1600,
  'Flu Student': 1500,
  'Flu Senior-PWD': 1350
}

clinicalRouter.post('/payments', requirePage('payments'), async (req, res) => {
  const encounterId = String(req.body.encounterId || '')
  const enc = await prisma.encounter.findUnique({ where: { id: encounterId }, include: { patient: true } })
  if (!enc) return res.status(400).json({ error: 'Select the patient encounter' })
  if (!req.user!.allBranches && enc.branch !== req.user!.branchName && servicingBranch(enc) !== req.user!.branchName) {
    return res.status(403).json({ error: 'This is not your branch' })
  }
  const intent = req.body.intent === 'update' ? 'update' : 'collect'
  const booster = enc.booster
  const classification = booster ? 'Walk-in' : String(req.body.classification || enc.billing || enc.patient.classification)
  const free = !booster && (classification === 'PhilHealth' || classification === 'For PhilHealth')
  const date = String(req.body.date || clinicDate())
  const branch = String(req.body.branch || enc.branch)
  const remarks = String(req.body.remarks || '')
  const method = free ? (classification === 'PhilHealth' ? 'PhilHealth' : '—') : String(req.body.method || 'Cash')
  const reference = free ? '—' : String(req.body.reference || '—')
  const saved = await prisma.$transaction(async tx => {
    if (booster && enc.billing !== 'Walk-in') {
      await tx.encounter.update({ where: { id: enc.id }, data: { billing: 'Walk-in', rig: '', erig: blankErig } })
    }
    const pendings = await tx.payment.findMany({
      where: { encounterId: enc.id, status: 'Pending' },
      orderBy: { createdAt: 'asc' }
    })
    const txn = pendings[0]?.txn || (await tx.payment.findFirst({ where: { encounterId: enc.id, txn: { not: '' } }, orderBy: { createdAt: 'asc' } }))?.txn || await issueTxn(tx, branch, date)
    if (intent === 'collect') {
      const due = pendings.filter(p => Number(p.amount) > 0)
      const extras = (Array.isArray(req.body.lines) ? req.body.lines : []).map((line: { service?: string, qty?: number }) => {
        const service = String(line.service || '').replace(/ × \d+$/, '')
        const qty = Math.max(0, Number(line.qty) || 0)
        return { service, qty, price: SERVICE_PRICES[service] }
      }).filter(line => line.qty > 0 && line.price && !(booster && line.service === 'ERIG (serum)'))
      if (!due.length) {
        if (!enc.rer) throw new Error('Save the RER before collecting. The bill is not ready.')
        if (free) throw new Error('PhilHealth and For PhilHealth visits have no follow-up bill.')
        if (!extras.length) throw new Error('Add at least one service')
        const followTxn = await issueTxn(tx, branch, date)
        const rows: Payment[] = []
        for (const line of extras) {
          rows.push(await tx.payment.create({
            data: {
              id: await nextPrefixedId(tx, 'Payment', 'PAY-'),
              registry: enc.registry,
              encounterId: enc.id,
              patient: enc.patient.name,
              branch,
              date,
              service: line.service,
              classification,
              amount: line.price * line.qty,
              method,
              reference,
              status: 'Paid',
              remarks: remarks || 'Follow-up',
              txn: followTxn
            }
          }))
        }
        return rows
      }
      const keepNames = extras.map(line => line.service)
      const payRows = [...due]
      if (keepNames.length) {
        const drop = due.filter(p => !keepNames.includes(String(p.service).replace(/ × \d+$/, ''))).map(p => p.id)
        if (drop.length) {
          await tx.payment.deleteMany({ where: { id: { in: drop } } })
          for (let i = payRows.length - 1; i >= 0; i--) if (drop.includes(payRows[i].id)) payRows.splice(i, 1)
        }
        const have = payRows.map(p => String(p.service).replace(/ × \d+$/, ''))
        for (const line of extras) {
          const idx = have.indexOf(line.service)
          if (idx >= 0) {
            have[idx] = ''
            continue
          }
          payRows.push(await tx.payment.create({
            data: {
              id: await nextPrefixedId(tx, 'Payment', 'PAY-'),
              registry: enc.registry,
              encounterId: enc.id,
              patient: enc.patient.name,
              branch,
              date,
              service: line.service,
              classification,
              amount: line.price * line.qty,
              method: '—',
              reference: '—',
              status: 'Pending',
              remarks: remarks || 'Not yet paid',
              txn
            }
          }))
        }
      }
      if (!payRows.length) throw new Error('Add at least one service')
      const rows: Payment[] = []
      for (const row of payRows) {
        rows.push(await tx.payment.update({
          where: { id: row.id },
          data: { status: 'Paid', method, reference, date, branch, remarks: remarks || row.remarks }
        }))
      }
      return rows
    }
    const rawLines = Array.isArray(req.body.lines) && req.body.lines.length
      ? req.body.lines
      : [{ service: req.body.service || 'Anti-rabies vaccine', qty: 1 }]
    const lines = rawLines.map((line: { service?: string, qty?: number }) => {
      const service = String(line.service || '').replace(/ × \d+$/, '')
      const qty = Math.max(0, Number(line.qty) || 0)
      return { service, qty, price: SERVICE_PRICES[service] }
    }).filter(line => line.qty > 0 && line.price && !(booster && line.service === 'ERIG (serum)'))
    if (!free && !lines.length) throw new Error('Add at least one service')
    const bill = free ? [{ service: lines[0]?.service || 'Anti-rabies vaccine', qty: 1, price: 0 }] : lines
    const rows: Payment[] = []
    for (let i = 0; i < bill.length; i++) {
      const line = bill[i]
      const data = {
        registry: enc.registry,
        encounterId: enc.id,
        patient: enc.patient.name,
        branch,
        date,
        service: line.service,
        classification,
        amount: free ? 0 : line.price * line.qty,
        method: free ? method : '—',
        reference: '—',
        status: free ? 'Not billed' : 'Pending',
        remarks: remarks || 'Not yet paid',
        txn
      }
      if (pendings[i]) rows.push(await tx.payment.update({ where: { id: pendings[i].id }, data }))
      else rows.push(await tx.payment.create({ data: { id: await nextPrefixedId(tx, 'Payment', 'PAY-'), ...data } }))
    }
    const keep = new Set(rows.map(p => p.id))
    const drop = pendings.filter(p => !keep.has(p.id)).map(p => p.id)
    if (drop.length) await tx.payment.deleteMany({ where: { id: { in: drop } } })
    return rows
  }).catch(err => {
    const msg = err instanceof Error ? err.message : 'Unable to save the bill'
    if (msg.startsWith('Save the RER') || msg.startsWith('Add at least')) return { error: msg }
    throw err
  })
  if ('error' in saved) return res.status(400).json(saved)
  await audit(req, { module: 'Payment', action: intent === 'update' ? 'Pending bill updated' : free ? 'PhilHealth bill confirmed' : 'Admission bill paid', record: saved.map(p => p.id).join(', '), branch: saved[0].branch, newValue: saved.map(p => p.service + ' ' + p.amount).join(' · ') })
  const auto: Partial<AutoDay0Extras> = intent === 'collect' && enc.rer && !free ? await autoDay0Extras(enc, req.user!.name) : {}
  if (auto.dose) {
    await audit(req, { module: 'Treatment', action: 'Day 0 recorded after payment · ' + enc.registry, record: enc.registry, branch: servicingBranch(enc) })
  }
  res.json({ ...paymentClient(saved[0]), payments: saved.map(paymentClient), ...auto })
})

clinicalRouter.post('/referrals', requirePage('referrals'), async (req, res) => {
  const encounterId = String(req.body.encounterId || '')
  const enc = await prisma.encounter.findUnique({ where: { id: encounterId }, include: { patient: true } })
  if (!enc) return res.status(400).json({ error: 'Choose a case from a non-accredited branch and a different accredited receiving branch' })
  const from = enc.transferredTo || enc.branch
  const to = String(req.body.to || '')
  const [fromB, toB] = await Promise.all([
    prisma.branch.findUnique({ where: { name: from } }),
    prisma.branch.findUnique({ where: { name: to } })
  ])
  if (!fromB || !toB || fromB.accreditation === 'Accredited' || toB.accreditation !== 'Accredited' || from === to) {
    return res.status(400).json({ error: 'Choose a case from a non-accredited branch and a different accredited receiving branch' })
  }
  const created = await prisma.$transaction(async tx => {
    const id = await nextPrefixedId(tx, 'Referral', 'REF-')
    return tx.referral.create({
      data: {
        id,
        patient: enc.patient.name,
        patientId: enc.patientId,
        encounterId: enc.id,
        registry: enc.registry,
        originRegistry: enc.registry,
        from, to,
        date: String(req.body.date || clinicDate()),
        reason: String(req.body.reason || 'Continue PEP at PhilHealth-accredited branch'),
        treatment: 'In progress',
        classification: String(req.body.classification || 'PhilHealth'),
        status: 'Pending acceptance',
        remarks: String(req.body.remarks || '')
      }
    })
  })
  await audit(req, { module: 'Referral', action: 'Referral sent to ' + to, record: enc.registry, branch: from })
  res.json(referralClient(created))
})

clinicalRouter.post('/referrals/:id/accept', requirePage('referrals'), async (req, res) => {
  const ref = await prisma.referral.findUnique({ where: { id: req.params.id } })
  if (!ref) return res.status(404).json({ error: 'Referral not found' })
  if (ref.status === 'Accepted') return res.status(409).json({ error: 'Referral already accepted' })
  if (!req.user!.allBranches && ref.to !== req.user!.branchName) {
    return res.status(403).json({ error: 'Accept this referral at ' + ref.to })
  }
  const source = await prisma.encounter.findUnique({ where: { id: ref.encounterId } })
  if (!source) return res.status(404).json({ error: 'Source registry was not found' })
  const result = await prisma.$transaction(async tx => {
    const receivingRegistry = await issueRegistry(tx, ref.to, ref.date)
    const receivingId = await nextPrefixedId(tx, 'Encounter', 'ENC-R', 7)
    const receiving = await tx.encounter.create({
      data: receivingFrom(source, {
        id: receivingId,
        registry: receivingRegistry,
        branch: ref.to,
        date: ref.date,
        seriesStartDate: source.seriesStartDate || source.date,
        continuedFromEncounterId: source.id,
        originRegistry: source.registry,
        referredFrom: source.branch
      })
    })
    await tx.encounter.update({
      where: { id: source.id },
      data: { remark: 'Transferred', referredTo: ref.to, receivingRegistry, receivingEncounterId: receiving.id }
    })
    const updatedRef = await tx.referral.update({
      where: { id: ref.id },
      data: { status: 'Accepted', receivingRegistry, receivingEncounterId: receiving.id }
    })
    let refund: Refund | null = null
    if (ref.classification === 'PhilHealth') {
      const linkedDoses = await tx.dose.findMany({
        where: { encounterId: { in: [source.id, source.continuedFromEncounterId || '', source.receivingEncounterId || ''].filter(Boolean) } }
      })
      if (refundEligible(source, linkedDoses)) {
        const pays = await tx.payment.findMany({
          where: { registry: ref.registry, branch: ref.from, status: 'Paid', NOT: { classification: 'PhilHealth' } }
        })
        const pay = pays[0]
        const total = pays.reduce((s, p) => s + Number(p.amount || 0), 0)
        if (pay && total > 0) {
          const already = await tx.refund.findFirst({ where: { payment: { in: pays.map(p => p.id) } } })
          if (!already) {
            refund = await tx.refund.create({
              data: {
                id: await nextId(tx.refund, 'RFD-', 3),
                patient: ref.patient,
                payment: pay.id,
                branch: pay.branch,
                amount: total,
                reason: 'Reclassified for PhilHealth after referral to ' + ref.to,
                requested: clinicDate(),
                status: 'Pending'
              }
            })
          }
        }
      }
    }
    return { receiving, updatedRef, receivingRegistry, refund }
  })
  await audit(req, {
    module: 'Referral',
    action: 'Referral accepted · ' + source.registry + ' linked to ' + result.receivingRegistry,
    record: result.receivingRegistry,
    branch: ref.to
  })
  res.json({
    referral: referralClient(result.updatedRef),
    encounter: encounterClient(result.receiving),
    originId: source.id,
    receivingRegistry: result.receivingRegistry,
    refund: result.refund ? refundClient(result.refund) : null
  })
})

async function reclassifyWalkInInTx(
  tx: Prisma.TransactionClient,
  enc: Encounter,
  patientName: string,
  billing: 'PhilHealth' | 'For PhilHealth'
) {
  const doses = await tx.dose.findMany({
    where: { encounterId: { in: [enc.id, enc.continuedFromEncounterId || '', enc.receivingEncounterId || ''].filter(Boolean) } }
  })
  const eligible = refundEligible(enc, doses)
  const updated = await tx.encounter.update({
    where: { id: enc.id },
    data: { billing }
  })
  const pays = await tx.payment.findMany({ where: { encounterId: enc.id } })
  const refunds: Awaited<ReturnType<typeof tx.refund.create>>[] = []
  const label = billing
  for (const pay of pays) {
    if (pay.status === 'Pending' || (pay.classification === 'Walk-in' && pay.status === 'Not billed')) {
      await tx.payment.update({
        where: { id: pay.id },
        data: {
          classification: label,
          amount: 0,
          method: billing === 'PhilHealth' ? 'PhilHealth' : '—',
          reference: '—',
          status: 'Not billed',
          remarks: 'Reclassified to ' + label
        }
      })
    } else if (pay.status === 'Paid' && Number(pay.amount) > 0 && pay.classification !== 'PhilHealth' && pay.classification !== 'For PhilHealth') {
      await tx.payment.update({
        where: { id: pay.id },
        data: { remarks: [pay.remarks, 'Reclassified to ' + label + ' · original payment kept'].filter(Boolean).join(' · ') }
      })
    }
  }
  const paidWalkin = pays.filter(p => p.status === 'Paid' && Number(p.amount) > 0 && p.classification !== 'PhilHealth' && p.classification !== 'For PhilHealth')
  if (eligible && paidWalkin.length) {
    const already = await tx.refund.findFirst({ where: { payment: { in: paidWalkin.map(p => p.id) } } })
    if (!already) {
      refunds.push(await tx.refund.create({
        data: {
          id: await nextId(tx.refund, 'RFD-', 3),
          patient: patientName,
          payment: paidWalkin[0].id,
          branch: paidWalkin[0].branch,
          amount: paidWalkin.reduce((s, p) => s + Number(p.amount || 0), 0),
          reason: 'Reclassified to ' + label + ' at ' + enc.branch,
          requested: clinicDate(),
          status: 'Pending'
        }
      }))
    }
  }
  const payments = await tx.payment.findMany({ where: { encounterId: enc.id } })
  return { updated, refunds, eligible, payments }
}

function receivingFrom(source: Encounter, patch: {
  id: string
  registry: string
  branch: string
  date: string
  seriesStartDate: string
  continuedFromEncounterId: string
  originRegistry: string
  referredFrom: string
}) {
  return {
    id: patch.id,
    registry: patch.registry,
    patientId: source.patientId,
    branch: patch.branch,
    date: patch.date,
    time: source.time,
    chief: source.chief,
    animal: source.animal,
    animalOther: source.animalOther,
    biteType: source.biteType,
    pet: source.pet,
    vaccinated: source.vaccinated,
    stray: source.stray,
    owned: source.owned,
    owner: source.owner,
    biteDate: source.biteDate,
    biteTime: source.biteTime,
    side: source.side,
    site: source.site,
    place: source.place,
    washed: source.washed,
    tandok: source.tandok,
    wound: source.wound as object,
    category: source.category,
    booster: source.booster,
    preExp: source.preExp,
    vaccine: source.vaccine,
    brand: source.brand,
    regimen: source.regimen,
    history: source.history as object,
    bp: source.bp,
    weight: source.weight,
    temp: source.temp,
    consent: source.consent,
    consentBy: source.consentBy,
    tt: source.tt as object,
    rig: source.rig,
    erig: source.erig as object,
    pepEligible: source.pepEligible,
    stopAfter: source.stopAfter,
    animalStatus: source.animalStatus,
    progress: source.progress as object,
    doctor: source.doctor,
    remark: '',
    transferredTo: '',
    died: source.died,
    rer: source.rer,
    billing: source.billing,
    past: false,
    seriesStartDate: patch.seriesStartDate,
    continuedFromEncounterId: patch.continuedFromEncounterId,
    originRegistry: patch.originRegistry,
    referredFrom: patch.referredFrom,
    referredTo: '',
    receivingRegistry: '',
    receivingEncounterId: ''
  }
}

clinicalRouter.post('/encounters/:id/reclassify', requirePage('patients'), async (req, res) => {
  const enc = await prisma.encounter.findUnique({ where: { id: req.params.id }, include: { patient: true } })
  if (!enc) return res.status(404).json({ error: 'Admission not found' })
  if (!inScopeEncounter(req.user!, enc)) return res.status(403).json({ error: 'This is not your branch' })
  if (enc.booster) return res.status(400).json({ error: 'Booster is not covered by PhilHealth' })
  if (enc.billing !== 'Walk-in') return res.status(400).json({ error: 'Only walk-in visits can be reclassified to PhilHealth' })
  const branchRow = await prisma.branch.findUnique({ where: { name: enc.branch } })
  const billing = branchRow?.accreditation === 'Accredited' ? 'PhilHealth' : 'For PhilHealth'
  const result = await prisma.$transaction(async tx => {
    const patient = await tx.patient.update({
      where: { id: enc.patientId },
      data: { philhealth: true, classification: 'PhilHealth' }
    })
    const done = await reclassifyWalkInInTx(tx, enc, patient.name, billing)
    return { patient, ...done }
  })
  await audit(req, {
    module: 'Payment',
    action: 'Reclassified ' + enc.registry + ' to ' + billing + (result.refunds.length ? ' · refund requested' : result.eligible ? '' : ' · refund window closed'),
    record: enc.registry,
    branch: enc.branch
  })
  res.json({
    encounter: encounterClient(result.updated),
    patient: patientClient(result.patient),
    payments: result.payments.map(paymentClient),
    refunds: result.refunds.map(refundClient),
    refundEligible: result.eligible
  })
})

clinicalRouter.get('/audit', requirePage('audit'), async (req, res) => {
  const user = req.user!
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
  res.json({
    audit: (user.allBranches ? rows : rows.filter(a => a.branch === user.branchName)).map(publicAudit)
  })
})
