import type { Encounter, Payment, PrismaClient } from '@prisma/client'
import { servicingBranch } from './auth.js'
import { DAY_LABEL, NURSE_ROLE, protocolOf, visitNeedsPay, visitPaid } from './clinical.js'
import { nextId } from './ids.js'
import { applyConsume, doseUses } from './inventory.js'

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export type DoseInput = {
  day: string
  date: string
  time: string
  dose: string
  side: 'L' | 'R'
  animalStatus: 'Alive' | 'Lost/Stray' | 'Dead'
  vaccinator: string
  batch?: string
}

function clock() {
  return new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
}

export async function resolveVaccinator(tx: Tx, branch: string, name?: string, fallback?: string) {
  const nurses = await tx.employee.findMany({
    where: { branch, role: NURSE_ROLE, status: 'Active' },
    orderBy: { name: 'asc' }
  })
  const pick = (n?: string) => (n && nurses.find(e => e.name === n)) || null
  return pick(name) || pick(fallback) || nurses[0] || null
}

export function day0DoseOf(enc: Pick<Encounter, 'regimen'>) {
  return enc.regimen === 'IM' ? '1 vial IM' : '0.1 mL × 2 sites ID'
}

export function autoDay0Skip(enc: Encounter, pays: Payment[]) {
  if (!enc.rer || enc.died || enc.remark === 'Transferred') return 'no-pep'
  if (enc.continuedFromEncounterId) return 'receiving'
  if (!enc.preExp && (enc.category === 'I' || !enc.pepEligible)) return 'no-pep'
  if (visitNeedsPay(enc.billing) && !visitPaid(pays, enc.id)) return 'pay'
  return ''
}

export async function createDoseInTx(tx: Tx, enc: Encounter, input: DoseInput, by: string) {
  const protocol = protocolOf(enc)
  const k = protocol.days.findIndex(x => x[0] === input.day)
  if (k < 0) throw new Error('Day is not on this protocol')
  const next = protocol.days[k + 1]
  const servicing = servicingBranch(enc)
  const uses = doseUses(input.dose, enc.vaccine)
  const consumed = await applyConsume(tx, enc.brand, servicing, uses, input.batch || undefined)
  if ('error' in consumed) throw new Error(consumed.error)
  const created = await tx.dose.create({
    data: {
      id: enc.id + '-' + input.day,
      encounterId: enc.id,
      day: input.day,
      date: input.date,
      time: input.time,
      dose: input.dose,
      side: input.side,
      brand: enc.brand,
      batch: input.batch || consumed.line.batch,
      route: input.dose.includes('IM') ? 'IM' : 'ID',
      advised: next ? (DAY_LABEL[next[0]] || next[0]) + ' · ' + addDaysUtc(input.date, next[1] - protocol.days[k][1]) : 'Series complete',
      animalStatus: input.animalStatus,
      vaccinator: input.vaccinator,
      branch: servicing
    }
  })
  await tx.encounter.update({ where: { id: enc.id }, data: { animalStatus: input.animalStatus } })
  const movement = await tx.movement.create({
    data: {
      id: await nextId(tx.movement, 'MOV-', 4),
      date: input.date,
      time: input.time,
      by,
      shift: consumed.line.shift,
      item: enc.brand,
      branch: servicing,
      type: 'Stock Out · treatment',
      qty: consumed.vials,
      uses,
      batch: consumed.line.batch,
      ref: enc.registry,
      reason: 'Treatment usage'
    }
  })
  return { created, consumed, movement }
}

export async function tryAutoDay0(tx: Tx, enc: Encounter, pays: Payment[], by: string, vaccinator?: string) {
  const skip = autoDay0Skip(enc, pays)
  if (skip) return { skipped: true as const, reason: skip }
  const existing = await tx.dose.findFirst({ where: { encounterId: enc.id, day: 'D0' } })
  if (existing) return { skipped: true as const, reason: 'exists' }
  const servicing = servicingBranch(enc)
  const nurse = await resolveVaccinator(tx, servicing, vaccinator, by)
  if (!nurse) throw new Error('No Nurse / Staff at ' + servicing + ' · add an employee first')
  const side = enc.side === 'R' ? 'R' : 'L'
  const animalStatus = enc.animalStatus === 'Lost/Stray' || enc.animalStatus === 'Dead' ? enc.animalStatus : 'Alive'
  return createDoseInTx(tx, enc, {
    day: 'D0',
    date: enc.date,
    time: enc.time || clock(),
    dose: day0DoseOf(enc),
    side,
    animalStatus,
    vaccinator: nurse.name
  }, by)
}

function addDaysUtc(d: string, n: number) {
  const x = new Date(d.slice(0, 10) + 'T00:00:00Z')
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
