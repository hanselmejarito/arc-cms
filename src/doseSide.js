export const TWO_SITE_ID = '0.1 mL × 2 sites ID'
export function sideForDoseChange(previousDose, nextDose, previousSide) {
  if (nextDose === TWO_SITE_ID) return 'L/R'
  return previousDose === nextDose && (previousSide === 'L' || previousSide === 'R') ? previousSide : ''
}
export function validDoseSide(dose, side) {
  return dose === TWO_SITE_ID ? side === 'L/R' : (side === 'L' || side === 'R')
}
export function validDoseSideCorrection(dose, side, original) {
  return validDoseSide(dose, side) || (!!original && dose === original.dose && side === original.side && dose === TWO_SITE_ID && (side === 'L' || side === 'R'))
}
