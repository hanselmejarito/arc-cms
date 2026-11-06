export type DutyWindow = {
  start: string
  end: string
  regularHours: number
  flexibleMealMinutes?: number
}

const NIGHT: DutyWindow = { start: '16:00', end: '23:00', regularHours: 8 }
const OFFICER: DutyWindow = { start: '08:00', end: '17:00', regularHours: 8 }
const MORNING: DutyWindow = { start: '07:00', end: '16:00', regularHours: 8 }
const BRANCH_MORNING: DutyWindow = { start: '08:00', end: '18:00', regularHours: 8, flexibleMealMinutes: 60 }

export function dutyWindow(input: { branch?: string; role: string; shift: string; date: string; effectiveFrom: string }): DutyWindow {
  if (input.shift === 'Night Shift' || input.shift === 'NS') return NIGHT
  if (['Muñoz', 'Palayan'].includes(input.branch || '') && input.effectiveFrom && input.date >= input.effectiveFrom) return BRANCH_MORNING
  return input.role === 'PhilHealth Officer' ? OFFICER : MORNING
}

function minutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error('Invalid time')
  return Number(match[1]) * 60 + Number(match[2])
}

export type FlexibleDutyResult =
  | { status: 'review'; reason: string }
  | { status: 'calculated'; breakMinutes: number; workedMinutes: number; overtimeMinutes: number }

// A partial day never receives a guessed break; an authorised review must supply it.
export function flexibleDuty(input: { clockIn: string; clockOut: string; reviewedBreakMinutes?: number | null }): FlexibleDutyResult {
  const start = minutes(input.clockIn), end = minutes(input.clockOut)
  if (end <= start) return { status: 'review', reason: 'Invalid or overnight attendance' }
  const elapsed = end - start
  const partial = start > minutes('08:00') || end < minutes('18:00')
  const reviewed = input.reviewedBreakMinutes
  if (reviewed == null && partial) return { status: 'review', reason: 'Partial duty: break requires review' }
  const breakMinutes = reviewed == null ? 60 : reviewed
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 60 || breakMinutes > elapsed)
    return { status: 'review', reason: 'Invalid reviewed break' }
  const workedMinutes = elapsed - breakMinutes
  return { status: 'calculated', breakMinutes, workedMinutes, overtimeMinutes: Math.max(0, workedMinutes - 480) }
}