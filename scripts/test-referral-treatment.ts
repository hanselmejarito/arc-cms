import assert from 'node:assert/strict'
import {referralTreatmentEntries as entries} from '../src/referralTreatment'
const empty={given:false,date:'',time:'',refused:false,withPrevious:false}
const source={branch:'Talugtug',tt:empty,erig:{},referralProgress:{branch:'Guimba',tt:{...empty,given:true,date:'2026-11-27',time:'11:30'},erig:{brand:'Equirab',date:'2026-11-27',ml:'2'}}}
assert.equal(entries('tt',source)[0].branch,'Guimba')
assert.equal(entries('tt',source)[0].value.time,'11:30')
assert.equal(entries('erig',source)[0].value.ml,'2')
const copied={...source,tt:{...source.referralProgress.tt}}
assert.equal(entries('tt',copied).length,1)
assert.equal(entries('tt',copied)[0].branch,'Talugtug')
const different={...copied,tt:{...copied.tt,date:'2026-11-26'}}
assert.deepEqual(entries('tt',different).map(x=>x.branch),['Talugtug','Guimba'])
console.log('Linked treatment display checks passed')
