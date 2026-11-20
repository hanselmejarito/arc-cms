// Records are sorted by their recorded date. For matching dates, dose labels
// are a display tie-breaker, not a claim about the time of administration.
const text = value => String(value || '')
const natural = (a, b) => text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: 'base' })
const dateDesc = (a, b) => text(b.date).localeCompare(text(a.date))
const doseOrder = day => ({ D0: 0, D3: 3, D7: 7, D14: 14, D21: 21, D28: 28 }[day] ?? 999)

export function compareDoseHistory(a, b) {
  return dateDesc(a, b) || natural(a.registry || a.encounterId, b.registry || b.encounterId) || doseOrder(a.day) - doseOrder(b.day) || natural(a.id, b.id)
}

export function comparePaymentHistory(a, b) {
  return dateDesc(a, b) || natural(b.txn || b.id, a.txn || a.id) || natural(a.id, b.id)
}

export function compareCareTimeline(a, b) {
  const kindOrder = { admission: 0, rer: 1, dose: 2, note: 3 }
  return dateDesc(a, b) || (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) || natural(a.registry || a.encounterId, b.registry || b.encounterId) || doseOrder(a.day) - doseOrder(b.day) || natural(a.id, b.id)
}
