export async function api(path, opts = {}) {
  const { body, method, headers, ...rest } = opts
  const res = await fetch(path, {
    method: method || (body ? 'POST' : 'GET'),
    credentials: 'include',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...rest
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const loginApi = (email, password, remember) => api('/api/auth/login', { body: { email, password, remember } })
export const logoutApi = () => api('/api/auth/logout', { method: 'POST' })
export const meApi = () => api('/api/auth/me')
export const loadClinical = () => api('/api/clinical')
export const createPatientApi = body => api('/api/patients', { body })
export const updatePatientApi = (id, body) => api('/api/patients/' + id, { method: 'PATCH', body })
export const admitApi = body => api('/api/admissions', { body })
export const saveEncounterApi = (id, body) => api('/api/encounters/' + id, { method: 'PATCH', body })
export const reclassifyEncounterApi = id => api('/api/encounters/' + id + '/reclassify', { method: 'POST' })
export const recordDoseApi = (id, body) => api('/api/encounters/' + id + '/doses', { body })
export const updateDoseApi = (id, day, body) => api('/api/encounters/' + id + '/doses/' + day, { method: 'PATCH', body })
export const saveNoteApi = body => api('/api/notes', { body })
export const savePaymentApi = body => api('/api/payments', { body })
export const createReferralApi = body => api('/api/referrals', { body })
export const acceptReferralApi = id => api('/api/referrals/' + id + '/accept', { method: 'POST' })
export const stockInApi = body => api('/api/inventory/stock-in', { body })
export const stockOutApi = body => api('/api/inventory/stock-out', { body })
export const stockAdjustApi = body => api('/api/inventory/adjust', { body })
export const closeShiftApi = body => api('/api/inventory/close-shift', { body })
export const saveFinanceApi = body => api('/api/finance', { body })
export const requestRefundApi = body => api('/api/refunds', { body })
export const refundStatusApi = (id, status) => api('/api/refunds/' + id + '/status', { body: { status } })
export const createEmployeeApi = body => api('/api/employees', { body })
export const updateEmployeeApi = (id, body) => api('/api/employees/' + encodeURIComponent(id), { method: 'PATCH', body })
export const createUserApi = body => api('/api/users', { body })
export const updateUserApi = (id, body) => api('/api/users/' + encodeURIComponent(id), { method: 'PATCH', body })
export const saveBranchApi = (name, body) => api('/api/branches/' + encodeURIComponent(name), { method: 'PATCH', body })
export const timeInApi = body => api('/api/attendance/in', { body })
export const timeOutApi = () => api('/api/attendance/out', { method: 'POST' })
export const correctAttendanceApi = body => api('/api/attendance/correct', { body })
export const fileOvertimeApi = body => api('/api/attendance/overtime', { body })
export const decideOvertimeApi = (id, body) => api('/api/attendance/overtime/' + encodeURIComponent(id) + '/decide', { body })
export const savePayrollInputApi = body => api('/api/payroll/inputs', { body })
export const saveContributionOverrideApi = body => api('/api/payroll/overrides', { body })
export const resetPayrollInputApi = (employeeId, periodId) => api('/api/payroll/inputs/' + encodeURIComponent(employeeId) + '/' + encodeURIComponent(periodId), { method: 'DELETE' })
