const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict')
const source=fs.readFileSync('src/screens/OtherTreatments.jsx','utf8')
const code=source.slice(source.indexOf('export function filterTreatmentPatients'),source.indexOf('\nexport function PatientSearch'))
const js=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const out={};new Function('exports','fmt',js)(out,value=>value||'')
const patients=[{id:'1',name:'Cruz, Ana',first:'Ana',last:'Cruz',birthday:'1990-01-02',branch:'Guimba',contact:'09123456789'},{id:'2',name:'Reyes, Bea',branch:'Baloc'}]
for(const query of ['ana cruz','CRUZ','1990-01-02','4567','guimba']) assert.deepEqual(out.filterTreatmentPatients(patients,query).map(p=>p.id),['1'],query)
assert.deepEqual(out.filterTreatmentPatients(patients,'missing'),[])
assert.equal(out.filterTreatmentPatients(patients,'').length,2)
console.log('Other treatment patient search matching: PASS')
