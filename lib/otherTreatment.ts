// Standalone (non-RER) services. These labels describe the service, not a diagnosis.
export const OTHER_TREATMENTS = ['ERIG', 'TT', 'Flu', 'Flu Regular', 'Flu Student', 'Flu Senior-PWD', 'Pneumococcal', 'Hepatitis B'] as const
export type OtherTreatmentService = typeof OTHER_TREATMENTS[number]

// References are separate from exposure/admission registry numbers.
// Sequence allocation must be performed atomically by the database transaction.
export function otherTreatmentReference(branchCode: string, year: number, sequence: number): string {
  if (!/^[A-Z]{3}$/.test(branchCode) || !Number.isInteger(year) || year < 2000 || year > 2099 || !Number.isSafeInteger(sequence) || sequence < 1)
    throw new Error('Invalid treatment reference components')
  return 'OT-' + branchCode + '-' + String(year).slice(-2) + '-' + String(sequence).padStart(4, '0')
}

export function isOtherTreatmentService(value: unknown): value is OtherTreatmentService {
  return typeof value === 'string' && (OTHER_TREATMENTS as readonly string[]).includes(value)
}

// A payment and administration are independent facts; neither implies the other.
export function otherTreatmentStatus(input: { administeredAt: Date | null; cancelledAt: Date | null; paidAt: Date | null }) {
  return {
    treatment: input.cancelledAt ? 'Cancelled' : input.administeredAt ? 'Given' : 'Pending',
    payment: input.paidAt ? 'Paid' : 'Pending'
  } as const
}
export function otherPaymentClient(row: {
  id?: string; visitId?: string | null; reference: string; branch: string; service: string; status: string; patient: { id: string; name: string };
  payment: { id: string; amountCentavos: number; method: string; externalReference: string; paymentDate: string; discountType?: string | null; discountCentavos?: number | null }
}) {
  return {
    id: row.payment.id, registry: '', encounterId: '', patientId: row.patient.id, patient: row.patient.name,
    otherTreatmentStatus: row.status,
    branch: row.branch, date: row.payment.paymentDate, service: row.service,
    classification: 'Other treatment', amount: row.payment.amountCentavos / 100, discountType: row.payment.discountType, discountCentavos: row.payment.discountCentavos,
    method: row.payment.method, reference: row.payment.externalReference || '—',
    status: 'Paid', remarks: 'Other treatment · ' + row.reference, txn: row.reference,
    otherTreatmentId: row.visitId ? row.id : undefined, otherTreatmentVisitId: row.visitId || null
  }
}

// Project a visit into one unpaid ledger entry without creating a payment record.
export function otherPendingClients(rows: Array<{ id: string; visitId: string | null; reference: string; patient: { id: string; name: string }; branch: string; date: string; service: string; status: string; priceCentavos: number | null; payment: unknown | null }>) {
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    if (!row.visitId) continue
    const group = groups.get(row.visitId) || []
    group.push(row); groups.set(row.visitId, group)
  }
  return Array.from(groups.values()).filter(group => group.every(row => row.status === 'Given' && !row.payment && row.priceCentavos != null)).map(group => {
    const ordered = [...group].sort((a, b) => a.reference.localeCompare(b.reference)), first = ordered[0]
    return { id: 'OT-PENDING-' + first.id, txn: first.reference, registry: '', encounterId: '', patientId: first.patient.id, patient: first.patient.name, otherTreatmentStatus: first.status,
      branch: first.branch, date: first.date, service: ordered.map(row => row.service).join(' + '), classification: 'Other treatment',
      amount: ordered.reduce((sum, row) => sum + (row.priceCentavos || 0), 0) / 100, method: '—', reference: '—', status: 'Pending',
      remarks: 'Other treatment · ' + first.reference, otherTreatmentId: first.id, otherTreatmentVisitId: first.visitId }
  })
}
