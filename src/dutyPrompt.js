// A morning duty must be closed before a separate night duty can begin.
export function dutyPromptOptions({record,branches,enabled,blocked}) {
  if(blocked)return {morning:false,night:false}
  const morning=!record?.in&&!record?.nightIn
  const night=!!enabled&&!record?.nightIn&&(!record?.in||!!record?.out)&&(branches||[]).some(b=>b.status==='Active'&&b.night)
  return {morning,night}
}

export function dutyPromptDismissalKey(userId, date, options) {
  if (!userId || !date || (!options.morning && !options.night)) return ''
  return `arc-duty-prompt:${encodeURIComponent(userId)}:${date}:${options.morning ? 'morning' : 'night'}`
}

export function wasDutyPromptDismissed(storage, key) {
  if (!storage || !key) return false
  try { return storage.getItem(key) === '1' } catch { return false }
}

export function dismissDutyPrompt(storage, key) {
  if (!storage || !key) return
  try { storage.setItem(key, '1') } catch { /* In-memory dismissal still applies. */ }
}
