// A morning meal review is invalidated only when its shift's times change.
export function shouldResetMorningBreak(field: string, original: string, updated: string, usesBreakReview: boolean): boolean {
  return usesBreakReview && (field === 'clockIn' || field === 'clockOut') && original !== updated
}
