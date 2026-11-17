const fs = require('node:fs')
const ts = require('typescript')
const assert = require('node:assert/strict')
function load(path, dependencies = {}) {
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const out = {}
  new Function('exports', 'require', source)(out, name => dependencies[name] || require(name))
  return out
}
const data = load('src/data.js', { './timeFormat': load('src/timeFormat.js'), '../lib/shiftPreview': load('lib/shiftPreview.ts') })
const { reportPayroll } = load('src/payrollReportInputs.js', { './data': data })
const period = data.payPeriods.find(p => p.half === 'B')
const employee = { id: 'test', branch: 'Guimba', shift: 'Morning Shift', role: 'Nurse' }
const stored = [{ employeeId: 'test', periodId: period.id, days: 3, late: 5 }]
const overrides = [{ employeeId: 'test', fromPeriod: period.id, sss: 300 }]
const result = reportPayroll(employee, period, [], [], stored, overrides, [], (e, input, override, rate, branch, context) => ({ days: input.days, late: input.late, sss: override.sss, half: context.payday }))
assert.deepEqual(result.pay, { days: 3, late: 5, sss: 300, half: 'B' })
assert.equal(result.input.auto.days, 0)
console.log('Payroll report uses saved inputs and contribution overrides: PASS')
