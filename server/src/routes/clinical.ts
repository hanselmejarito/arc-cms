import { Router } from 'express'
import { z } from 'zod'
import type { Encounter } from '@prisma/client'
import { prisma } from '../prisma.js'
import { audit, publicAudit } from '../audit.js'
import { canAccessBranch, requireAuth, requirePage, servicingBranch, type AuthedUser } from '../auth.js'
import {
  ALL_BRANCH_ROLES, HIGH_RISK_SITES, NURSE_ROLE, TODAY, ageFrom, blankErig, blankHistory,
  blankProgress, blankTt, canPage, caseInfo, fullName, protocolOf, samePerson, statusOf,
  visitNeedsPay, visitPaid
} from '../clinical.js'
import { createDoseInTx, tryAutoDay0 } from '../doses.js'
import { applyConsume, applyRestore, doseUses } from '../inventory.js'
import { nextId } from '../ids.js'
import {
  doseClient, encounterClient, inventoryClient, movementClient, noteClient, patientClient, patientDirectory,
  paymentClient, referralClient, refundClient
} from '../map.js'
import { issueRegistry, nextPrefixedId, peekRegistry } from '../registry.js'
import { workspaceExtras } from './ops.js'

export const clinicalRouter = Router()
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
  const [patients, encounters, doses, notes, payments, referrals, auditRows] = await Promise.all([
    prisma.patient.findMany({ orderBy: { name: 'asc' } }),
    prisma.encounter.findMany(),
    prisma.dose.findMany(),
    prisma.progressNote.findMany({ orderBy: { date: 'desc' } }),
    prisma.payment.findMany({ orderBy: { date: 'desc' } }),
    prisma.referral.findMany({ orderBy: { date: 'desc' } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 80 })
  ])
  const scopedEnc = encounters.filter(e => inScopeEncounter(user, e))
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
    payments: (user.allBranches || ['PO / PhilHealth Officer', 'Secretary', 'Cashier', 'Admin'].includes(user.role)
      ? payments.filter(p => user.allBranches || p.branch === user.branchName)
      : payments.filter(p => scopedIds.has(p.encounterId))).map(paymentClient),
    referrals: referrals.filter(r => user.allBranches || r.from === user.branchName || r.to === user.branchName).map(referralClient),
    audit: (user.allBranches || ALL_BRANCH_ROLES.includes(user.role) ? auditRows : auditRows.filter(a => a.branch === user.branchName)).map(publicAudit),
    ...extras
  })
})

clinicalRouter.get('/registry/next', requirePage('admissions'), async (req, res) => {
  const branch = String(req.query.branch || req.user!.branchName || 'Guimba')
  const date = String(req.query.date || TODAY)
  if (!req.user!.allBranches && branch !== req.user!.branchName) {
    return res.status(403).json({ error: 'Hindi ito ang branch mo' })
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
  contact: z.string().optional().default(''),
  address: z.string().optional().default(''),
  municipality: z.string().optional().default('Guimba'),
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
  if (!parsed.success) return res.status(400).json({ error: 'Last name, first name, birthday and gender are required' })
  const form = parsed.data
  if (!req.user!.allBranches && form.branch !== req.user!.branchName) {
    return res.status(403).json({ error: 'Hindi ito ang branch mo' })
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
        senior: form.senior || age >= 60,
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
  const updated = await prisma.patient.update({
    where: { id: existing.id },
    data: {
      ...parsed.data,
      name: fullName(next),
      age,
      senior: next.senior || age >= 60,
      classification: next.philhealth ? 'PhilHealth' : 'Walk-in'
    }
  })
  await audit(req, { module: 'Patients', action: 'Updated patient details', record: updated.name, branch: updated.branch })
  res.json(patientClient(updated))
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
    return res.status(403).json({ error: 'Hindi ito ang branch mo' })
  }
  const branchRow = await prisma.branch.findUnique({ where: { name: visit.branch } })
  if (!branchRow) return res.status(400).json({ error: 'Unknown branch' })

  let patient = parsed.data.patientId
    ? await prisma.patient.findUnique({ where: { id: parsed.data.patientId } })
    : null

  if (mode === 'New patient') {
    if (!parsed.data.patient) return res.status(400).json({ error: 'Last name, first name, birthday and gender are required' })
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
    const accredited = branchRow.accreditation === 'Accredited'
    const billing = accredited
      ? (patient.philhealth ? 'PhilHealth' : 'Walk-in')
      : (visit.billing || (patient.philhealth ? 'For PhilHealth' : 'Walk-in'))
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
        biteDate: visit.date,
        consentBy: patient.guardian ? patient.guardian.split(' (')[0] : patient.name,
        pepEligible: true,
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
        service: 'Anti-rabies vaccine dose',
        classification: billing,
        amount: 0,
        method: billing === 'PhilHealth' ? 'PhilHealth' : '—',
        reference: '—',
        status: billing === 'Walk-in' ? 'Pending' : 'Not billed',
        remarks: billing === 'For PhilHealth'
          ? 'Not billed at non-accredited branch · refer for PhilHealth'
          : billing === 'PhilHealth' ? '₱0 · PhilHealth' : 'Payment required before treatment'
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

clinicalRouter.patch('/encounters/:id', requirePage('exposure'), async (req, res) => {
  const existing = await prisma.encounter.findUnique({ where: { id: req.params.id } })
  if (!existing) return res.status(404).json({ error: 'Admission not found' })
  if (!inScopeEncounter(req.user!, existing)) return res.status(403).json({ error: 'Hindi ito ang branch mo' })
  const body = req.body as Record<string, unknown>
  if (body.site && HIGH_RISK_SITES.has(String(body.site))) body.category = 'III'
  if (body.category === 'III' && !body.booster && !body.preExp) body.rig = body.rig || 'ERIG'
  if (body.preExp) body.rig = ''
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
      let line = null
      let movement = null
      if (firstTt) {
        const consumed = await applyConsume(tx, 'Tetanus Toxoid', servicing, 1)
        if ('error' in consumed) throw new Error(consumed.error)
        line = consumed.line
        movement = await tx.movement.create({
          data: {
            id: await nextId(tx.movement, 'MOV-', 4),
            date: TODAY,
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
      return { updated, line, movement }
    })
    await audit(req, { module: 'RER', action: 'RER saved for ' + result.updated.registry, record: result.updated.registry, branch: servicing })
    const auto = await autoDay0Extras(result.updated, req.user!.name, String(body.vaccinator || ''))
    if (auto.dose) {
      await audit(req, { module: 'Treatment', action: 'Day 0 recorded with RER · ' + result.updated.registry, record: result.updated.registry, branch: servicing })
    }
    res.json({
      ...encounterClient(result.updated),
      ...(result.line ? { line: inventoryClient(result.line), movement: movementClient(result.movement!) } : {}),
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
  if (!inScopeEncounter(req.user!, enc)) return res.status(403).json({ error: 'Hindi ito ang branch mo' })
  const servicing = servicingBranch(enc)
  const nurse = await prisma.employee.findFirst({
    where: { name: parsed.data.vaccinator, branch: servicing, role: NURSE_ROLE, status: 'Active' }
  })
  if (!nurse) {
    return res.status(400).json({ error: 'Vaccinator must be an active Nurse / Staff at ' + servicing })
  }
  const doses = await prisma.dose.findMany({ where: { encounterId: { in: [enc.id, enc.continuedFromEncounterId || '', enc.receivingEncounterId || ''].filter(Boolean) } } })
  const info = caseInfo(enc, doses)
  if (['Incomplete', 'No PEP'].includes(info.status)) {
    return res.status(409).json({ error: 'This case is locked · no further doses' })
  }
  const pays = await prisma.payment.findMany({ where: { encounterId: enc.id } })
  if (visitNeedsPay(enc.billing) && !visitPaid(pays, enc.id)) {
    return res.status(409).json({ error: 'Collect walk-in payment before recording a dose' })
  }
  if (doses.some(d => d.day === parsed.data.day && d.encounterId === enc.id)) {
    return res.status(409).json({ error: 'This dose day is already recorded' })
  }
  const protocol = protocolOf(enc)
  const k = protocol.days.findIndex(x => x[0] === parsed.data.day)
  if (k < 0) return res.status(400).json({ error: 'Day is not on this protocol' })
  if (k > 0) {
    const prev = protocol.days[k - 1][0]
    const linked = new Set([enc.id, enc.continuedFromEncounterId, enc.receivingEncounterId].filter(Boolean) as string[])
    const all = await prisma.dose.findMany({ where: { encounterId: { in: [...linked] } } })
    if (!all.some(d => d.day === prev)) return res.status(409).json({ error: 'Record the previous dose first' })
  }
  try {
    const result = await prisma.$transaction(async tx => createDoseInTx(tx, enc, parsed.data, req.user!.name))
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
  if (!inScopeEncounter(req.user!, enc)) return res.status(403).json({ error: 'Hindi ito ang branch mo' })
  const servicing = servicingBranch(enc)
  const existing = await prisma.dose.findFirst({ where: { encounterId: enc.id, day: req.params.day } })
  if (!existing) return res.status(404).json({ error: 'Dose not found' })
  const nurse = await prisma.employee.findFirst({
    where: { name: parsed.data.vaccinator, branch: servicing, role: NURSE_ROLE, status: 'Active' }
  })
  if (!nurse) {
    return res.status(400).json({ error: 'Vaccinator must be an active Nurse / Staff at ' + servicing })
  }
  const oldUses = doseUses(existing.dose, enc.vaccine)
  const newUses = doseUses(parsed.data.dose, enc.vaccine)
  const delta = newUses - oldUses
  try {
    const result = await prisma.$transaction(async tx => {
      let line = null
      let movement = null
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

async function autoDay0Extras(enc: Encounter, by: string, vaccinator?: string): Promise<AutoDay0Extras> {
  try {
    return await prisma.$transaction(async tx => {
      const pays = await tx.payment.findMany({ where: { encounterId: enc.id } })
      const auto = await tryAutoDay0(tx, enc, pays, by, vaccinator)
      if ('skipped' in auto) return { doseSkip: auto.reason === 'pay' ? 'pay' as const : undefined }
      return {
        dose: doseClient(auto.created),
        line: inventoryClient(auto.consumed.line),
        movement: movementClient(auto.movement)
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
  if (!inScopeEncounter(req.user!, enc)) return res.status(403).json({ error: 'Hindi ito ang branch mo' })
  const created = await prisma.$transaction(async tx => {
    const id = await nextPrefixedId(tx, 'ProgressNote', 'PN-', 5)
    return tx.progressNote.create({
      data: {
        id,
        patientId,
        encounterId,
        date: String(req.body.date || TODAY),
        s: req.body.s || {},
        animal: String(req.body.animal || 'Alive'),
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

clinicalRouter.post('/payments', requirePage('payments'), async (req, res) => {
  const encounterId = String(req.body.encounterId || '')
  const enc = await prisma.encounter.findUnique({ where: { id: encounterId }, include: { patient: true } })
  if (!enc) return res.status(400).json({ error: 'Select the patient encounter' })
  if (!req.user!.allBranches && enc.branch !== req.user!.branchName && servicingBranch(enc) !== req.user!.branchName) {
    return res.status(403).json({ error: 'Hindi ito ang branch mo' })
  }
  const classification = String(req.body.classification || enc.billing || enc.patient.classification)
  const free = classification === 'PhilHealth' || classification === 'For PhilHealth'
  const created = await prisma.$transaction(async tx => {
    const id = await nextPrefixedId(tx, 'Payment', 'PAY-')
    return tx.payment.create({
      data: {
        id,
        registry: enc.registry,
        encounterId: enc.id,
        patient: enc.patient.name,
        branch: String(req.body.branch || enc.branch),
        date: String(req.body.date || TODAY),
        service: String(req.body.service || 'Anti-rabies vaccine dose'),
        classification,
        amount: free ? 0 : Number(req.body.amount || 0),
        method: free ? (classification === 'PhilHealth' ? 'PhilHealth' : '—') : String(req.body.method || 'Cash'),
        reference: free ? '—' : String(req.body.reference || '—'),
        status: free ? 'Not billed' : String(req.body.status || 'Paid'),
        remarks: String(req.body.remarks || '')
      }
    })
  })
  await audit(req, { module: 'Payment', action: 'Payment recorded', record: created.id, branch: created.branch })
  const auto = enc.rer ? await autoDay0Extras(enc, req.user!.name) : {}
  if (auto.dose) {
    await audit(req, { module: 'Treatment', action: 'Day 0 recorded after payment · ' + enc.registry, record: enc.registry, branch: servicingBranch(enc) })
  }
  res.json({ ...paymentClient(created), ...auto })
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
        date: String(req.body.date || TODAY),
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
    let refund = null
    if (ref.classification === 'PhilHealth') {
      const pay = await tx.payment.findFirst({
        where: { registry: ref.registry, branch: ref.from, status: 'Paid', NOT: { classification: 'PhilHealth' } }
      })
      if (pay) {
        const already = await tx.refund.findFirst({ where: { payment: pay.id } })
        if (!already) {
          refund = await tx.refund.create({
            data: {
              id: await nextId(tx.refund, 'RFD-', 3),
              patient: ref.patient,
              payment: pay.id,
              branch: pay.branch,
              amount: pay.amount,
              reason: 'Reclassified for PhilHealth after referral to ' + ref.to,
              requested: TODAY,
              status: 'Pending'
            }
          })
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

clinicalRouter.get('/audit', requirePage('audit'), async (req, res) => {
  const user = req.user!
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })
  res.json({
    audit: (user.allBranches ? rows : rows.filter(a => a.branch === user.branchName)).map(publicAudit)
  })
})
