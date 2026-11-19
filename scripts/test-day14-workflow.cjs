const fs = require('node:fs'), ts = require('typescript'), assert = require('node:assert/strict')
function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const out = {}
  new Function('exports', 'require', code)(out, name => deps[name] || require(name))
  return out
}
const server = load('lib/clinical.ts')
const client = load('src/data.js', { './timeFormat': load('src/timeFormat.js'), '../lib/shiftPreview': load('lib/shiftPreview.ts') })
const e = { id: 'test', date: '2026-11-01', biteDate: '2026-11-01', rer: true, died: false, preExp: false, booster: false, category: 'III', pepEligible: true, regimen: 'ID', remark: '', animalStatus: 'Alive' }
const base = [{ encounterId: 'test', day: 'D0', date: '2026-11-01', animalStatus: 'Alive' }, { encounterId: 'test', day: 'D3', date: '2026-11-04', animalStatus: 'Alive' }, { encounterId: 'test', day: 'D7', date: '2026-11-08', animalStatus: 'Alive' }]
const optional = { ...e, day14Workflow: 'optional', animalStatus: 'Dead' }
const patient = { id: 'patient', name: 'Synthetic', birthday: '1990-01-01', sex: 'Male', address: 'Synthetic' }
for (const engine of [server, client]) {
  assert.equal(engine.protocolOf(optional, base).days.some(([day]) => day === 'D14'), false)
  assert.equal(engine.caseInfo(optional, base).next.day, 'D28')
  const with14 = [...base, { encounterId: 'test', day: 'D14', date: '2026-11-15', animalStatus: 'Dead' }]
  assert.equal(engine.protocolOf(optional, with14).days.some(([day]) => day === 'D14'), true)
  assert.equal(engine.caseInfo(optional, with14).next.day, 'D28')
  const completed = [...base, { encounterId: 'test', day: 'D28', date: '2026-11-29', animalStatus: 'Alive' }]
  assert.equal(engine.caseInfo(optional, completed).status, 'Complete')
  assert.equal(engine.protocolOf({ ...e, day14Workflow: 'legacy', animalStatus: 'Dead' }, base).days.some(([day]) => day === 'D14'), true)
}
const reportCase = { ...optional, patientId: patient.id, registry: 'TEST-1', erig: {}, wound: [] }
assert.equal(client.registryRows([reportCase], base, [patient])[0].d14, undefined)
const reportedDose = { encounterId: 'test', day: 'D14', date: '2026-11-15', animalStatus: 'Dead' }
assert.equal(client.registryRows([reportCase], [...base, reportedDose], [patient])[0].d14, '2026-11-15')
async function checkStockPath() {
  const consumed = []
  const dose = load('lib/doses.ts', { './auth.js': { servicingBranch: () => 'Guimba' }, './clinical.js': server, './ids.js': { nextId: async () => 'movement' }, './inventory.js': { doseUses: () => 2, applyConsume: async (_tx, item, branch, uses, batch) => { consumed.push({ item, branch, uses, batch }); return { line: { batch, shift: 'MS' }, vials: 0 } } }, './staffSignatures.js': {}, './nurseDuty.js': {} })
  const stored = []
  let updates = 0
  const tx = { dose: { create: async x => { stored.push(x.data); return x.data } }, encounter: { update: async () => { updates++; return {} } }, movement: { create: async x => x.data } }
  const result = await dose.createDoseInTx(tx, { ...optional, branch: 'Guimba', brand: 'Bioshoot', vaccine: 'PVRV', registry: 'TEST' }, { day: 'D14', date: '2026-11-15', time: '09:00', dose: '0.1 mL × 2 sites ID', side: 'L', animalStatus: '', vaccinator: 'Synthetic', batch: 'batch' }, 'Synthetic', base)
  assert.equal(result.created.day, 'D14')
  assert.deepEqual(consumed, [{ item: 'Bioshoot', branch: 'Guimba', uses: 2, batch: 'batch' }])
  assert.equal(result.movement.uses, 2)
  assert.equal(stored.length, 1)
  assert.equal(updates, 0, 'No status entered should preserve the previously recorded animal status')
}
checkStockPath().then(() => console.log('Optional and legacy Day 14 protocol and stock path checks passed')).catch(error => { console.error(error); process.exitCode = 1 })
