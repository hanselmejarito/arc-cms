const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const source = fs.readFileSync('lib/billingPolicy.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const exportsObject = {}
new Function('exports', 'module', compiled)(exportsObject, { exports: exportsObject })
const { isOtherOnlyService, addsOtherOnlyServices, boosterServiceForBrand, isBoosterVaccineLine } = exportsObject
const prices = { 'Flu Regular': 1600, 'Flu Student': 1500, 'Flu Senior-PWD': 1350, 'Hepatitis B': 1100, 'Pneumococcal vaccine': 2500 }
for (const service of Object.keys(prices)) {
  assert.equal(isOtherOnlyService(service), true)
  assert.equal(addsOtherOnlyServices([{ service, qty: 1 }], [], prices), true)
  assert.equal(addsOtherOnlyServices([{ service, qty: 1 }], [{ service, amount: prices[service] }], prices), false)
  assert.equal(addsOtherOnlyServices([{ service, qty: 2 }], [{ service, amount: prices[service] }], prices), true)
}
for (const service of ['Anti-rabies vaccine', 'ERIG (serum)', 'Tetanus Toxoid', 'Booster dose', 'Speeda']) {
  assert.equal(isOtherOnlyService(service), false)
  assert.equal(addsOtherOnlyServices([{ service, qty: 1 }], [], prices), false)
}
assert.equal(addsOtherOnlyServices([{ service:'Flu Regular', qty:1 }, { service:'Flu Regular', qty:1 }], [{ service:'Flu Regular', amount:1600 }], prices), true)
assert.equal(addsOtherOnlyServices([], [{ service:'Flu Regular', amount:1600 }], prices), false)
assert.equal(isOtherOnlyService('Pneumococcal'), true)
assert.equal(isOtherOnlyService('Flu'), true)
assert.equal(boosterServiceForBrand('Bioshoot'), 'Anti-rabies vaccine')
assert.equal(boosterServiceForBrand(' Speeda '), 'Speeda')
assert.equal(boosterServiceForBrand(''), null)
assert.equal(isBoosterVaccineLine('Booster dose'), true)
assert.equal(isBoosterVaccineLine('Speeda'), true)
assert.equal(isBoosterVaccineLine('Tetanus Toxoid'), false)
console.log('RER billing policy: new other-treatment services blocked; existing pending lines preserved.')
