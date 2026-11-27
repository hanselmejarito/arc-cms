export function registryDoseLabel(date, branch, registryBranch) {
  if (!date) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!match) return ''
  return `${match[2]}/${match[3]}/${match[1].slice(2)}${branch && registryBranch && branch !== registryBranch ? ' - '+branch : ''}`
}
