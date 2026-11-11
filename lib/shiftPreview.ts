// HR demonstration policy. This calculator does not change payroll or attendance records.
export type DemoShift = 'morning' | 'night'
const parse = (value: string) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Use HH:mm time.')
  const [h,m] = value.split(':').map(Number)
  return h*60+m
}
const overlap = (a:number,b:number,c:number,d:number) => Math.max(0,Math.min(b,d)-Math.max(a,c))
export function previewShift(input:{shift:DemoShift; scheduledStart:string; scheduledEnd:string; clockIn:string; clockOut:string; reviewedBreakMinutes?:number}){
  const start=parse(input.clockIn),end=parse(input.clockOut),scheduledStart=parse(input.scheduledStart),scheduledEnd=parse(input.scheduledEnd)
  if(end<=start||scheduledEnd<=scheduledStart) throw new Error('Invalid shift interval.')
  const actualBreak=overlap(start,end,720,780)
  const meal=input.shift==='night'?0:(input.reviewedBreakMinutes??actualBreak)
  if(!Number.isInteger(meal)||meal<0||meal>actualBreak) throw new Error('Invalid break adjustment.')
  const actualMinutes=end-start-meal
  const rawLate=Math.max(0,start-scheduledStart)
  const actualAfterShift=Math.max(0,end-scheduledEnd)
  // Scheduled work beyond eight actual hours is separate from time after shift.
  const scheduledWorked=Math.max(0,Math.min(end,scheduledEnd)-start-meal)
  const scheduledOvertimeMinutes=Math.max(0,scheduledWorked-480)
  return {actualMinutes,mealMinutes:meal,rawLateMinutes:rawLate,lateMinutes:input.shift==='morning'?Math.max(0,rawLate-20):rawLate,scheduledOvertimeMinutes,actualAfterShiftMinutes:actualAfterShift,otReviewMinutes:Math.max(0,actualAfterShift-15),nightDifferentialMinutes:overlap(start,end,1320,1440)}
}

// Preview only: seven-hour night shift, with no unpaid meal break.
// Overtime premiums and actual payroll records require separate review.
export function previewNightPay(input: {
  dailyRateCentavos: number
  clockIn: string
  clockOut: string
  nightDifferentialRate: number
}) {
  const { dailyRateCentavos, nightDifferentialRate } = input
  if (!Number.isSafeInteger(dailyRateCentavos) || dailyRateCentavos < 0 ||
      !Number.isFinite(nightDifferentialRate) || nightDifferentialRate < 0)
    throw new Error('Invalid rate.')
  const start = parse(input.clockIn), end = parse(input.clockOut)
  if (end <= start) throw new Error('Invalid shift interval.')
  const scheduledStart = 16 * 60, scheduledEnd = 23 * 60
  const worked = overlap(start, end, scheduledStart, scheduledEnd)
  const missed = 420 - worked
  const nightMinutes = overlap(start, end, 22 * 60, scheduledEnd)
  const deductionCentavos = Math.round(dailyRateCentavos * missed / 420)
  const differentialCentavos = Math.round(dailyRateCentavos / 7 * nightDifferentialRate * nightMinutes / 60)
  return { workedMinutes: worked, missedMinutes: missed, nightMinutes, deductionCentavos, differentialCentavos,
    shiftPayCentavos: dailyRateCentavos - deductionCentavos, totalCentavos: dailyRateCentavos - deductionCentavos + differentialCentavos }
}
