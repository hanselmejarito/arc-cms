// Existing attendance retains its previous employee-hours basis. New attendance
// uses the approved shift basis; manual minute adjustments use the new morning
// basis when the cutoff contains new attendance.
export function shiftMinuteDeduction(rate, legacyHours, totalMinutes, morningMinutes, nightMinutes, autoMinutes, hasNewAttendance) {
  const total = Math.max(0, Number(totalMinutes) || 0)
  const morning = Math.max(0, Number(morningMinutes) || 0)
  const night = Math.max(0, Number(nightMinutes) || 0)
  const automatic = Math.max(0, Number(autoMinutes) || 0)
  const legacy = Math.max(0, automatic - morning - night)
  const keptLegacy = Math.min(legacy, total)
  const keptNight = Math.min(night, total - keptLegacy)
  const keptMorning = Math.min(morning, total - keptLegacy - keptNight)
  const adjustment = total - keptLegacy - keptNight - keptMorning
  return rate / 60 * (keptLegacy / legacyHours + keptNight / 7 + keptMorning / 8 + adjustment / (hasNewAttendance ? 8 : legacyHours))
}
