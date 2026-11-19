// Local-only synthetic API test. Every created record is removed in finally.
import 'dotenv/config'
import { randomUUID, createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'
import { dispatch } from '../lib/dispatch.js'
import { clinicDate } from '../lib/clinical.js'
import { resolveVaccinator } from '../lib/doses.js'
import { resolveStaffSignature } from '../lib/staffSignatures.js'
import { calc } from '../src/screens/People.jsx'
import { branchPayrollSummary } from '../src/branchPayrollSummary.js'
import { payPeriods, periodInputsFromAttendance } from '../src/data.js'

for (const key of ['DATABASE_URL','DIRECT_URL']) {
  const url=new URL(process.env[key] || '')
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/arc_clinic') throw new Error('Expected local arc_clinic database.')
}
if(process.env.TEMPORARY_BRANCH_ENABLED!=='true')throw new Error('Test feature flag required.')
const db=new PrismaClient(),tag='duty-e2e-'+randomUUID(),nurse=tag+'-nurse',admin=tag+'-admin',employee=tag+'-employee'
const tokenN=randomUUID(),tokenA=randomUUID(),hash=(x:string)=>createHash('sha256').update(x).digest('hex')
const ids={home:tag+'-home',away:tag+'-away',corrected:tag+'-corrected'}
function check(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(message)}
async function api(method:string,path:string,token:string,body?:object){
  const req=new NextRequest('http://localhost:3000/api'+path,{method,headers:{cookie:'arc_session='+token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
  const res=await dispatch(req);return {status:res.status,body:await res.json()}
}
async function main(){
  if(await db.inventoryLine.count())throw new Error('Test requires empty local inventory to avoid unrelated shift updates.')
  await db.employee.create({data:{id:employee,name:'Synthetic Nurse',branch:'Guimba',position:'Nurse',role:'Nurse',rate:850,benefits:false}})
  await db.employee.create({data:{id:tag+'-colleague',name:'Synthetic Colleague',branch:'Paniqui',position:'Nurse',role:'Nurse',rate:999,benefits:false}})
  await db.user.create({data:{id:nurse,name:'Synthetic Nurse',email:tag+'-nurse@example.invalid',passwordHash:'synthetic',role:'Nurse',branchName:'Guimba',employeeId:employee}})
  await db.user.create({data:{id:admin,name:'Synthetic Admin',email:tag+'-admin@example.invalid',passwordHash:'synthetic',role:'Admin'}})
  await db.branch.create({data:{name:tag+'-branch',code:tag,address:'',contact:'',hours:'',accreditation:'Not accredited',night:false}})
  await db.branchSchedule.create({data:{id:tag+'-schedule',branchName:tag+'-branch',effectiveFrom:clinicDate(),morningStart:'09:00',morningEnd:'18:00',nurseStart:'09:00',nurseEnd:'18:00',nightEnabled:false}})
  await db.staffSignature.create({data:{id:tag+'-signature',kind:'Nurse',name:'Synthetic Nurse',employeeId:employee,image:'synthetic',method:'upload'}})
  await db.session.createMany({data:[{tokenHash:hash(tokenN),userId:nurse,expiresAt:new Date(Date.now()+600000)},{tokenHash:hash(tokenA),userId:admin,expiresAt:new Date(Date.now()+600000)}]})
  for(const [id,branch] of [[ids.home,'Guimba'],[ids.away,'Paniqui'],[ids.corrected,'Baloc']])await db.patient.create({data:{id,first:'Synthetic',last:id,name:'Synthetic Test',birthday:'1990-01-01',sex:'Female',branch}})
  await db.encounter.create({data:{id:tag+'-encounter',registry:tag+'-registry',patientId:ids.home,branch:'Guimba',date:clinicDate(),wound:[],history:{},tt:{},erig:{},progress:{}}})
  let r=await api('GET','/clock',tokenN);check(r.status===200&&Math.abs(Date.parse(r.body.serverTime)-Date.now())<10000,'Server clock unavailable')
  r=await api('POST','/attendance/in',tokenN,{branch:'Paniqui'});check(r.status===200,'Morning Time In failed')
  r=await api('GET','/auth/me',tokenN);check(r.body.user.branchName==='Paniqui','Temporary branch not set')
  r=await api('GET','/staff-signatures',tokenN);check(r.body.some((x:{id:string,branch:string})=>x.id===tag+'-signature'&&x.branch==='Paniqui'),'Assigned nurse signature unavailable at duty branch')
  check((await resolveVaccinator(db,'Paniqui','Synthetic Nurse'))?.id===employee,'Temporary vaccinator unavailable in duty branch')
  const signer=await db.staffSignature.findUniqueOrThrow({where:{id:tag+'-signature'}})
  await db.$transaction(async tx=>{const signature=await resolveStaffSignature(tx,signer.id,'Nurse','Synthetic Nurse','Paniqui',signer.updatedAt.toISOString());check(signature.image==='synthetic','Saved signature unavailable for temporary duty')})
  r=await api('GET','/clinical',tokenN);check(r.status===200,'Clinical load failed')
  check(r.body.patients.some((p:{id:string})=>p.id===ids.away),'Duty patient missing')
  check(!r.body.patients.some((p:{id:string})=>p.id===ids.home||p.id===ids.corrected),'Other branch patient leaked')
  const colleague=r.body.employees.find((e:{id:string})=>e.id===tag+'-colleague')
  check(colleague&&!('rate' in colleague)&&!('email' in colleague),'Other employee payroll or login data leaked')
  r=await api('PATCH','/patients/'+ids.home,tokenN,{contact:'synthetic'});check(r.status===403,'Other branch patient update allowed')
  r=await api('POST','/other-treatments',tokenN,{patientId:ids.home,branch:'Paniqui',service:'Flu'});check(r.status===403,'Other branch patient treatment allowed')
  r=await api('POST','/referrals',tokenN,{encounterId:tag+'-encounter',to:'Paniqui'});check(r.status===403,'Other branch referral was allowed')
  r=await api('POST','/attendance/correct-branch',tokenA,{userId:nurse,date:clinicDate(),shift:'morning',branch:'Baloc',expectedBranch:'Paniqui',reason:'Synthetic correction'});check(r.status===200,'Branch correction failed')
  r=await api('GET','/auth/me',tokenN);check(r.body.user.branchName==='Baloc','Corrected branch not applied')
  r=await api('GET','/staff-signatures',tokenN);check(r.body.some((x:{id:string,branch:string})=>x.id===tag+'-signature'&&x.branch==='Baloc'),'Nurse signature did not follow branch correction')
  r=await api('GET','/clinical',tokenN);check(r.body.patients.some((p:{id:string})=>p.id===ids.corrected),'Corrected branch patient missing');check(!r.body.patients.some((p:{id:string})=>p.id===ids.away),'Old branch patient remained available')
  r=await api('POST','/attendance/out',tokenN);check(r.status===200,'Morning Time Out failed')
  r=await api('GET','/auth/me',tokenN);check(r.body.user.branchName==='Guimba','Temporary access not revoked')
  check((await resolveVaccinator(db,'Paniqui','Synthetic Nurse'))?.id!==employee,'Temporary vaccinator still available after Time Out')
  check((await resolveVaccinator(db,'Guimba','Synthetic Nurse'))?.id===employee,'Home branch vaccinator not restored')
  r=await api('GET','/clinical',tokenN);check(r.body.patients.some((p:{id:string})=>p.id===ids.home),'Home branch patient missing after Time Out');check(!r.body.patients.some((p:{id:string})=>p.id===ids.away||p.id===ids.corrected),'Temporary branch patient remained visible after Time Out')
  r=await api('POST','/attendance/night/in',tokenN,{branch:'Guimba'});check(r.status===200,'Night Time In failed')
  r=await api('POST','/attendance/correct-branch',tokenA,{userId:nurse,date:clinicDate(),shift:'night',branch:'Cabanatuan',expectedBranch:'Guimba',reason:'Synthetic night correction'});check(r.status===200,'Night branch correction failed')
  r=await api('GET','/auth/me',tokenN);check(r.body.user.branchName==='Cabanatuan','Corrected night branch not applied')
  const attendance=await db.attendance.findUniqueOrThrow({where:{userId_date:{userId:nurse,date:clinicDate()}}})
  check(attendance.branch==='Baloc'&&attendance.nightBranch==='Cabanatuan','Duty branches not saved separately')
  await db.attendance.update({where:{id:attendance.id},data:{nightClockIn:'00:00'}})
  r=await api('POST','/attendance/night/out',tokenN);check(r.status===200,'Night Time Out failed')
  r=await api('GET','/auth/me',tokenN);check(r.body.user.branchName==='Guimba','Night temporary access not revoked')
  await db.attendance.update({where:{id:attendance.id},data:{clockIn:'08:00',clockOut:'17:00',nightClockIn:'17:00',nightClockOut:'23:00'}})
  r=await api('GET','/clinical',tokenA);check(r.status===200,'Admin payroll data load failed')
  const employeeRow=r.body.employees.find((x:{id:string})=>x.id===employee)
  const attendanceRows=r.body.attendance.filter((x:{userId:string})=>x.userId===nurse)
  check(employeeRow&&attendanceRows.length===1,'Payroll inputs missing')
  const period=payPeriods.find((p:{from:string,to:string})=>p.from<=clinicDate()&&p.to>=clinicDate());check(period,'Payroll period not found')
  const scheduleBranch=r.body.branches.find((x:{name:string})=>x.name===tag+'-branch')
  check(scheduleBranch?.schedules?.some((x:{id:string})=>x.id===tag+'-schedule'),'Branch schedule version missing from API')
  const scheduleInputs=periodInputsFromAttendance(employeeRow,period.id,[{employeeId:employee,date:clinicDate(),branch:tag+'-branch',in:'09:21',out:'18:00',roleAtMorning:'Nurse',reviewedBreakMinutes:60}],[],[],r.body.branches)
  check(scheduleInputs.late===1,'Effective branch schedule was not used')
  const totals=branchPayrollSummary({branches:['Baloc','Cabanatuan','Guimba'],employees:[employeeRow],attendance:attendanceRows,users:r.body.users,payrollInputs:[],contributionOverrides:[],overtimeRequests:[],branchMaster:r.body.branches,periodId:period.id,calculate:calc})
  check(totals.every((x:{needsReview:boolean})=>!x.needsReview),'Branch payroll unexpectedly requires review')
  check(totals.some((x:{branch:string,gross:number})=>x.branch==='Baloc'&&x.gross===850),'Morning pay attributed incorrectly')
  check(totals.some((x:{branch:string,gross:number})=>x.branch==='Cabanatuan'&&x.gross>850),'Night pay attributed incorrectly')
  console.log('Local API: selection, branch scope, correction, revocation and separate night duty PASS')
  console.log('Local API data: branch payroll allocation PASS')
}
try { await main() } finally {
  await db.auditLog.deleteMany({where:{userId:{in:[nurse,admin]}}})
  await db.attendance.deleteMany({where:{userId:nurse}})
  await db.session.deleteMany({where:{userId:{in:[nurse,admin]}}})
  await db.encounter.deleteMany({where:{id:tag+'-encounter'}})
  await db.patient.deleteMany({where:{id:{in:Object.values(ids)}}})
  await db.user.deleteMany({where:{id:{in:[nurse,admin]}}})
  await db.staffSignature.deleteMany({where:{id:tag+'-signature'}})
  await db.employee.deleteMany({where:{id:{in:[employee,tag+'-colleague']}}})
  await db.branchSchedule.deleteMany({where:{id:tag+'-schedule'}})
  await db.branch.deleteMany({where:{name:tag+'-branch'}})
  await db.$disconnect()
}
