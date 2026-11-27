const names = { laur: 'ARV ANIMAL BITE CLINIC', munoz: 'LIFEMED-ANIMAL BITE AND VACCINATION CLINIC' }
export function clinicName(branch, fallback = 'ARC ANTI-RABIES VACCINE CLINIC') {
  const key = String(branch || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
  return names[key] || fallback
}

export function isLifeMedBranch(branch) { return String(branch || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'munoz' }
