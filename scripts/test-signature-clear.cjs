const fs = require('node:fs'), ts = require('typescript'), assert = require('node:assert/strict')
const code = ts.transpileModule(fs.readFileSync('src/signatureCanvas.js', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const mod = {}
new Function('exports', code)(mod)
const calls = []
const ctx = Object.fromEntries(['save', 'setTransform', 'clearRect', 'restore', 'beginPath'].map(name => [name, (...args) => calls.push([name, ...args])]))
mod.clearSignatureCanvas({ width: 800, height: 600, getContext: () => ctx })
assert.deepEqual(calls, [['save'], ['setTransform', 1, 0, 0, 1, 0, 0], ['clearRect', 0, 0, 800, 600], ['restore'], ['beginPath']])
assert.doesNotThrow(() => mod.clearSignatureCanvas(null))
console.log('Signature canvas clear checks passed')
