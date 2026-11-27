import assert from 'node:assert/strict'
import { accessibleDoseEncounterIds } from '../lib/referralDoseAccess'
const receiving = { id:'guimba', continuedFromEncounterId:'talugtug' }
const accepted = { encounterId:'talugtug', receivingEncounterId:'guimba', status:'Accepted' }
assert.deepEqual([...accessibleDoseEncounterIds([receiving],[accepted])].sort(),['guimba','talugtug'])
assert.deepEqual([...accessibleDoseEncounterIds([receiving],[{...accepted,status:'Pending acceptance'}])],['guimba'])
assert.deepEqual([...accessibleDoseEncounterIds([receiving],[{...accepted,receivingEncounterId:'other'}])],['guimba'])
assert.deepEqual([...accessibleDoseEncounterIds([],[accepted])],[])
const source={id:'talugtug',continuedFromEncounterId:null,receivingEncounterId:'guimba'}
assert.deepEqual([...accessibleDoseEncounterIds([source],[accepted])].sort(),['guimba','talugtug'])
assert.deepEqual([...accessibleDoseEncounterIds([source],[{...accepted,status:'Pending acceptance'}])],['talugtug'])
assert.deepEqual([...accessibleDoseEncounterIds([source],[{...accepted,encounterId:'other'}])],['talugtug'])
console.log('Referral dose access checks passed')
