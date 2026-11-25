export const treatmentFields = {
  tt: ['given', 'date', 'time', 'refused', 'withPrevious'],
  erig: ['brand', 'date', 'skinTime', 'skinResult', 'weight', 'infiltration', 'ml', 'refused']
} as const
export type TreatmentKind = keyof typeof treatmentFields
export function treatmentSnapshot(kind: TreatmentKind, value: unknown): Record<string, unknown> {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return Object.fromEntries(treatmentFields[kind].map(key => [key, obj[key] ?? (['given','refused','withPrevious'].includes(key) ? false : key === 'infiltration' ? null : '')]))
}
export function treatmentRecorded(kind: TreatmentKind, value: unknown): boolean {
  return Object.entries(treatmentSnapshot(kind, value)).some(([key,v]) => v !== '' && v !== null && (v !== false || key === 'infiltration'))
}
export function treatmentChanged(kind: TreatmentKind, before: unknown, after: unknown): boolean {
  return JSON.stringify(treatmentSnapshot(kind, before)) !== JSON.stringify(treatmentSnapshot(kind, after))
}
