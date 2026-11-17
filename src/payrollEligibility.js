// Period IDs sort chronologically: YYYY-MM-A precedes YYYY-MM-B.
export function currentPayrollPeriod(date) {
  const [year, month, day] = date.split('-').map(Number)
  if (day <= 10) return `${year}-${String(month).padStart(2, '0')}-A`
  if (day <= 25) return `${year}-${String(month).padStart(2, '0')}-B`
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-A`
}
export function nextPayrollPeriod(date) {
  const [year, month, half] = currentPayrollPeriod(date).split('-')
  if (half === 'A') return `${year}-${month}-B`
  return `${Number(month) === 12 ? Number(year) + 1 : year}-${String(Number(month) === 12 ? 1 : Number(month) + 1).padStart(2, '0')}-A`
}
export function payrollEligibleForPeriod(employee, periodId) {
  const events = [...(employee.payrollEligibilityHistory || [])].sort((a, b) => a.effectivePeriod.localeCompare(b.effectivePeriod))
  if (!events.length) return !!employee.payroll
  const applicable = events.filter(event => event.effectivePeriod <= periodId).at(-1)
  return applicable ? applicable.eligible : events[0].previousEligible
}
