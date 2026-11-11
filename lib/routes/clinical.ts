import { ApiRouter } from '../router.js'
import { z } from 'zod'
import type { Encounter, InventoryLine, Movement, Payment, Prisma, Refund } from '@prisma/client'
import { prisma } from '../prisma.js'
import { audit, publicAudit } from '../audit.js'
import { canAccessBranch, requireAuth, requireAny, requirePage, servicingBranch, type AuthedUser } from '../auth.js'
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
import { addsOtherOnlyServices, boosterServiceForBrand, isBoosterVaccineLine } from '../billingPolicy.js'
import { workspaceExtras } from './ops.js'
import { readPhoto } from '../photoInput.js'
import { readSignature } from '../signatureInput.js'
import { otherPaymentClient, otherPendingClients } from '../otherTreatment.js'

function optionalPhoto(body: unknown) {
  if (!body || typeof body !== 'object' || !('photo' in body)) return undefined
  return readPhoto((body as { photo: unknown }).photo)
}

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
  const otherPaid = (canPage(user.role, 'payments') || canPage(user.role, 'reports')) ? await prisma.otherTreatment.findMany({
    where: { ...(user.allBranches ? {} : { branch: user.branchName || '' }), payment: { isNot: null } },
    include: { patient: { select: { id: true, name: true } }, payment: true }
  }) : []
  const unpaidVisitRows = canPage(user.role, 'payments') ? await prisma.otherTreatment.findMany({
    where: { ...(user.allBranches ? {} : { branch: user.branchName || '' }), visitId: { not: null } },
    include: { patient: { select: { id: true, name: true } }, payment: true }, orderBy: { reference: 'asc' }
  }) : []
  const paidVisitIds = otherPaid.map(t => t.visitId).filter((id): id is string => !!id)
  const paidVisitServices = paidVisitIds.length ? await prisma.otherTreatment.findMany({ where: { visitId: { in: paidVisitIds } }, select: { visitId: true, service: true }, orderBy: { reference: 'asc' } }) : []
  const otherPending = otherPendingClients(unpaidVisitRows)
  const standalonePatientIds = user.allBranches ? new Set<string>() : new Set(
    (await prisma.otherTreatment.findMany({ where: { branch: user.branchName || '' }, select: { patientId: true }, distinct: ['patientId'] })).map(t => t.patientId)
  )
  const scopedEnc = encounters.filter(e => inScopeEncounter(user, e))
  const payments = await repairStaleOpenBills(scopedEnc, paymentRows)
  const scopedIds = new Set(scopedEnc.map(e => e.id))
  const lastByPatient = new Map<string, string>()
  for (const e of [...encounters].sort((a, b) => b.date.localeCompare(a.date))) {
    if (!lastByPatient.has(e.patientId)) lastByPatient.set(e.patientId, e.registry)
  }
  const patientRows = patients.map(p => {
    const hasScopedVisit = scopedEnc.some(e => e.patientId === p.id) || standalonePatientIds.has(p.id)
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
    payments: [...(user.allBranches || canPage(user.role, 'payments')
      ? payments.filter(p => user.allBranches || p.branch === user.branchName)
      : payments.filter(p => scopedIds.has(p.encounterId))).map(paymentClient),
        ...otherPaid.filter(t => t.payment !== null).map(t => otherPaymentClient({ ...t, service: t.visitId ? paidVisitServices.filter(x => x.visitId === t.visitId).map(x => x.service).join(' + ') : t.service, payment: t.payment! })), ...otherPending
      ],
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
  address: z.string().trim().min(1, 'Address is required'),
  municipality: z.string().trim().min(1, 'Municipality is required'),
  municipalityOther: z.string().optional().default(''),
  guardian: z.string().optional().default(''),
  senior: z.boolean().optional().default(false),
  pwd: z.boolean().optional().default(false),
  vetmed: z.boolean().optional().default(false),
  philhealth: z.boolean().optional().default(false),
  branch: z.string().min(1)
})

const hasPatientAddress = (p: { address?: string | null, municipality?: string | null, municipalityOther?: string | null }) =>
  !!(p.address?.trim() && p.municipality?.trim() && (p.municipality !== 'Others' || p.municipalityOther?.trim()))

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
  if (!parsed.success) return res.status(400).json({ error: 'Last name, first name, birthday, gender, cellphone, address and municipality are required. Specify the municipality when Others is selected.' })
  let photo: string | null | undefined
  try { photo = optionalPhoto(req.body) }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Choose a valid patient photo.' }) }
  const form = parsed.data
  if (!hasPatientAddress(form)) return res.status(400).json({ error: 'Address and municipality are required. Specify the municipality when Others is selected.' })
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
        classification: form.philhealth ? 'PhilHealth' : 'Walk-in',
        ...(photo ? { photo } : {})
      }
    })
  })
  await audit(req, { module: 'Patients', action: 'Created patient master record' + (photo ? ' · photo recorded' : ''), record: created.name, branch: created.branch })
  res.json(patientClient(created))
})

clinicalRouter.patch('/patients/:id', requirePage('patients'), async (req, res) => {
  const parsed = patientSchema.partial().extend({
    first: z.string().trim().min(1).optional(),
    last: z.string().trim().min(1).optional(),
    birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sex: z.enum(['Female', 'Male']).optional()
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter valid patient details, including address and municipality.' })
  let photo: string | null | undefined
  try { photo = optionalPhoto(req.body) }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Choose a valid patient photo.' }) }
  const existing = await prisma.patient.findUnique({ where: { id: req.params.id } })
  if (!existing) return res.status(404).json({ error: 'Patient not found' })
  const next = { ...existing, ...parsed.data }
  if (!hasPatientAddress(next)) return res.status(400).json({ error: 'Address and municipality are required. Specify the municipality when Others is selected.' })
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
        classification: next.philhealth ? 'PhilHealth' : 'Walk-in',
        ...(photo !== undefined ? { photo } : {})
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
  await audit(req, { module: 'Patients', action: 'Updated patient details' + (photo === undefined ? '' : photo ? ' · photo recorded' : ' · photo removed'), record: result.patient.name, branch: result.patient.branch })
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
  if (!parsed.success) return res.status(400).json({ error: 'Incomplete admission. Address and municipality are required for a new patient.' })
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

  let photo: string | null | undefined
  if (mode === 'New patient') {
    try { photo = optionalPhoto(req.body.patient) }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Choose a valid patient photo.' }) }
    if (!parsed.data.patient) return res.status(400).json({ error: 'Last name, first name, birthday, gender, cellphone, address and municipality are required. Specify the municipality when Others is selected.' })
    const form = parsed.data.patient
    if (!hasPatientAddress(form)) return res.status(400).json({ error: 'Address and municipality are required. Specify the municipality when Others is selected.' })
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

  if (patient && !hasPatientAddress(patient)) return res.status(400).json({ error: 'Update the patient address and municipality in their patient profile before creating a new admission.' })

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
          classification: (form.philhealth || forPH) ? 'PhilHealth' : 'Walk-in',
          ...(photo ? { photo } : {})
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

function openBillLines(enc: { billing: string, booster: boolean, preExp: boolean, category: string, brand: string }) {
  if (enc.booster) { const service = boosterServiceForBrand(enc.brand); return service ? [{ service, price: service === 'Speeda' ? 1500 : 750, status: 'Pending' as const, remarks: 'Not yet paid' }] : [] }
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
  if (enc.booster) {
    const vaccine = open.filter(p => isBoosterVaccineLine(p.service))
    if (!vaccine.length) return true
    if (vaccine.length > 1) return false
    const row = vaccine[0]
    if (row.service === specs[0].service && row.status === 'Pending' && Number(row.amount) > 0) return false
    const previousDefault = row.service === 'Speeda' ? 1500 : row.service === 'Not set yet' ? 0 : 750
    const unchangedDefault = Number(row.amount) === previousDefault || (row.status === 'Not billed' && Number(row.amount) === 0)
    return unchangedDefault && !openBillsMatch(vaccine, specs)
  }
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
  if (updated.booster) {
    const vaccine = open.filter(p => isBoosterVaccineLine(p.service))
    if (vaccine.length > 1) return rows
    const spec = specs[0]
    const existingVaccine = vaccine[0]
    const data = { registry: updated.registry, encounterId: updated.id, patient: patientName || rows[0]?.patient || '', branch: updated.branch, date: updated.date, service: spec.service, classification: 'Walk-in', amount: spec.price, method: '—', reference: '—', status: 'Pending', remarks: spec.remarks, txn }
    const saved = existingVaccine ? await tx.payment.update({ where: { id: existingVaccine.id }, data: { service: data.service, amount: data.amount, classification: data.classification, status: data.status } }) : await tx.payment.create({ data: { id: await nextPrefixedId(tx, 'Payment', 'PAY-'), ...data } })
    return [...rows.filter(p => p.id !== existingVaccine?.id), saved]
  }
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
  const day0Input = body.day0 as { given?: boolean; signature?: unknown; signatureMethod?: unknown } | undefined
  if (day0Input?.signature) {
    if (!day0Input.given) return res.status(400).json({ error: 'Record Day 0 to save the vaccinator signature.' })
    try { readSignature(day0Input.signature, day0Input.signatureMethod) } catch { return res.status(400).json({ error: 'Choose a valid vaccinator signature.' }) }
  }
  if (body.rer === true && (body.booster === true || (body.booster !== false && existing.booster)) && !boosterServiceForBrand(typeof body.brand === 'string' ? body.brand : existing.brand)) return res.status(400).json({ error: 'Select the ARV brand before saving a booster RER.' })
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
  // Signature is captured once for this admission; subsequent edits cannot replace it.
  if (body.consentSignature != null && body.consentSignature !== '' && body.consentSignature !== existing.consentSignature) {
    if (existing.consentSignature) return res.status(409).json({ error: 'A signature is already saved for this admission.' })
    const signature = body.consentSignature
    if (typeof signature !== 'string' || signature.length > 350000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(signature)) {
      return res.status(400).json({ error: 'A valid PNG signature is required.' })
    }
    const bytes = Buffer.from(signature.slice('data:image/png;base64,'.length), 'base64')
    if (bytes.length < 100 || bytes.length > 250000 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return res.status(400).json({ error: 'A valid PNG signature is required.' })
    }
    if (typeof body.consentBy !== 'string' || !body.consentBy.trim()) {
      return res.status(400).json({ error: 'Enter the signer name.' })
    }
  }
  if (existing.consentSignature && (body.consent === false || ('consentBy' in body && body.consentBy !== existing.consentBy))) {
    return res.status(409).json({ error: 'The signer and signed status cannot be changed after capture.' })
  }
  const signatureToSave = !existing.consentSignature && typeof body.consentSignature === 'string' && body.consentSignature
    ? body.consentSignature : null
  const doctorSignatureToSave = !existing.doctorSignature && typeof body.doctorSignature === 'string' && body.doctorSignature
    ? body.doctorSignature : null
  if (body.doctorSignature && body.doctorSignature !== existing.doctorSignature) {
    if (existing.doctorSignature) return res.status(409).json({ error: 'A doctor signature is already saved for this admission.' })
    const signature = body.doctorSignature
    if (typeof signature !== 'string' || signature.length > 350000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(signature))
      return res.status(400).json({ error: 'A valid PNG signature is required.' })
    const bytes = Buffer.from(signature.slice('data:image/png;base64,'.length), 'base64')
    if (bytes.length < 100 || bytes.length > 250000 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      return res.status(400).json({ error: 'A valid PNG signature is required.' })
    if (typeof body.doctor !== 'string' || !body.doctor.trim())
      return res.status(400).json({ error: 'Enter the doctor name.' })
    if (body.doctorSignatureMethod !== 'upload' && body.doctorSignatureMethod !== 'pen')
      return res.status(400).json({ error: 'Select a valid signature method.' })
  }
  if (existing.doctorSignature && 'doctor' in body && body.doctor !== existing.doctor)
    return res.status(409).json({ error: 'The doctor name cannot be changed after a signature is saved.' })
  const allowed = [
    'chief' , 'animal', 'animalOther', 'biteType', 'pet', 'vaccinated', 'stray', 'owned', 'owner',
    'biteDate', 'biteTime', 'side', 'site', 'place', 'washed', 'tandok', 'wound', 'category',
    'booster', 'preExp', 'vaccine', 'brand', 'regimen', 'history', 'bp', 'weight', 'temp',
    'consent', 'consentBy', 'tt', 'rig', 'erig', 'pepEligible', 'animalStatus', 'progress',
    'doctor', 'rer', 'billing'
  ]
  const data: Record<string, unknown> = {}
  for (const k of allowed) if (k in body) data[k] = body[k]
  if (signatureToSave) {
    data.consent = true
    data.consentSignature = signatureToSave
    data.consentSignedAt = new Date()
    data.consentRecordedBy = req.user!.id
  }
  if (doctorSignatureToSave) {
    data.doctorSignature = doctorSignatureToSave
    data.doctorSignatureMethod = body.doctorSignatureMethod
    data.doctorSignedAt = new Date()
    data.doctorRecordedBy = req.user!.id
  }
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
      if (signatureToSave || doctorSignatureToSave) {
        const claimed = await tx.encounter.updateMany({ where: { id: existing.id, ...(signatureToSave ? { consentSignature: null } : {}), ...(doctorSignatureToSave ? { doctorSignature: null } : {}) }, data })
        if (!claimed.count) throw new Error('A signature was already saved for this admission. Reload the record.')
      }
      const updated = signatureToSave || doctorSignatureToSave
        ? await tx.encounter.findUniqueOrThrow({ where: { id: existing.id } })
        : await tx.encounter.update({ where: { id: existing.id }, data })
      const patient = await tx.patient.findUnique({ where: { id: updated.patientId } })
      const payments = await syncOpenBill(tx, existing, updated, patient?.name || '')
      return { updated, line, movement, payments }
    })
    await audit(req, { module: 'RER', action: 'RER saved for ' + result.updated.registry, record: result.updated.registry, branch: servicing })
    if (signatureToSave) await audit(req, { module: 'Consent', action: 'Admission signature recorded', record: result.updated.registry, branch: servicing })
    if (doctorSignatureToSave) await audit(req, { module: 'RER', action: 'Doctor signature recorded (' + body.doctorSignatureMethod + ')', record: result.updated.registry, branch: servicing })
    const day0 = body.day0 as { given?: boolean; dose?: string; time?: string; side?: string; vaccinator?: string; batch?: string; animalStatus?: string; signature?: string; signatureMethod?: 'pen' | 'upload' } | undefined
    const vaccinator = String(day0?.vaccinator || body.vaccinator || '')
    const auto = day0?.given === true
      ? await autoDay0Extras(result.updated, req.user!.name, vaccinator, day0, req.user!.id)
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
  batch: z.string().optional().default(''),
  signature: z.string().max(350000).optional(),
  signatureMethod: z.enum(['pen','upload']).optional()
})

clinicalRouter.post('/encounters/:id/doses', requirePage('treatments'), async (req, res) => {
  const parsed = doseSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Incomplete dose' })
  let doseSignature: ReturnType<typeof readSignature>
  try { doseSignature = readSignature(parsed.data.signature, parsed.data.signatureMethod) } catch { return res.status(400).json({ error: 'Choose a valid vaccinator signature.' }) }
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
    const result = await prisma.$transaction(async tx => createDoseInTx(tx, enc, { ...parsed.data, ...(doseSignature ? { signature: doseSignature.image, signatureMethod: doseSignature.method as 'pen' | 'upload', recordedBy: req.user!.id } : {}) }, req.user!.name, doses))
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

clinicalRouter.post('/encounters/:id/doses/:day/signature', requireAny('exposure', 'treatments'), async (req, res) => {
  const enc = await prisma.encounter.findUnique({ where: { id: req.params.id } })
  if (!enc) return res.status(404).json({ error: 'Admission not found.' })
  const existing = await prisma.dose.findFirst({ where: { encounterId: enc.id, day: req.params.day } })
  if (!existing) return res.status(404).json({ error: 'Record the dose first.' })
  if (!req.user!.allBranches && existing.branch !== req.user!.branchName) return res.status(403).json({ error: 'This is not your branch.' })
  const parsed = z.object({ image: z.string().min(1).max(350000), method: z.enum(['pen','upload']), expectedImage: z.string().max(350000).nullable(), reason: z.string().trim().max(500).default('') }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid signature.' })
  let signature
  try { signature = readSignature(parsed.data.image, parsed.data.method) } catch { return res.status(400).json({ error: 'Choose a valid signature image.' }) }
  if (!signature) return res.status(400).json({ error: 'Enter a signature.' })
  if ((existing.signature || null) !== parsed.data.expectedImage) return res.status(409).json({ error: 'The signature changed. Reload and try again.' })
  if (existing.signature && !parsed.data.reason) return res.status(400).json({ error: 'Enter a reason for replacing the signature.' })
  if (existing.signature === signature.image) return res.status(400).json({ error: 'Choose a different signature.' })
  const user = req.user!, time = new Date()
  const result = await prisma.$transaction(async tx => {
    const changed = await tx.dose.updateMany({ where: { id: existing.id, signature: existing.signature, vaccinator: existing.vaccinator }, data: { signature: signature!.image, signatureMethod: signature!.method, signedAt: time, recordedBy: user.id } })
    if (!changed.count) return null
    if (existing.signature) await tx.signatureCorrection.create({ data: { kind: 'vaccinator', recordId: existing.id, encounterId: enc.id, previousImage: existing.signature, previousSigner: existing.vaccinator, previousMethod: existing.signatureMethod, previousSignedAt: existing.signedAt, previousRecordedBy: existing.recordedBy, newSigner: existing.vaccinator, newMethod: signature!.method, reason: parsed.data.reason, correctedById: user.id, correctedByName: user.name } })
    await tx.auditLog.create({ data: { userId: user.id, userName: user.name + ' (' + user.role + ')', module: 'Signature', action: existing.signature ? 'Vaccinator signature corrected' : 'Vaccinator signature recorded', record: enc.registry + ' · ' + existing.day, branch: existing.branch, oldValue: '', newValue: existing.signature ? parsed.data.reason : 'Signature recorded', time: clinicDate() + ' · ' + time.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }), device: req.userAgent } })
    return tx.dose.findUniqueOrThrow({ where: { id: existing.id } })
  })
  if (!result) return res.status(409).json({ error: 'The signature or vaccinator changed. Reload and try again.' })
  return res.json(doseClient(result))
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
  if (parsed.data.signature) return res.status(400).json({ error: 'Use the signature correction controls for a recorded dose.' })
  if (existing.signature && existing.vaccinator !== parsed.data.vaccinator) return res.status(409).json({ error: 'The vaccinator cannot be changed while a signature is recorded.' })
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
  day0?: { dose?: string; time?: string; side?: string; vaccinator?: string; batch?: string; animalStatus?: string; signature?: string; signatureMethod?: 'pen' | 'upload' },
  recordedBy?: string
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
      if (day0.signature && nurse.name !== day0.vaccinator) throw new Error('No Nurse matching the selected vaccinator at ' + servicing)
      const signature = day0.signature ? readSignature(day0.signature, day0.signatureMethod) : null
      const result = await createDoseInTx(tx, enc, {
        ...(signature ? { signature: signature.image, signatureMethod: signature.method as 'pen' | 'upload', recordedBy } : {}),
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
  let signature: ReturnType<typeof readSignature>
  try { signature = readSignature(req.body.signature, req.body.signatureMethod) }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid signature.' }) }
  const staff = String(req.body.staff || req.user!.name).trim()
  if (signature && !staff) return res.status(400).json({ error: 'Select the signer name.' })
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
        staff,
        ...(signature ? { signature: signature.image, signatureMethod: signature.method, signedAt: new Date(), recordedBy: req.user!.id } : {}),
        branch: servicingBranch(enc)
      }
    })
  })
  await audit(req, { module: 'Progress note', action: 'Progress note linked to ' + enc.registry + (signature ? ' · signature recorded (' + signature.method + ')' : ''), record: enc.registry, branch: created.branch })
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
  Flu: 1600,
  'Flu Regular': 1600,
  'Flu Student': 1500,
  'Flu Senior-PWD': 1350
}

const rerPriceAdjustmentSchema = z.object({
  reason: z.string().trim().max(500).optional().default(''),
  discountType: z.enum(['Senior','PWD']).optional(),
  items: z.array(z.object({ service: z.string().trim().min(1), qty: z.literal(1), unitPriceCentavos: z.number().int().positive().max(100000000), pendingPaymentId: z.string().min(1).optional(), expectedAmountCentavos: z.number().int().nonnegative().optional() })).min(1).max(25)
}).refine(x => new Set(x.items.map(i => i.pendingPaymentId).filter(Boolean)).size === x.items.filter(i => i.pendingPaymentId).length, 'Duplicate payment line.')

clinicalRouter.post('/payments', requirePage('payments'), async (req, res) => {
  const encounterId = String(req.body.encounterId || '')
  const enc = await prisma.encounter.findUnique({ where: { id: encounterId }, include: { patient: true } })
  if (!enc) return res.status(400).json({ error: 'Select the patient encounter' })
  if (!req.user!.allBranches && enc.branch !== req.user!.branchName && servicingBranch(enc) !== req.user!.branchName) {
    return res.status(403).json({ error: 'This is not your branch' })
  }
  if (enc.booster && !boosterServiceForBrand(enc.brand)) return res.status(400).json({ error: 'Select the ARV brand in the RER before collecting a booster payment.' })
  const intent = req.body.intent === 'update' ? 'update' : 'collect'
  const booster = enc.booster
  const classification = booster ? 'Walk-in' : String(req.body.classification || enc.billing || enc.patient.classification)
  const free = !booster && (classification === 'PhilHealth' || classification === 'For PhilHealth')
  const date = String(req.body.date || clinicDate())
  const branch = String(req.body.branch || enc.branch)
  const remarks = String(req.body.remarks || '')
  const method = free ? (classification === 'PhilHealth' ? 'PhilHealth' : '—') : String(req.body.method || 'Cash')
  const reference = free ? '—' : String(req.body.reference || '—')
  const priceInput = req.body.priceAdjustment == null ? null : rerPriceAdjustmentSchema.safeParse(req.body.priceAdjustment)
  if (priceInput && !priceInput.success) return res.status(400).json({ error: 'Enter a valid price and quantity for every service.' })
  if (priceInput && (intent !== 'collect' || free)) return res.status(400).json({ error: 'Custom prices are available when collecting a paid bill.' })
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rer-payment:' + enc.id}))`
    if (booster && enc.billing !== 'Walk-in') {
      await tx.encounter.update({ where: { id: enc.id }, data: { billing: 'Walk-in', rig: '', erig: blankErig } })
    }
    const pendings = await tx.payment.findMany({
      where: { encounterId: enc.id, status: 'Pending' },
      orderBy: { createdAt: 'asc' }
    })
    const requestedLines = Array.isArray(req.body.lines) ? req.body.lines : req.body.service ? [{ service: req.body.service, qty: 1 }] : []
    const requestedVaccine = (requestedLines as Array<{ service?: unknown; qty?: unknown }>).filter(line => Number(line.qty) > 0 && isBoosterVaccineLine(String(line.service || '')))
    if (booster && intent === 'collect' && pendings.filter(p => isBoosterVaccineLine(p.service) && Number(p.amount) > 0).length > 1) throw new Error('Review duplicate ARV lines on the booster bill before payment.')
    if (booster && pendings.some(p => p.service === 'ERIG (serum)' && Number(p.amount) > 0) && (intent === 'collect' || requestedLines.some(line => String((line as { service?: unknown }).service || '') === 'ERIG (serum)'))) throw new Error('Review the existing ERIG line on the booster bill before payment.')
    if (booster && ((requestedLines.length > 0 && requestedVaccine.length !== 1) || requestedVaccine.some(line => String(line.service || '').split(' × ')[0] !== boosterServiceForBrand(enc.brand)))) throw new Error('Use the ARV charge for the selected booster brand.')
    if (booster && intent === 'collect' && pendings.some(p => isBoosterVaccineLine(p.service) && Number(p.amount) > 0 && p.service !== boosterServiceForBrand(enc.brand))) throw new Error('The booster bill does not match the selected ARV brand. Reload and review it before payment.')
    if (booster && intent === 'collect' && pendings.some(p => isBoosterVaccineLine(p.service) && Number(p.amount) > 0 && p.service === boosterServiceForBrand(enc.brand) && !Number.isInteger(Number(p.amount) / SERVICE_PRICES[p.service]))) throw new Error('Review the existing booster amount before payment.')
    if (addsOtherOnlyServices(requestedLines as Array<{ service?: unknown; qty?: unknown }>, pendings, SERVICE_PRICES)) throw new Error('Record Flu, Hepatitis B and Pneumococcal in Other Treatments.')
    const txn = pendings[0]?.txn || (await tx.payment.findFirst({ where: { encounterId: enc.id, txn: { not: '' } }, orderBy: { createdAt: 'asc' } }))?.txn || await issueTxn(tx, branch, date)
    if (intent === 'collect' && priceInput?.success) {
      if (!enc.rer) throw new Error('Save the RER before collecting. The bill is not ready.')
      const due = pendings.filter(p => Number(p.amount) > 0)
      const items = priceInput.data.items
      if (priceInput.data.discountType && items.some(item => item.service === 'Flu Senior-PWD' || item.service === 'Flu Student')) throw new Error('Use Flu for a Senior/PWD discount; legacy or student prices need review.')
      if (!Array.isArray(req.body.lines) || req.body.lines.length !== items.length || items.some((item, i) => { const source = req.body.lines as Array<{ service?: unknown; qty?: unknown }>; return String(source[i]?.service || '').replace(/ × \d+$/, '') !== item.service || Number(source[i]?.qty) !== item.qty })) throw new Error('The bill changed. Reload and try again.')
      if (addsOtherOnlyServices(items, pendings, SERVICE_PRICES)) throw new Error('Record Flu, Hepatitis B and Pneumococcal in Other Treatments.')
      const current = new Map(due.map(row => [row.id, row]))
      const supplied = items.filter(item => item.pendingPaymentId)
      if (supplied.length !== due.length || supplied.some(item => !current.has(item.pendingPaymentId!))) throw new Error('The bill changed. Reload and try again.')
      const additional = new Set<string>(), changed: string[] = []
      for (const item of items) {
        if (!SERVICE_PRICES[item.service] || (booster && item.service === 'ERIG (serum)')) throw new Error('Select a valid RER service.')
        const lineAmount = Math.round(item.unitPriceCentavos * item.qty)
        if (!Number.isSafeInteger(lineAmount) || lineAmount <= 0 || lineAmount > 100000000) throw new Error('Enter a valid price and quantity for every service.')
        const existing = item.pendingPaymentId ? current.get(item.pendingPaymentId) : undefined
        if (existing) {
          const oldCents = Math.round(Number(existing.amount) * 100)
          const oldQty = 1
          if (item.expectedAmountCentavos !== oldCents || existing.service.replace(/ × \d+$/, '') !== item.service || item.qty !== oldQty) throw new Error('The bill changed. Reload and try again.')
          const originalUnit = oldCents
          if (item.unitPriceCentavos === originalUnit && lineAmount !== oldCents) throw new Error('The bill changed. Reload and review the quantity and price.')
          if (item.unitPriceCentavos !== originalUnit) changed.push(item.service + ': ' + originalUnit + ' → ' + item.unitPriceCentavos)
        } else {
          if (item.pendingPaymentId || item.expectedAmountCentavos != null || due.some(row => row.service === item.service) || additional.has(item.service)) throw new Error('The bill changed. Reload and try again.')
          additional.add(item.service)
          const defaultUnit = SERVICE_PRICES[item.service] * 100
          if (item.unitPriceCentavos !== defaultUnit) changed.push(item.service + ': ' + defaultUnit + ' → ' + item.unitPriceCentavos)
        }
      }
      if (changed.length && !priceInput.data.reason) throw new Error('Enter a reason for the price correction.')
      const txnForPayment = due.length ? txn : await issueTxn(tx, branch, date)
      const paidRows: Payment[] = []
      let accumulatedGross = 0
      for (const item of items) {
        const grossCentavos = Math.round(item.unitPriceCentavos * item.qty)
        const discountCentavos = priceInput.data.discountType ? Math.round((accumulatedGross + grossCentavos) * 0.2) - Math.round(accumulatedGross * 0.2) : 0
        accumulatedGross += grossCentavos
        const amount = (grossCentavos - discountCentavos) / 100
        const discountType = priceInput.data.discountType || null
        const existing = item.pendingPaymentId ? current.get(item.pendingPaymentId) : undefined
        if (existing) {
          const claim = await tx.payment.updateMany({ where: { id: existing.id, status: 'Pending', amount: existing.amount }, data: { amount, unitPriceCentavos: item.unitPriceCentavos, quantity: item.qty, discountType, discountCentavos, status: 'Paid', method, reference, date, branch, remarks: remarks || existing.remarks } })
          if (!claim.count) throw new Error('The bill changed. Reload and try again.')
          paidRows.push(await tx.payment.findUniqueOrThrow({ where: { id: existing.id } }))
        } else {
          paidRows.push(await tx.payment.create({ data: { id: await nextPrefixedId(tx, 'Payment', 'PAY-'), registry: enc.registry, encounterId: enc.id, patient: enc.patient.name, branch, date, service: item.service, classification, amount, unitPriceCentavos: item.unitPriceCentavos, quantity: item.qty, discountType, discountCentavos, method, reference, status: 'Paid', remarks: remarks || 'Follow-up', txn: txnForPayment } }))
        }
      }
      if (changed.length) await tx.auditLog.create({ data: { userId: req.user!.id, userName: req.user!.name + ' (' + req.user!.role + ')', module: 'Payment', action: 'RER payment prices corrected', record: txnForPayment, branch, oldValue: 'Price changes in centavos', newValue: changed.join(' · ') + ' · Reason: ' + priceInput.data.reason, time: clinicDate() + ' · ' + new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }), device: req.userAgent } })
      return paidRows
    }
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
    if (msg.startsWith('Save the RER') || msg.startsWith('Add at least') || msg.startsWith('Record Flu,') || msg.startsWith('Use the ARV charge') || msg.startsWith('Review duplicate ARV') || msg.startsWith('Review the existing ERIG') || msg.startsWith('The booster bill does not match') || msg.startsWith('Review the existing booster amount') || msg.startsWith('The bill changed') || msg.startsWith('Select a valid RER service') || msg.startsWith('Enter a valid price') || msg.startsWith('Enter a reason for the price correction') || msg.startsWith('Use Flu')) return { error: msg }
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
