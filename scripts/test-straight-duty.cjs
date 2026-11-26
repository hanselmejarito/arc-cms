// Synthetic calculations only. Does not touch the database.
const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict')
function load(path,deps={}) {
  const js=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  const exports={}
  new Function('exports','require',js)(exports,n=>deps[n]||require(n))
  return exports
}
const data=load('src/data.js',{'../lib/shiftPreview':load('lib/shiftPreview.ts'),'./timeFormat':load('src/timeFormat.js')})
const people=fs.readFileSync('src/screens/People.jsx','utf8')
const calcSource=people.slice(people.indexOf('export function calc('),people.indexOf('export function EmployeesPage'))
const calcJs=ts.transpileModule(calcSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const exportsCalc={}
new Function('exports','nightOf','statutoryCutoff','applyContribution','shiftMinuteDeduction',calcJs)(exportsCalc,()=>true,()=>({}),x=>x,load('src/payrollBasis.js').shiftMinuteDeduction)
const employee={id:'synthetic',branch:'Guimba',shift:'Morning Shift',role:'Nurse',rate:850,hours:8,benefits:false}
const full={employeeId:'synthetic',branch:'Guimba',date:'2026-11-12',in:'07:00',out:'16:00',nightIn:'16:00',nightOut:'23:00'}
const calc=row=>{const input=data.periodInputsFromAttendance(employee,'all',[row],[],[]);return {input,pay:exportsCalc.calc(employee,input,{},1,[])}}
let r=calc(full)
assert.equal(r.input.calendarDays,1);assert.equal(r.input.days,1);assert.equal(r.input.nightShiftDays,1)
assert.equal(r.pay.basic,1700);assert(Math.abs(r.pay.nightPay-850/7*.1)<1e-9)
r=calc({...full,nightIn:'16:10'});assert.equal(r.input.nightLate,10);assert(Math.abs(r.pay.lateDed-850/7/6)<1e-9)
// The newly approved night grace period takes effect on November 15.
r=calc({...full,date:'2026-11-15',nightIn:'16:20'});assert.equal(r.input.nightLate,0);assert.equal(r.input.nightUndertime,0);assert.equal(r.pay.lateDed,0)
r=calc({...full,date:'2026-11-15',nightIn:'16:21'});assert.equal(r.input.nightLate,1);assert.equal(r.input.nightUndertime,0);assert(Math.abs(r.pay.lateDed-850/7/60)<1e-9)
r=calc({...full,date:'2026-11-15',nightIn:'16:20',nightOut:'22:30'});assert.equal(r.input.nightLate,0);assert.equal(r.input.nightUndertime,30)
r=calc({...full,nightOut:'22:30'});assert.equal(r.input.nightUndertime,30);assert.equal(r.input.nightShiftMinutes,30)
r=calc({...full,in:'',out:''});assert.equal(r.input.calendarDays,1);assert.equal(r.pay.basic,850)
r=calc({...full,nightOut:''});assert(r.input.needsReview.some(x=>x.includes('night')))
r=calc({...full,nightOut:'23:01'});assert(r.input.needsReview.some(x=>x.includes('night overtime')), 'Before the policy start, overtime still requires review')
for(const out of ['23:00','23:06','23:15']){r=calc({...full,date:'2026-11-25',nightOut:out});assert(!r.input.needsReview.some(x=>x.includes('night overtime')),out+' is within the 15-minute window');assert.equal(r.input.ot,0)}
r=calc({...full,date:'2026-11-25',nightOut:'23:16'});assert(r.input.needsReview.some(x=>x.includes('night overtime')), 'After the window, overtime still requires review')
console.log('Straight duty, night-only, late, undertime, differential, incomplete and overtime review: PASS')
