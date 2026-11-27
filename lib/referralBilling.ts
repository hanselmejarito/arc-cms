export const PHILHEALTH_VERIFICATION_PENDING = 'PhilHealth verification required'
export function receivingBilling(source: {category:string; booster:boolean; preExp:boolean; billing:string}, patient: {philhealth:boolean}, branch: {accreditation:string}, referral: {classification:string}) {
  if (referral.classification !== 'PhilHealth' || branch.accreditation !== 'Accredited' || source.category !== 'III' || source.booster || source.preExp) return 'Walk-in'
  return patient.philhealth ? 'PhilHealth' : PHILHEALTH_VERIFICATION_PENDING
}
