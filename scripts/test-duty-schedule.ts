import assert from 'node:assert/strict'
import { dutyWindow, flexibleDuty } from '../lib/dutySchedule.js'
const base = { branch: 'Palayan', role: 'Nurse', shift: 'Morning Shift', effectiveFrom: '2026-11-05' }
assert.deepEqual(dutyWindow({ ...base, date: '2026-11-05' }), { start: '08:00', end: '18:00', regularHours: 8, flexibleMealMinutes: 60 })
assert.equal(dutyWindow({ ...base, date: '2026-11-04' }).end, '16:00')
assert.equal(dutyWindow({ ...base, branch: 'Muñoz', date: '2026-11-05' }).end, '18:00')
assert.equal(dutyWindow({ ...base, branch: 'Baloc', date: '2026-11-05' }).end, '16:00')
assert.equal(dutyWindow({ ...base, shift: 'Night Shift', date: '2026-11-05' }).end, '23:00')
assert.deepEqual(flexibleDuty({ clockIn: '08:00', clockOut: '18:00' }), { status:'calculated', breakMinutes:60, workedMinutes:540, overtimeMinutes:60 })
assert.equal(flexibleDuty({ clockIn: '08:15', clockOut: '18:00' }).status, 'review')
assert.equal(flexibleDuty({ clockIn: '08:00', clockOut: '12:00' }).status, 'review')
assert.deepEqual(flexibleDuty({ clockIn: '08:00', clockOut: '18:00', reviewedBreakMinutes:30 }), { status:'calculated', breakMinutes:30, workedMinutes:570, overtimeMinutes:90 })
assert.equal(flexibleDuty({ clockIn:'08:00',clockOut:'18:00',reviewedBreakMinutes:61 }).status,'review')
console.log('Flexible duty schedule tests passed')