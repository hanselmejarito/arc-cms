export function auditActionSummary(value) {
  return String(value || '—').replace(/\s*·\s*saved signer\s+[^\s·]+/gi, ' · saved signature used')
}
export function auditValueDisplay(value) {
  if (value == null || value === '' || value === '—') return 'Not recorded'
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([key, val]) => `${key}: ${val == null || val === '' ? '—' : String(val)}`).join('\n')
    }
  } catch {}
  return String(value)
}
