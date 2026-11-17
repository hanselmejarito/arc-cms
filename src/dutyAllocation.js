// A morning and a night duty on one date may belong to different branches.
// Return independent copies so callers never mutate the recorded attendance.
export function attendanceForBranch(attendance, branch) {
  if (branch === 'All branches') return (attendance || []).map(row => ({ ...row }))
  return (attendance || []).flatMap(row => {
    const morning = Boolean(row.in) && row.branch === branch
    const night = Boolean(row.nightIn) && (row.nightBranch || row.branch) === branch
    if (!morning && !night) return []
    return [{ ...row,
      in: morning ? row.in : '', out: morning ? row.out : '',
      nightIn: night ? row.nightIn : '', nightOut: night ? row.nightOut : '',
      branch: morning ? row.branch : (row.nightBranch || row.branch),
      ...(morning ? {} : { reviewedBreakMinutes: null, breakReviewedAt: null, breakReviewedBy: null })
    }]
  })
}

// Apply cutoff-level deductions once, to the employee's home branch.
export function deductionsForBranch(amounts, branch, homeBranch) {
  const keys = ['sss','phil','pagibig','other']
  return Object.fromEntries(keys.map(key => [key, branch === homeBranch ? (Number(amounts?.[key]) || 0) : 0]))
}

// An OB entry alone is not a manual change to attendance. Compare saved
// attendance/holiday overrides with the current automatic cutoff inputs.
export function hasPayrollAdjustment(stored, automatic) {
  if (!stored) return false
  const fields=['days','late','undertime','night','holidayRegular','holidaySpecial']
  return fields.some(key=>stored[key]!=null&&Number(stored[key]||0)!==Number(automatic?.[key]||0)) || Number(stored.other||0)!==0
}

// Cutoff-level items are charged once to the home branch. Duty amounts come
// from the corresponding branch's own attendance calculation. If their sum
// cannot reproduce the employee cutoff, do not issue branch totals.
export function allocateBranchPayroll(total, duties, homeBranch, hasManualAdjustment = false) {
  const dutyFields=['basic','otPay','nightPay','lateDed','underDed']
  const homeFields=['regularHolidayPay','specialHolidayPay','holidayPay','obPay','allowance','sss','phil','pagibig','sssEr','sssEc','philEr','pagibigEr','other']
  const branches=[...new Set([homeBranch,...duties.map(x=>x.branch)].filter(Boolean))]
  if (!homeBranch || !branches.length) return {needsReview:true,reason:'Home branch is required.',rows:[]}
  if (hasManualAdjustment && duties.length>1) return {needsReview:true,reason:'Manual payroll adjustment spans multiple branches.',rows:[]}
  for (const key of dutyFields) {
    const sum=duties.reduce((v,x)=>v+(Number(x.pay[key])||0),0)
    if (Math.abs(sum-(Number(total[key])||0))>0.01) return {needsReview:true,reason:'Branch duty totals do not match the employee payroll.',rows:[]}
  }
  const rows=branches.map(branch=>{
    const pay={}
    for(const key of dutyFields)pay[key]=duties.filter(x=>x.branch===branch).reduce((v,x)=>v+(Number(x.pay[key])||0),0)
    for(const key of homeFields)pay[key]=branch===homeBranch?(Number(total[key])||0):0
    pay.gross=pay.basic+pay.otPay+pay.nightPay+pay.holidayPay+pay.obPay+pay.allowance
    pay.net=pay.gross-pay.lateDed-pay.underDed-pay.sss-pay.phil-pay.pagibig-pay.other
    return {branch,pay}
  })
  if (Math.abs(rows.reduce((v,x)=>v+x.pay.net,0)-(Number(total.net)||0))>0.01) return {needsReview:true,reason:'Branch net pay does not match the employee payroll.',rows:[]}
  return {needsReview:false,reason:'',rows}
}
