import assert from 'node:assert/strict'
import { receivingBilling } from '../lib/referralBilling'
import { linkedDoses, caseInfo } from '../src/data.js'
const source = { category:'III', booster:false, preExp:false, billing:'Walk-in' }
const patient = { philhealth:true }, branch = { accreditation:'Accredited' }, referral = { classification:'PhilHealth' }
assert.equal(receivingBilling(source, patient, branch, referral), 'PhilHealth')
assert.equal(source.billing, 'Walk-in')
assert.equal(receivingBilling(source, {philhealth:false}, branch, referral), 'PhilHealth verification required')
assert.equal(receivingBilling({...source,category:'II'}, patient, branch, referral), 'Walk-in')
assert.equal(receivingBilling({...source,booster:true}, patient, branch, referral), 'Walk-in')
assert.equal(receivingBilling(source, patient, {accreditation:'Not accredited'}, referral), 'Walk-in')
const receiving={id:'receiving',continuedFromEncounterId:'origin',rer:true,category:'III',pepEligible:true,billing:'PhilHealth',regimen:'ID',date:'2026-11-01',seriesStartDate:'2026-11-01'}
const doses=[{encounterId:'origin',day:'D0',date:'2026-11-01'},{encounterId:'origin',day:'D3',date:'2026-11-04'}]
assert.equal(linkedDoses(receiving,doses.slice(0,1)).length,1)
assert.equal(caseInfo(receiving,doses.slice(0,1)).next?.day,'D3')
assert.equal(linkedDoses(receiving,doses).length,2)
assert.equal(caseInfo(receiving,doses).next?.day,'D7')
console.log('Referral billing and dose continuation checks passed')
