import { payrollEligibleForPeriod } from './payrollEligibility'
import { attendanceForBranch, hasPayrollAdjustment } from './dutyAllocation'
import { branchPayrollRows } from './branchPayroll'
import { overrideFor, payPeriods, periodInputsFromAttendance } from './data'

export function branchPayrollSummary({branches,employees,attendance,users,payrollInputs,contributionOverrides,overtimeRequests,branchMaster,periodId,calculate}) {
  const period=payPeriods.find(p=>p.id===periodId)
  if(!period)return branches.map(branch=>({branch,count:0,needsReview:true,gross:0,contributions:0,net:0}))
  const result=new Map(branches.map(branch=>[branch,{branch,count:0,needsReview:false,gross:0,contributions:0,net:0}]))
  for(const employee of employees.filter(e=>payrollEligibleForPeriod(e,periodId))) {
    const auto=periodInputsFromAttendance(employee,periodId,attendance,users,overtimeRequests,branchMaster)
    const stored=(payrollInputs||[]).find(x=>x.employeeId===employee.id&&x.periodId===periodId)
    const input={...auto,...(stored||{}),ot:auto.ot,auto}
    const total=calculate(employee,input,overrideFor(contributionOverrides||[],employee.id,periodId)||{},1,branchMaster,{payday:period.half})
    const allocation=branchPayrollRows({employee,periodId,attendance,users,overtimeRequests,total,calculate,branchMaster,hasManualAdjustment:hasPayrollAdjustment(stored,auto),homeBranchSnapshot:stored?.obHomeBranch})
    if(allocation.needsReview){
      const ids=new Set((users||[]).filter(u=>(u.employeeId||u.employee)===employee.id).map(u=>u.id))
      const own=(attendance||[]).filter(r=>r.date>=period.from&&r.date<=period.to&&(r.employeeId===employee.id||ids.has(r.userId)))
      for(const branch of branches)if(branch===employee.branch||own.some(r=>r.homeBranchAtMorning===branch||r.homeBranchAtNight===branch)||attendanceForBranch(own,branch).length)result.get(branch).needsReview=true
      continue
    }
    for(const row of allocation.rows){const dest=result.get(row.branch);if(!dest)continue;dest.count++;dest.needsReview ||= row.needsReview.length>0;dest.gross+=row.pay.gross;dest.contributions+=row.pay.sss+row.pay.phil+row.pay.pagibig;dest.net+=row.pay.net}
  }
  return [...result.values()].filter(r=>r.count||r.needsReview)
}
