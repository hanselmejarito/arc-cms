import assert from 'node:assert/strict'
import { otherTreatmentReference, isOtherTreatmentService, otherTreatmentStatus } from '../lib/otherTreatment.js'
assert.equal(otherTreatmentReference('GUI', 2026, 1), 'OT-GUI-26-0001')
assert.equal(otherTreatmentReference('BAL', 2026, 10000), 'OT-BAL-26-10000')
assert.throws(() => otherTreatmentReference('GUI', 2026, 0))
assert.throws(() => otherTreatmentReference('unknown', 2026, 1))
for (const x of ['ERIG','TT','Flu','Pneumococcal','Hepatitis B']) assert.equal(isOtherTreatmentService(x), true)
assert.equal(isOtherTreatmentService('Anti-rabies vaccine'), false)
const at = new Date('2026-11-05T02:00:00Z')
assert.deepEqual(otherTreatmentStatus({administeredAt:null,cancelledAt:null,paidAt:at}), {treatment:'Pending',payment:'Paid'})
assert.deepEqual(otherTreatmentStatus({administeredAt:at,cancelledAt:null,paidAt:null}), {treatment:'Given',payment:'Pending'})
assert.deepEqual(otherTreatmentStatus({administeredAt:null,cancelledAt:at,paidAt:at}), {treatment:'Cancelled',payment:'Paid'})
console.log('Other treatment domain checks passed')