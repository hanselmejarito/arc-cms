// These services are recorded and billed through Other Treatments for new visits.
const OTHER_ONLY = new Set(['Hepatitis B', 'Pneumococcal', 'Pneumococcal vaccine', 'Flu', 'Flu Regular', 'Flu Student', 'Flu Senior-PWD'])

export function isOtherOnlyService(service: string): boolean {
  return OTHER_ONLY.has(String(service || '').replace(/ × \d+$/, ''))
}

// Existing pending lines remain collectible; additional other-treatment quantities are rejected.
export function addsOtherOnlyServices(lines: Array<{ service?: unknown; qty?: unknown }>, pending: Array<{ service: string; amount: number }>, prices: Record<string, number>): boolean {
  const allowed = new Map<string, number>(), requested = new Map<string, number>()
  for (const row of pending) {
    const name = String(row.service || '').replace(/ × \d+$/, '')
    if (!isOtherOnlyService(name) || !prices[name] || Number(row.amount) <= 0) continue
    allowed.set(name, (allowed.get(name) || 0) + Math.max(1, Math.round(Number(row.amount) / prices[name])))
  }
  for (const line of lines) {
    const name = String(line.service || '').replace(/ × \d+$/, '')
    const qty = Math.max(0, Number(line.qty) || 0)
    if (isOtherOnlyService(name) && qty > 0) requested.set(name, (requested.get(name) || 0) + qty)
  }
  return Array.from(requested).some(([name, qty]) => qty > (allowed.get(name) || 0))
}

// A booster is a treatment classification; the vaccine brand determines its one ARV charge.
export function boosterServiceForBrand(brand: string | null | undefined): 'Speeda' | 'Anti-rabies vaccine' | null {
  const name = String(brand || '').trim()
  if (!name) return null
  return name.toLowerCase() === 'speeda' ? 'Speeda' : 'Anti-rabies vaccine'
}

export function isBoosterVaccineLine(service: string): boolean {
  return ['Booster dose', 'Anti-rabies vaccine', 'Speeda', 'Not set yet'].includes(String(service || '').replace(/ × \d+$/, ''))
}
