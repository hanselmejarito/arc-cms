const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict')
function load(file,deps){const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;const out={};new Function('require','exports',source)(x=>x in deps?deps[x]:require(x),out);return out}
const access=load('lib/dutyAccess.ts',{})
let duty=null
const person={id:'test',name:'Test',email:'test.invalid',role:'Nurse',branchName:'Guimba',employeeId:'employee',status:'Active'}
const prisma={session:{findUnique:async()=>({id:'session',expiresAt:new Date(Date.now()+60000),user:person})},attendance:{findMany:async()=>duty&&((duty.clockIn&&!duty.clockOut)||(duty.nightClockIn&&!duty.nightClockOut))?[duty]:[]}}
const auth=load('lib/auth.ts',{'./prisma.js':{prisma},'./dutyAccess.js':access,'./clinical.js':{ALL_BRANCH_ROLES:['Admin','Superadmin'],canPage:()=>true,clinicDate:()=> '2026-11-15'}})
;(async()=>{
  process.env.TEMPORARY_BRANCH_ENABLED='true'
  duty={date:'2026-11-15',branch:'Paniqui',clockIn:'08:00',clockOut:'',nightBranch:null,nightClockIn:'',nightClockOut:''}
  let result=await auth.loadSession('test');assert.equal(result.user.branchName,'Paniqui');assert.equal(result.user.homeBranchName,'Guimba');assert.equal(result.user.temporaryDuty,true)
  duty.clockOut='17:00';result=await auth.loadSession('test');assert.equal(result.user.branchName,'Guimba');assert.equal(result.user.temporaryDuty,false)
  duty.clockOut='';duty.nightClockIn='18:00';result=await auth.loadSession('test');assert.equal(result.user.branchName,null)
  duty.clockOut='17:00';duty.date='2026-11-14';result=await auth.loadSession('test');assert.equal(result.user.branchName,null)
  delete process.env.TEMPORARY_BRANCH_ENABLED;result=await auth.loadSession('test');assert.equal(result.user.branchName,'Guimba')
  console.log('Gated temporary duty session scoping and revocation: PASS')
})().catch(e=>{console.error(e);process.exitCode=1})
