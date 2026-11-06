import { ApiRouter } from '../router.js'
import { requireAuth, servicingBranch } from '../auth.js'
import { canPage, clinicDate } from '../clinical.js'
import { prisma } from '../prisma.js'
import { readSignature } from '../signatureInput.js'
import { encounterClient, noteClient } from '../map.js'
import { z } from 'zod'

export const signatureCorrectionsRouter = new ApiRouter()
signatureCorrectionsRouter.use(requireAuth)

const schema = z.object({
  expectedImage: z.string().min(1).max(350000),
  image: z.string().min(1).max(350000),
  method: z.enum(['pen', 'upload']),
  signer: z.string().trim().min(1).max(150),
  reason: z.string().trim().min(1).max(500)
})

async function target(kind: string, id: string) {
  if (kind === 'note') {
    const note = await prisma.progressNote.findUnique({ where: { id }, include: { encounter: true } })
    return note ? { encounter: note.encounter, note } : null
  }
  if (kind === 'patient' || kind === 'doctor') {
    const encounter = await prisma.encounter.findUnique({ where: { id } })
    return encounter ? { encounter, note: null } : null
  }
  return null
}

function authorized(user: NonNullable<import('../router.js').ApiReq['user']>, kind: string, encounter: { branch: string; transferredTo: string }) {
  const page = kind === 'patient' ? 'exposure' : kind === 'doctor' ? 'treatments' : 'notes'
  return canPage(user.role, page) && (user.allBranches || encounter.branch === user.branchName || servicingBranch(encounter) === user.branchName)
}

signatureCorrectionsRouter.get('/signature-corrections/:kind/:id', async (req, res) => {
  const kind = String(req.params.kind), id = String(req.params.id)
  const found = await target(kind, id)
  if (!found) return res.status(404).json({ error: 'Record not found' })
  if (!authorized(req.user!, kind, found.encounter)) return res.status(403).json({ error: 'This role cannot access this record' })
  const rows = await prisma.signatureCorrection.findMany({ where: { kind, recordId: id }, orderBy: { createdAt: 'desc' } })
  return res.json(rows)
})

signatureCorrectionsRouter.post('/signature-corrections/:kind/:id', async (req, res) => {
  const kind = String(req.params.kind), id = String(req.params.id)
  const found = await target(kind, id)
  if (!found) return res.status(404).json({ error: 'Record not found' })
  if (!authorized(req.user!, kind, found.encounter)) return res.status(403).json({ error: 'This role cannot access this record' })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Enter the signer name, replacement signature and reason.' })
  let signature
  try { signature = readSignature(parsed.data.image, parsed.data.method) }
  catch { return res.status(400).json({ error: 'Choose a valid signature image.' }) }
  if (!signature) return res.status(400).json({ error: 'A replacement signature is required.' })
  const e = found.encounter, n = found.note
  const previousImage = kind === 'patient' ? e.consentSignature : kind === 'doctor' ? e.doctorSignature : n?.signature
  if (!previousImage) return res.status(409).json({ error: 'There is no saved signature to replace.' })
  if (previousImage !== parsed.data.expectedImage) return res.status(409).json({ error: 'The signature changed. Reload the record before trying again.' })
  if (previousImage === signature.image) return res.status(400).json({ error: 'Please provide a different signature.' })
  const previousSigner = kind === 'patient' ? e.consentBy : kind === 'doctor' ? e.doctor : n!.staff
  const previousMethod = kind === 'patient' ? null : kind === 'doctor' ? e.doctorSignatureMethod : n!.signatureMethod
  const previousSignedAt = kind === 'patient' ? e.consentSignedAt : kind === 'doctor' ? e.doctorSignedAt : n!.signedAt
  const previousRecordedBy = kind === 'patient' ? e.consentRecordedBy : kind === 'doctor' ? e.doctorRecordedBy : n!.recordedBy
  const now = new Date(), user = req.user!
  const result = await prisma.$transaction(async tx => {
    const updated = kind === 'patient'
      ? await tx.encounter.updateMany({ where: { id, consentSignature: previousImage }, data: { consentSignature: signature!.image, consentBy: parsed.data.signer, consentSignedAt: now, consentRecordedBy: user.id, consent: true } })
      : kind === 'doctor'
        ? await tx.encounter.updateMany({ where: { id, doctorSignature: previousImage }, data: { doctorSignature: signature!.image, doctor: parsed.data.signer, doctorSignatureMethod: signature!.method, doctorSignedAt: now, doctorRecordedBy: user.id } })
        : await tx.progressNote.updateMany({ where: { id, signature: previousImage }, data: { signature: signature!.image, staff: parsed.data.signer, signatureMethod: signature!.method, signedAt: now, recordedBy: user.id } })
    if (!updated.count) return null
    await tx.signatureCorrection.create({ data: {
      kind, recordId: id, encounterId: e.id, previousImage, previousSigner, previousMethod: previousMethod || null,
      previousSignedAt: previousSignedAt || null, previousRecordedBy: previousRecordedBy || null,
      newSigner: parsed.data.signer, newMethod: signature!.method, reason: parsed.data.reason,
      correctedById: user.id, correctedByName: user.name
    } })
    await tx.auditLog.create({ data: {
      userId: user.id, userName: user.name + ' (' + user.role + ')', module: 'Signature',
      action: kind + ' signature corrected', record: e.registry, oldValue: previousSigner,
      newValue: 'Corrected by ' + user.name + ' · ' + parsed.data.reason,
      time: clinicDate() + ' · ' + now.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }),
      branch: servicingBranch(e), device: req.userAgent
    } })
    return kind === 'note'
      ? { note: noteClient(await tx.progressNote.findUniqueOrThrow({ where: { id } })) }
      : { encounter: encounterClient(await tx.encounter.findUniqueOrThrow({ where: { id } })) }
  })
  if (!result) return res.status(409).json({ error: 'The signature changed. Reload the record before trying again.' })
  return res.json(result)
})