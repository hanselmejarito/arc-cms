const fs = require('node:fs'), ts = require('typescript'), assert = require('node:assert/strict'), { z } = require('zod')
const src = fs.readFileSync('lib/routes/clinical.ts', 'utf8')
const start = src.indexOf("clinicalRouter.patch('/encounters/:id/doses/:day'")
const end = src.indexOf('\ntype AutoDay0Extras', start)
assert(start >= 0 && end > start)
const js = ts.transpileModule(src.slice(start, end), {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
let handler, auditEntry, writes = 0
const enc = {id:'ENC',registry:'TEST',branch:'Guimba',vaccine:'PVRV',regimen:'ID',day14Workflow:'optional',rer:true,continuedFromEncounterId:'',receivingEncounterId:''}
const original = {id:'DOSE',encounterId:'ENC',date:'2026-11-01',time:'08:00',dose:'dose',side:'L',route:'ID',animalStatus:'',vaccinator:'Nurse',batch:'B',signature:null}
const db = {encounter:{findUnique:async()=>enc},dose:{findFirst:async()=>original,findMany:async()=>[original]},$transaction:async fn=>fn({dose:{findMany:async()=>[original],update:async({data})=>{writes++;return {...original,...data}}},auditLog:{create:async({data})=>{auditEntry=data}},encounter:{update:async()=>{}}})}
const deps = {clinicalRouter:{patch:(_path,_guard,fn)=>{handler=fn}},requirePage:()=>()=>{},doseSchema:z.object({day:z.string(),date:z.string(),time:z.string(),dose:z.string(),side:z.string(),animalStatus:z.string(),vaccinator:z.string(),batch:z.string().optional(),signature:z.string().optional(),savedSignatureId:z.string().optional()}),z,prisma:db,inScopeEncounter:()=>true,servicingBranch:()=>enc.branch,caseInfo:()=>({status:'Complete'}),resolveVaccinator:async()=>({name:'Nurse'}),doseUses:()=>2,validDoseSideCorrection:(_dose,side)=>['L','R'].includes(side),clinicDate:()=> '2026-11-25',doseClient:x=>x}
new Function(...Object.keys(deps),js)(...Object.values(deps))
async function call(role,reason){const req={params:{id:'ENC',day:'D0'},body:{date:'2026-11-02',time:'08:00',dose:'dose',side:'R',animalStatus:'Alive',vaccinator:'Nurse',reason},user:{id:'U',name:'Tester',role},userAgent:'test'};const res={code:200,status(n){this.code=n;return this},json(value){this.body=value;return this}};await handler(req,res);return res}
;(async()=>{assert.equal((await call('Nurse','test')).code,403);assert.equal((await call('Admin',' ')).code,400);assert.equal(writes,0);assert.equal((await call('Admin','wrong side')).code,200);assert.equal(writes,1);assert.equal(JSON.parse(auditEntry.oldValue).side,'L');assert.equal(JSON.parse(auditEntry.newValue).side,'R');assert.equal(JSON.parse(auditEntry.newValue).reason,'wrong side');assert.equal((await call('Superadmin','correct date')).code,200);console.log('Completed dose access, required reason and before/after audit: PASS')})().catch(e=>{console.error(e);process.exitCode=1})
