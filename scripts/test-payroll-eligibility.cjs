const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync('src/payrollEligibility.js','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const mod = {}
new Function('exports', code)(mod)
assert.equal(mod.currentPayrollPeriod('2026-11-17'),'2026-11-B')
assert.equal(mod.nextPayrollPeriod('2026-11-17'),'2026-12-A')
assert.equal(mod.nextPayrollPeriod('2026-12-26'),'2027-01-B')
const employee = {payroll:false,payrollEligibilityHistory:[{effectivePeriod:'2026-12-A',previousEligible:true,eligible:false}]}
assert.equal(mod.payrollEligibleForPeriod(employee,'2026-11-B'),true)
assert.equal(mod.payrollEligibleForPeriod(employee,'2026-12-A'),false)
assert.equal(mod.payrollEligibleForPeriod(employee,'2027-01-A'),false)
employee.payrollEligibilityHistory.push({effectivePeriod:'2027-01-B',previousEligible:false,eligible:true})
assert.equal(mod.payrollEligibleForPeriod(employee,'2027-01-A'),false)
assert.equal(mod.payrollEligibleForPeriod(employee,'2027-01-B'),true)
assert.equal(mod.payrollEligibleForPeriod({payroll:false},'2026-11-B'),false)
console.log('Payroll eligibility cutoff history: PASS')
