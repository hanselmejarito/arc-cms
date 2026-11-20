const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const js = ts.transpileModule(fs.readFileSync('src/recordOrdering.js', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const ordering = {}
new Function('exports', js)(ordering)
const doses = [{id:'5',encounterId:'a',day:'D28',date:'2026-11-18'},{id:'2',encounterId:'a',day:'D3',date:'2026-11-18'},{id:'4',encounterId:'a',day:'D14',date:'2026-11-18'},{id:'1',encounterId:'a',day:'D0',date:'2026-11-18'},{id:'3',encounterId:'a',day:'D7',date:'2026-11-18'},{id:'6',encounterId:'b',day:'D0',date:'2026-11-19'}]
assert.deepEqual(doses.slice().sort(ordering.compareDoseHistory).map(x=>x.day), ['D0','D0','D3','D7','D14','D28'])
const payments = [{txn:'TXNGUI-26-0002',date:'2026-11-18'},{txn:'TXNGUI-26-0010',date:'2026-11-18'},{txn:'TXNGUI-26-0001',date:'2026-11-19'}]
assert.deepEqual(payments.slice().sort(ordering.comparePaymentHistory).map(x=>x.txn), ['TXNGUI-26-0001','TXNGUI-26-0010','TXNGUI-26-0002'])
const history = [{kind:'dose',day:'D14',date:'2026-11-18'}, {kind:'rer',date:'2026-11-18'}, {kind:'dose',day:'D0',date:'2026-11-18'}, {kind:'admission',date:'2026-11-18'}, {kind:'note',date:'2026-11-19'}]
assert.deepEqual(history.sort(ordering.compareCareTimeline).map(x=>x.kind+(x.day||'')), ['note','admission','rer','doseD0','doseD14'])
console.log('Date, reference and same-day dose ordering: PASS')
