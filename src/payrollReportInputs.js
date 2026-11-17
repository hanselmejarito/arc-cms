import { overrideFor, periodInputsFromAttendance } from './data'

// Keep the report calculation aligned with the payroll register for the cutoff.
export function reportPayroll(employee, period, attendance, users, payrollInputs, contributionOverrides, overtimeRequests, calculate, branchMaster) {
  const auto = periodInputsFromAttendance(employee, period.id, attendance, users, overtimeRequests)
  const stored = (payrollInputs || []).find(row => row.employeeId === employee.id && row.periodId === period.id)
  const input = { ...auto, ...(stored || {}), ot: auto.ot, otApproved: auto.ot > 0, auto }
  return { input, pay: calculate(employee, input, overrideFor(contributionOverrides, employee.id, period.id) || {}, 1, branchMaster, { payday: period.half }) }
}
