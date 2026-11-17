const fs = require('node:fs'), ts = require('typescript'), assert = require('node:assert/strict')
const source = ts.transpileModule(fs.readFileSync('lib/attendanceCorrection.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const mod = {}
new Function('exports', source)(mod)
for (const field of ['clockIn', 'clockOut']) {
  assert.equal(mod.shouldResetMorningBreak(field, '08:00', '08:01', true), true)
  assert.equal(mod.shouldResetMorningBreak(field, '08:00', '08:00', true), false)
  assert.equal(mod.shouldResetMorningBreak(field, '08:00', '08:01', false), false)
}
for (const field of ['nightClockIn', 'nightClockOut']) assert.equal(mod.shouldResetMorningBreak(field, '16:00', '16:01', true), false)
console.log('Attendance correction break-review checks passed')
