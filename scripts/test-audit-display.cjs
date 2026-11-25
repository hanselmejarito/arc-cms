const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict')
const js=ts.transpileModule(fs.readFileSync('src/auditDisplay.js','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const display={};new Function('exports',js)(display)
assert.equal(display.auditActionSummary('Recorded D7 · ARC-1 · saved signer abc123'),'Recorded D7 · ARC-1 · saved signature used')
assert.equal(display.auditValueDisplay('{"side":"L","reason":"Correct entry"}'),'side: L\nreason: Correct entry')
assert.equal(display.auditValueDisplay('—'),'Not recorded')
assert.equal(display.auditValueDisplay('Saved signer abc123'),'Saved signer abc123')
console.log('Audit display summaries and original details: PASS')
