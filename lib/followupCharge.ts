import type { Encounter, Prisma } from '@prisma/client'
import { boosterServiceForBrand, isBoosterVaccineLine } from './billingPolicy.js'
import { isPhilhealthCashFollowUp } from './philhealthPackage.js'
import { issueTxn, nextPrefixedId } from './registry.js'

// This runs in the same transaction as dose recording. The shared lock also
// serializes collecting a follow-up payment before the dose is recorded.
export async function ensureFollowupCharge(tx: Prisma.TransactionClient, enc: Encounter, day: string, date: string) {
  if (day === 'D0') return null
  const cash = enc.billing === 'Walk-in' || enc.booster || enc.preExp
  const philhealthCash = !enc.booster && !enc.preExp && enc.category === 'III' && ['PhilHealth','For PhilHealth'].includes(enc.billing) && isPhilhealthCashFollowUp(day)
  if (!cash && !philhealthCash) return null
  const ids = [enc.id, enc.continuedFromEncounterId, enc.receivingEncounterId].filter(Boolean) as string[]
  const root = enc.continuedFromEncounterId || enc.id
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'followup:' + root}))`
  const existing = await tx.payment.findFirst({ where: { encounterId: { in: ids }, followUpDay: day } })
  if (existing) {
    const refunded = existing.status === 'Paid' && await tx.refund.findFirst({ where: { payment: existing.id, status: 'Refunded' }, select: { id: true } })
    return { payment: existing, requiresReview: existing.status === 'Review' || !!refunded }
  }
  const oldPaid = await tx.payment.findMany({ where: { encounterId: { in: ids }, followUpDay: null, status: 'Paid', classification: 'Walk-in', amount: { gt: 0 } }, select: { service: true } })
  const ambiguous = oldPaid.some(row => isBoosterVaccineLine(row.service))
  const patient = await tx.patient.findUniqueOrThrow({ where: { id: enc.patientId }, select: { name: true } })
  const service = boosterServiceForBrand(enc.brand) || 'Anti-rabies vaccine'
  const amount = service === 'Speeda' ? 1500 : 750
  const branch = enc.transferredTo || enc.branch
  const txn = await issueTxn(tx, branch, date)
  const payment = await tx.payment.create({ data: {
    id: await nextPrefixedId(tx, 'Payment', 'PAY-'), encounterId: enc.id, registry: enc.registry,
    patient: patient.name, branch, date, txn, service, classification: 'Walk-in',
    amount, unitPriceCentavos: amount * 100, quantity: 1, method: '—', reference: '—',
    status: ambiguous ? 'Review' : 'Pending', followUpDay: day,
    remarks: ambiguous ? 'Admin review: earlier ARV payment is not linked to a dose.' : 'Unpaid follow-up · ' + day
  } })
  return { payment, requiresReview: ambiguous }
}
