import { attendanceForBranch, allocateBranchPayroll } from './dutyAllocation'
import { payPeriods, periodInputsFromAttendance, today } from './data'
import { currentPayrollPeriod } from './payrollEligibility'

// Produce reviewable duty allocation only when it reconciles to the complete
// employee cutoff. Manual multi-branch adjustments require human review.
export function branchPayrollRows({employee,periodId,attendance,users,overtimeRequests,total,calculate,branchMaster,hasManualAdjustment,homeBranchSnapshot}) {
  const period=payPeriods.find(p=>p.id===periodId)
  if (!period) return {needsReview:true,reason:'Unknown payroll period.',rows:[]}
  const ids=new Set((users||[]).filter(u=>(u.employeeId||u.employee)===employee.id).map(u=>u.id))
  const records=(attendance||[]).filter(r=>r.date>=period.from&&r.date<=period.to&&(r.employeeId===employee.id||ids.has(r.userId)))
  const dutyBranches=[...new Set(records.flatMap(r=>[r.in?r.branch:null,r.nightIn?(r.nightBranch||r.branch):null]).filter(Boolean))]
  const homes=[...new Set(records.flatMap(r=>[r.in?r.homeBranchAtMorning:null,r.nightIn?r.homeBranchAtNight:null]).filter(Boolean))]
  const missingHome=records.some(r=>(r.in&&!r.homeBranchAtMorning)||(r.nightIn&&!r.homeBranchAtNight))
  if (homes.length>1 || missingHome) return {needsReview:true,reason:'Home branch during the cutoff requires Admin review.',rows:[]}
  const snapshots=records.flatMap(r=>[...(r.in?[{role:r.roleAtMorning,rate:r.rateAtMorning,officer:r.officerAtMorning,benefits:r.benefitsAtMorning}]:[]),...(r.nightIn?[{role:r.roleAtNight,rate:r.rateAtNight,officer:r.officerAtNight,benefits:r.benefitsAtNight}]:[])])
  const currentCutoff = periodId === currentPayrollPeriod(today)
  if (snapshots.some(x=>!x.role||x.rate==null||x.officer==null||x.benefits==null||x.role!==employee.role||Number(x.rate)!==Number(employee.rate)||x.officer!==!!employee.officer||(!currentCutoff && x.benefits!==(employee.benefits!==false)))) return {needsReview:true,reason:'Duty role, rate or eligibility requires Admin review.',rows:[]}
  const homeBranch=homes[0]||employee.branch
  if (homeBranchSnapshot && homeBranchSnapshot !== homeBranch) return {needsReview:true,reason:'The recorded home branch differs from the duty snapshot.',rows:[]}
  const duties=dutyBranches.map(branch=>{
    const rows=attendanceForBranch(records,branch)
    const dates=new Set(rows.filter(r=>r.in).map(r=>r.date))
    const requests=(overtimeRequests||[]).filter(r=>r.employeeId===employee.id&&dates.has(r.date))
    const auto=periodInputsFromAttendance(employee,periodId,rows,users,requests,branchMaster)
    const pay=calculate({...employee,branch,officer:false,benefits:false},{...auto,holiday:0,holidayRegular:0,holidaySpecial:0,obCount:0,other:0},{},1,branchMaster,{payday:period.half})
    return {branch,pay,auto}
  })
  const allocation=allocateBranchPayroll(total,duties,homeBranch,hasManualAdjustment)
  if (allocation.needsReview) return allocation
  return {...allocation,rows:allocation.rows.map(row=>{
    const duty=duties.find(x=>x.branch===row.branch)
    return {...row,pay:{...row.pay,days:duty?.pay.days||0,calendarDays:duty?.pay.calendarDays||0,nightShiftDays:duty?.pay.nightShiftDays||0,obCount:row.branch===homeBranch?(Number(total.obCount)||0):0},needsReview:duty?.auto.needsReview||[]}
  })}
}
