// Standalone (non-RER) services. These labels describe the service, not a diagnosis.
export const OTHER_TREATMENTS = ['ERIG', 'TT', 'Flu', 'Pneumococcal', 'Hepatitis B'] as const
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
  reference: string; branch: string; service: string; status: string; patient: { id: string; name: string };
  payment: { id: string; amountCentavos: number; method: string; externalReference: string; paymentDate: string }
}) {
  return {
    id: row.payment.id, registry: '', encounterId: '', patientId: row.patient.id, patient: row.patient.name,
    otherTreatmentStatus: row.status,
    branch: row.branch, date: row.payment.paymentDate, service: row.service,
    classification: 'Other treatment', amount: row.payment.amountCentavos / 100,
    method: row.payment.method, reference: row.payment.externalReference || '—',
    status: 'Paid', remarks: 'Other treatment · ' + row.reference, txn: row.reference
  }
}
