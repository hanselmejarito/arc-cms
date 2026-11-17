// Format stored 24-hour clock values for display without changing their meaning.
export function formatTime12(value) {
  if (value == null || value === '') return '—'
  const text = String(value).trim()
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(text)
  if (!match) return text
  const hour = Number(match[1]), minute = Number(match[2]), second = match[3]
  const period = match[4]?.toUpperCase()
  if (minute > 59 || (second != null && Number(second) > 59) || (period ? hour < 1 || hour > 12 : hour > 23)) return text
  return `${period ? hour : hour % 12 || 12}:${match[2]}${second == null ? '' : ':' + second} ${period || (hour < 12 ? 'AM' : 'PM')}`
}
