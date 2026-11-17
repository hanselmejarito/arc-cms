const fs = require('fs')
const ts = require('typescript')
const assert = require('node:assert/strict')

function load(file, deps = {}) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const exports = {}
  new Function('require', 'exports', 'module', js)(name => name in deps ? deps[name] : require(name), exports, { exports })
  return exports
}
const basis = load('src/payrollBasis.js')
const shifts = load('lib/shiftPreview.ts')
const data = load('src/data.js', { '../lib/shiftPreview': shifts })
const people = load('src/screens/People.jsx', {
  '../data': data, '../payrollBasis': basis, '../api': {}, '../components': {}, './HrPrint': {}, '../StaffSignatures': {}, '../BranchCorrection': {}
})
const e = { id: 'E', role: 'Nurse', branch: 'Guimba', shift: 'Morning Shift', rate: 840, hours: 6, benefits: false }
const row = (date, extra) => ({ employeeId: 'E', branch: 'Guimba', date, ...extra })
const period = data.payPeriods.find(p => p.from <= '2026-11-14' && p.to >= '2026-11-14')
assert.ok(period)
const input = data.periodInputsFromAttendance(e, period.id, [
  row('2026-11-13', { in: '07:30', out: '16:00' }),
  row('2026-11-14', { in: '07:30', out: '16:00', nightIn: '16:10', nightOut: '23:00' })
])
const result = people.calc(e, input)
assert.ok(Math.abs(result.lateDed - (840 / 6 / 60 * 30 + 840 / 8 / 60 * 10 + 840 / 7 / 60 * 10)) < 0.0001)
assert.equal(result.nightShiftDays, 1)
assert.equal(input.nightShiftMinutes, 60)
assert.equal(result.nightPay, 840 / 7 * 0.1)
const override = people.calc(e, { ...input, late: 50, auto: input })
assert.ok(Math.abs(override.lateDed - result.lateDed - 840 / 8 / 60 * 10) < 0.0001)
const munoz = { ...e, branch: 'Muñoz' }
const m = data.periodInputsFromAttendance(munoz, period.id, [row('2026-11-14', { branch: 'Muñoz', in: '08:00', out: '18:00' })])
assert.equal(m.ot, 1)
assert.equal(people.calc(munoz, m).otPay, 840 / 8 * 1.25)
const historic = data.periodInputsFromAttendance(e, period.id, [row('2026-11-13', { in: '07:30', out: '16:00' })])
assert.equal(people.calc(e, historic).lateDed, 840 / 6 / 60 * 30)
for (const role of ['Admin', 'Secretary', 'PhilHealth Officer']) assert.equal(data.dutyHours(role, 'Morning Shift', 'Guimba', '2026-11-14').start, '08:00')
assert.equal(data.dutyHours('Nurse', 'Morning Shift', 'Guimba', '2026-11-14').start, '07:00')
assert.equal(data.dutyHours('Nurse', 'Morning Shift', 'Cabanatuan', '2026-11-14').start, '07:00')
assert.equal(data.dutyHours('Nurse', 'Morning Shift', 'Paniqui', '2026-11-14').start, '08:00')
assert.equal(data.dutyHours('Nurse', 'Morning Shift', 'Paniqui', '2026-11-14').end, '17:00')
const configured=[{name:'Paniqui',schedules:[{effectiveFrom:'2026-11-14',morningStart:'09:00',morningEnd:'18:00',nurseStart:'09:00',nurseEnd:'18:00',nightEnabled:false}]}]
assert.equal(data.dutyHours('Nurse','Morning Shift','Paniqui','2026-11-13',configured).start,'07:00')
assert.equal(data.dutyHours('Nurse','Morning Shift','Paniqui','2026-11-14',configured).start,'09:00')
assert.equal(data.dutyHours('Nurse','Night Shift','Paniqui','2026-11-14',configured).enabled,false)
const configuredInput=data.periodInputsFromAttendance(e,period.id,[row('2026-11-14',{branch:'Paniqui',in:'09:21',out:'18:00',roleAtMorning:'Nurse',reviewedBreakMinutes:60})],[],[],configured)
assert.equal(configuredInput.late,1)
const partialNoConfig=data.periodInputsFromAttendance(e,period.id,[row('2026-11-14',{branch:'Paniqui',in:'08:21',out:'17:00',roleAtMorning:'Nurse'})],[],[],[])
assert(partialNoConfig.needsReview.length>0)
const reviewedNoConfig=data.periodInputsFromAttendance(e,period.id,[row('2026-11-14',{branch:'Paniqui',in:'08:21',out:'17:00',roleAtMorning:'Nurse',reviewedBreakMinutes:60})],[],[],[])
assert.equal(reviewedNoConfig.needsReview.length,0)
const earlyWork=data.periodInputsFromAttendance(e,period.id,[row('2026-11-14',{branch:'Paniqui',in:'08:00',out:'18:00',roleAtMorning:'Nurse',reviewedBreakMinutes:60})],[],[],configured)
assert.equal(earlyWork.scheduledOt,0);assert(earlyWork.needsReview.some(x=>x.includes('extra work review')))
const nightConfig=[{name:'Guimba',schedules:[{effectiveFrom:'2026-11-14',morningStart:'08:00',morningEnd:'17:00',nurseStart:'07:00',nurseEnd:'16:00',nightEnabled:true,nightStart:'15:00',nightEnd:'22:00'}]}]
const configuredNight=data.periodInputsFromAttendance(e,period.id,[row('2026-11-14',{nightIn:'15:00',nightOut:'22:00',nightBranch:'Guimba',roleAtNight:'Nurse'})],[],[],nightConfig)
assert.equal(configuredNight.nightShiftDays,1);assert.equal(configuredNight.nightShiftMinutes,0)
const invalidNight=[{name:'Guimba',schedules:[{...nightConfig[0].schedules[0],nightStart:'16:00'}]}]
assert(data.periodInputsFromAttendance(e,period.id,[row('2026-11-14',{nightIn:'16:00',nightOut:'22:00',nightBranch:'Guimba',roleAtNight:'Nurse'})],[],[],invalidNight).needsReview.length>0)
const defaultNightMorning=data.periodInputsFromAttendance({...e,shift:'Night Shift'},period.id,[row('2026-11-14',{branch:'Paniqui',in:'08:21',out:'17:00',roleAtMorning:'Nurse'})],[],[])
assert.equal(defaultNightMorning.late,1)
const nightStaffMorning=data.periodInputsFromAttendance({...e,shift:'Night Shift'},period.id,[row('2026-11-14',{branch:'Paniqui',in:'08:00',out:'17:00',roleAtMorning:'Nurse'})],[],[],[])
assert.equal(nightStaffMorning.days,1);assert.equal(nightStaffMorning.late,0);assert.equal(nightStaffMorning.night,0)
assert.equal(data.dutyHours('Admin', 'Morning Shift', 'Palayan', '2026-11-14').end, '18:00')
assert.equal(data.overtimeRoom('Admin', 'Morning Shift', '17:15', 'Guimba', '2026-11-14'), 0)
assert.equal(data.overtimeRoom('Admin', 'Morning Shift', '17:16', 'Guimba', '2026-11-14'), 0.0167)
const admin = { ...e, role: 'Admin' }
const a = data.periodInputsFromAttendance(admin, period.id, [row('2026-11-14', { in: '08:21', out: '17:00' })])
assert.equal(a.late, 1)
const nightEmployee = { ...e, shift: 'Night Shift' }
const legacyNight = data.periodInputsFromAttendance(nightEmployee, period.id, [row('2026-11-14', { in: '16:00', out: '23:00' })])
assert.equal(legacyNight.night, 1)
assert.equal(people.calc(nightEmployee, legacyNight).nightPay, 840 / 7 * 0.1)
const allocator=load('src/dutyAllocation.js')
const branchPayroll=load('src/branchPayroll.js',{'./dutyAllocation':allocator,'./data':data})
const splitAttendance=[row('2026-11-14',{branch:'Paniqui',in:'08:00',out:'17:00',homeBranchAtMorning:'Guimba',roleAtMorning:'Nurse',rateAtMorning:840,officerAtMorning:false,benefitsAtMorning:false,nightBranch:'Guimba',nightIn:'17:00',nightOut:'23:00',homeBranchAtNight:'Guimba',roleAtNight:'Nurse',rateAtNight:840,officerAtNight:false,benefitsAtNight:false})]
const fullInput={...data.periodInputsFromAttendance(e,period.id,splitAttendance,[],[]),obCount:1}
const total=people.calc(e,fullInput,{},1,undefined,{payday:period.half})
const allocated=branchPayroll.branchPayrollRows({employee:e,periodId:period.id,attendance:splitAttendance,users:[],overtimeRequests:[],total,calculate:people.calc})
assert.equal(allocated.needsReview,false)
assert.equal(allocated.rows.find(x=>x.branch==='Paniqui').pay.basic,840)
assert.equal(allocated.rows.find(x=>x.branch==='Guimba').pay.obPay,840)
const transferred=branchPayroll.branchPayrollRows({employee:{...e,branch:'Rizal'},periodId:period.id,attendance:splitAttendance,users:[],overtimeRequests:[],total,calculate:people.calc})
assert.equal(transferred.needsReview,false);assert.equal(transferred.rows.find(x=>x.branch==='Guimba').pay.obPay,840);assert(!transferred.rows.some(x=>x.branch==='Rizal'))
assert.ok(Math.abs(allocated.rows.reduce((sum,x)=>sum+x.pay.net,0)-total.net)<0.01)
assert.equal(branchPayroll.branchPayrollRows({employee:e,periodId:period.id,attendance:splitAttendance,users:[],overtimeRequests:[],total,calculate:people.calc,hasManualAdjustment:true}).needsReview,true)
assert.equal(branchPayroll.branchPayrollRows({employee:e,periodId:period.id,attendance:splitAttendance.map(r=>({...r,homeBranchAtMorning:null})),users:[],overtimeRequests:[],total,calculate:people.calc}).needsReview,true)
assert.equal(branchPayroll.branchPayrollRows({employee:{...e,rate:900},periodId:period.id,attendance:splitAttendance,users:[],overtimeRequests:[],total,calculate:people.calc}).needsReview,true)
const summaryModule=load('src/branchPayrollSummary.js',{'./dutyAllocation':allocator,'./branchPayroll':branchPayroll,'./data':data})
const reportArgs={branches:['Guimba','Paniqui'],employees:[{...e,payroll:true}],attendance:splitAttendance,users:[],payrollInputs:[],contributionOverrides:[],overtimeRequests:[],periodId:period.id,calculate:people.calc}
const report=summaryModule.branchPayrollSummary(reportArgs)
const reportTotal=people.calc(e,data.periodInputsFromAttendance(e,period.id,splitAttendance,[],[]),{},1,undefined,{payday:period.half})
assert.equal(report.length,2);assert.ok(report.every(x=>!x.needsReview))
assert.ok(Math.abs(report.reduce((sum,x)=>sum+x.net,0)-reportTotal.net)<0.01)
const reviewReport=summaryModule.branchPayrollSummary({...reportArgs,payrollInputs:[{employeeId:e.id,periodId:period.id,days:2}]})
assert.ok(reviewReport.every(x=>x.needsReview))
console.log('Shift basis, historical attendance, manual override, night duty and scheduled OT: PASS')
