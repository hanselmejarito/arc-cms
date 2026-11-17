const fs = require('node:fs'), ts = require('typescript'), assert = require('node:assert/strict')
function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const out = {}
  new Function('exports', 'require', code)(out, name => deps[name] || require(name))
  return out
}
const data = load('src/data.js', { './timeFormat': load('src/timeFormat.js'), '../lib/shiftPreview': load('lib/shiftPreview.ts') })
const employee = { id: 'test', branch: 'Talavera', role: 'Nurse', shift: 'Morning Shift' }
const schedule = [{ name: 'Talavera', schedules: [{ effectiveFrom: '2026-11-01', morningStart: '08:00', morningEnd: '17:00', nurseStart: '08:00', nurseEnd: '17:00', nightEnabled: false }] }]
const period = data.payPeriods.find(p => p.from <= '2026-11-17' && p.to >= '2026-11-17')
assert.ok(period)
const evaluate = (clockIn, clockOut, extra = {}) => data.periodInputsFromAttendance(employee, period.id, [{ employeeId: 'test', branch: 'Talavera', date: '2026-11-17', roleAtMorning: 'Nurse', in: clockIn, out: clockOut, ...extra }], [], [], schedule)
for (const clockIn of ['08:00', '08:01', '08:20']) {
  const result = evaluate(clockIn, '17:00')
  assert.equal(result.needsReview.length, 0)
  assert.equal(result.late, 0)
  assert.equal(result.undertime, 0)
}
const late = evaluate('08:21', '17:00')
assert.equal(late.late, 1)
assert.equal(late.undertime, 0)
assert.ok(late.needsReview.length)
assert.ok(evaluate('08:00', '16:59').needsReview.length)
assert.ok(evaluate('08:00', '').needsReview.length)
assert.equal(evaluate('08:21', '17:00', { reviewedBreakMinutes: 60 }).needsReview.length, 0)
console.log('Break review and morning grace checks passed')
