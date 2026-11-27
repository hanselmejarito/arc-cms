import assert from 'node:assert/strict'
import {registryRows} from '../src/data.js'
import {registryDoseLabel} from '../src/registryDose.js'
const origin={id:'origin',registry:'ARCTLG-26-0001',patientId:'patient',branch:'Talugtug',receivingEncounterId:'receiving',date:'2026-11-27',rer:true,category:'III',pepEligible:true,regimen:'ID',animalStatus:'Alive',erig:{}}
const receiving={...origin,id:'receiving',registry:'ARCGUI-26-0001',branch:'Guimba',continuedFromEncounterId:'origin',receivingEncounterId:'',seriesStartDate:origin.date}
const doses=[{encounterId:'origin',day:'D0',date:'2026-11-27',branch:'Talugtug'},{encounterId:'receiving',day:'D3',date:'2026-11-30',branch:'Guimba'}]
const rows=registryRows([origin,receiving],doses,[{id:'patient',name:'Test',birthday:'1990-01-01'}])
const tlg=rows.find(row=>row.e.branch==='Talugtug')!,gui=rows.find(row=>row.e.branch==='Guimba')!
assert.equal(registryDoseLabel(tlg.d0,tlg.doseBranches.d0,tlg.e.branch),'11/27/26')
assert.equal(registryDoseLabel(tlg.d3,tlg.doseBranches.d3,tlg.e.branch),'11/30/26 - Guimba')
assert.equal(registryDoseLabel(gui.d0,gui.doseBranches.d0,gui.e.branch),'11/27/26 - Talugtug')
assert.equal(registryDoseLabel(gui.d3,gui.doseBranches.d3,gui.e.branch),'11/30/26')
assert.equal(registryDoseLabel('2026-11-27','','Guimba'),'11/27/26')
console.log('Both referral registries show the actual dose branches')
