// Resolves the only clinical branch available during an open duty.
// Conflicting open duties fail closed instead of granting either branch.
export function dutyAccessBranch(homeBranch: string | null, attendance: {
  branch: string; clockIn: string; clockOut: string;
  nightBranch: string | null; nightClockIn: string; nightClockOut: string
} | null): string | null {
  if (!attendance) return homeBranch
  const morningOpen = !!attendance.clockIn && !attendance.clockOut
  const nightOpen = !!attendance.nightClockIn && !attendance.nightClockOut
  if (morningOpen && nightOpen) return null
  if (morningOpen) return attendance.branch || null
  if (nightOpen) return attendance.nightBranch || attendance.branch || null
  return homeBranch
}
