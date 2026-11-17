const fs = require('fs')
const ts = require('typescript')
const assert = require('node:assert/strict')
const source=ts.transpileModule(fs.readFileSync('src/dutyAllocation.js','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const exportsObject={};new Function('exports',source)(exportsObject)
const {attendanceForBranch,deductionsForBranch,allocateBranchPayroll,hasPayrollAdjustment}=exportsObject
const original={date:'2026-11-15',branch:'Paniqui',in:'08:00',out:'17:00',nightBranch:'Guimba',nightIn:'17:00',nightOut:'23:00',reviewedBreakMinutes:45}
const morning=attendanceForBranch([original],'Paniqui')[0]
const night=attendanceForBranch([original],'Guimba')[0]
assert.equal(morning.in,'08:00');assert.equal(morning.nightIn,'')
assert.equal(night.in,'');assert.equal(night.nightIn,'17:00');assert.equal(night.branch,'Guimba');assert.equal(night.reviewedBreakMinutes,null)
assert.equal(attendanceForBranch([original],'Baloc').length,0)
assert.equal(attendanceForBranch([{...original,nightBranch:null}],'Paniqui')[0].nightIn,'17:00')
assert.equal(original.nightIn,'17:00')
const deductions={sss:675,phil:337.5,pagibig:200,other:20}
assert.deepEqual(deductionsForBranch(deductions,'Guimba','Guimba'),deductions)
assert.deepEqual(deductionsForBranch(deductions,'Paniqui','Guimba'),{sss:0,phil:0,pagibig:0,other:0})
assert.equal(hasPayrollAdjustment({days:1,obCount:1},{days:1}),false)
assert.equal(hasPayrollAdjustment({days:2,obCount:1},{days:1}),true)
const total={basic:1700,otPay:100,nightPay:12,lateDed:20,underDed:10,holidayPay:100,regularHolidayPay:100,specialHolidayPay:0,obPay:850,allowance:500,sss:675,phil:337.5,pagibig:200,other:20,net:1999.5}
const duties=[{branch:'Paniqui',pay:{basic:850,otPay:100,nightPay:0,lateDed:0,underDed:10}},{branch:'Guimba',pay:{basic:850,otPay:0,nightPay:12,lateDed:20,underDed:0}}]
const split=allocateBranchPayroll(total,duties,'Guimba')
assert.equal(split.needsReview,false)
assert.equal(split.rows.find(x=>x.branch==='Paniqui').pay.net,940)
assert.equal(split.rows.find(x=>x.branch==='Guimba').pay.holidayPay,100)
assert.equal(split.rows.find(x=>x.branch==='Guimba').pay.sss,675)
assert.equal(allocateBranchPayroll(total,duties,'Guimba',true).needsReview,true)
assert.equal(allocateBranchPayroll({...total,basic:1701},duties,'Guimba').needsReview,true)
console.log('Branch-specific morning, night and legacy attendance allocation: PASS')
