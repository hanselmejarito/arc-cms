// Client-provided package valuation; it is not a cash receipt or a claim approval.
export const PHILHEALTH_CATEGORY_III_PACKAGE = [
  { service: 'Anti-rabies vaccine', quantity: 3, unitValueCentavos: 85000 },
  { service: 'Tetanus Toxoid', quantity: 1, unitValueCentavos: 30000 },
  { service: 'ERIG (serum)', quantity: 1, unitValueCentavos: 260000 },
  { service: 'Medical supplies', quantity: 1, unitValueCentavos: 40000 }
] as const

export const PHILHEALTH_PACKAGE_TOTAL_CENTAVOS = PHILHEALTH_CATEGORY_III_PACKAGE.reduce(
  (total, item) => total + item.quantity * item.unitValueCentavos, 0
)

export function isPhilhealthCashFollowUp(day: string) {
  return ['D14', 'D21', 'D28'].includes(day)
}
