export const clinicDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
export const GRACE_DAYS = 7
export const SUPERADMIN_ROLE = 'Superadmin'
export const ADMIN_ROLE = 'Admin'
export const FULL_ACCESS_ROLES = [SUPERADMIN_ROLE, ADMIN_ROLE]
export const ALL_BRANCH_ROLES = [SUPERADMIN_ROLE, ADMIN_ROLE]
export const NURSE_ROLE = 'Nurse'
export const HIGH_RISK_SITES = new Set(['Head', 'Hand', 'Foot'])
export const BRANCH_CODES: Record<string, string> = {
  Guimba: 'GUI', Baloc: 'BAL', Talavera: 'TAV', Cabanatuan: 'CAB', Palayan: 'PAL',
  Laur: 'LAU', Paniqui: 'PAN', Rizal: 'RIZ', Talugtug: 'TLG', Gapan: 'GAP', Muñoz: 'MUN', Cuyapo: 'CUY'
}

export const PAGE_ACCESS: Record<string, string[]> = {
  'Nurse': ['dashboard', 'patients', 'admissions', 'exposure', 'treatments', 'notes', 'schedule', 'stock', 'receiving', 'usage', 'adjustments', 'alerts', 'invreport', 'payments', 'finance', 'referrals', 'refunds', 'reports', 'registry', 'doh', 'attendance', 'payslips'],
  'PhilHealth Officer': ['dashboard', 'patients', 'admissions', 'exposure', 'treatments', 'notes', 'schedule', 'referrals', 'refunds', 'reports', 'registry', 'doh', 'attendance', 'payslips'],
  Secretary: ['dashboard', 'patients', 'admissions', 'exposure', 'treatments', 'notes', 'schedule', 'payments', 'finance', 'referrals', 'refunds', 'reports', 'registry', 'doh', 'attendance', 'payslips']
}

export const canPage = (role: string, page: string) => FULL_ACCESS_ROLES.includes(role) || (PAGE_ACCESS[role]?.includes(page) ?? false)

const PROTOCOLS: Record<string, { label: string; route: string; days: [string, number][] }> = {
  ID: { label: 'Intradermal (ID)', route: 'ID', days: [['D0', 0], ['D3', 3], ['D7', 7], ['D28', 28]] },
  IM: { label: 'Intramuscular (IM)', route: 'IM', days: [['D0', 0], ['D3', 3], ['D7', 7], ['D14', 14], ['D28', 28]] },
  BOOSTER: { label: 'Booster', route: 'ID', days: [['D0', 0], ['D3', 3]] },
  PREEXP: { label: 'Pre-exposure (PrEP)', route: 'ID', days: [['D0', 0], ['D7', 7], ['D21', 21]] }
}

export type EncounterLike = {
  id: string
  date: string
  rer: boolean
  died: boolean
  preExp: boolean
  booster: boolean
  category: string
  pepEligible: boolean
  regimen: string
  remark: string
  animalStatus?: string
  biteDate?: string
  seriesStartDate?: string | null
  continuedFromEncounterId?: string | null
  receivingEncounterId?: string | null
}

export type DoseLike = { encounterId: string; day: string; date: string; animalStatus?: string }

const ID_DAYS: [string, number][] = [['D0', 0], ['D3', 3], ['D7', 7], ['D28', 28]]
const ID_DAYS_D14: [string, number][] = [['D0', 0], ['D3', 3], ['D7', 7], ['D14', 14], ['D28', 28]]

export function addDays(d: string, n: number) {
  const x = new Date(d.slice(0, 10) + 'T00:00:00Z')
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

export function observationEnd(e: Pick<EncounterLike, 'biteDate' | 'seriesStartDate' | 'date'>) {
  const start = (e.biteDate || e.seriesStartDate || e.date || '').slice(0, 10)
  return start ? addDays(start, 14) : ''
}

export function day14Required(e: EncounterLike, allDoses: DoseLike[] = []) {
  if (e.preExp || e.booster || (e.regimen || 'ID') !== 'ID') return false
  const until = observationEnd(e)
  if (!until) return false
  const reported = linkedDoses(e, allDoses)
    .filter(d => d.animalStatus === 'Lost/Stray' || d.animalStatus === 'Dead')
    .map(d => d.date)
    .filter(Boolean)
    .sort()[0]
  if (reported) return reported <= until
  if (e.animalStatus === 'Lost/Stray' || e.animalStatus === 'Dead') return (e.date || until).slice(0, 10) <= until
  return false
}

export function protocolOf(e: EncounterLike, allDoses: DoseLike[] = []) {
  const route = PROTOCOLS[e.regimen]?.route || 'ID'
  if (e.preExp) return { ...PROTOCOLS.PREEXP, route, label: `Pre-exposure (${route})` }
  if (e.booster) return { ...PROTOCOLS.BOOSTER, route, label: `Booster (${route})` }
  if (e.regimen === 'IM') return PROTOCOLS.IM
  return { label: 'Intradermal (ID)', route: 'ID', days: day14Required(e, allDoses) ? ID_DAYS_D14 : ID_DAYS }
}

export const seriesStart = (e: EncounterLike) => e.seriesStartDate || e.date

export function linkedDoses(e: EncounterLike, allDoses: DoseLike[]) {
  const linkedIds = new Set([e.id, e.continuedFromEncounterId, e.receivingEncounterId].filter(Boolean) as string[])
  return allDoses.filter(d => linkedIds.has(d.encounterId))
}

export function scheduleDates(e: EncounterLike, allDoses: DoseLike[]) {
  const given = linkedDoses(e, allDoses)
  let anchor = seriesStart(e)
  let anchorOff = 0
  const dates: Record<string, { due: string; given: DoseLike | null }> = {}
  for (const [day, off] of protocolOf(e, allDoses).days) {
    const g = given.find(x => x.day === day) || null
    dates[day] = { due: addDays(anchor, off - anchorOff), given: g }
    if (g) {
      anchor = g.date
      anchorOff = off
    }
  }
  return dates
}

export function caseInfo(e: EncounterLike, allDoses: DoseLike[]) {
  const given = linkedDoses(e, allDoses)
  if (e.rer === false) return { given, next: null as null, status: 'For RER', outcome: '' }
  if (e.died) return { given, next: null, status: 'Died', outcome: 'D' }
  if (!e.preExp && !e.booster && (e.category === 'I' || !e.pepEligible)) return { given, next: null, status: 'No PEP', outcome: 'N' }
  const pending = protocolOf(e, allDoses).days.filter(([d]) => !given.some(g => g.day === d))
  if (!pending.length) return { given, next: null, status: 'Complete', outcome: 'C' }
  const [day] = pending[0]
  const due = scheduleDates(e, allDoses)[day].due
  const lapsed = due < addDays(clinicDate(), -GRACE_DAYS)
  return { given, next: { day, due }, status: lapsed ? 'Incomplete' : 'Ongoing', outcome: lapsed ? 'Inc' : '' }
}

export function refundCutoff(e: EncounterLike, allDoses: DoseLike[]) {
  const dates = scheduleDates(e, allDoses)
  return dates.D7 ? dates.D7.due : addDays(seriesStart(e), 7)
}

export function refundEligible(e: EncounterLike, allDoses: DoseLike[], asOf = clinicDate()) {
  return asOf <= refundCutoff(e, allDoses)
}

export const refundIsOpen = (status: string) => status !== 'Rejected'

export function refundRemaining(
  cap: number,
  refunds: { payment: string, amount: number, status: string }[],
  paymentIds: string[]
) {
  const ids = new Set(paymentIds)
  const used = refunds
    .filter(r => ids.has(r.payment) && refundIsOpen(r.status))
    .reduce((s, r) => s + Number(r.amount || 0), 0)
  return Math.max(0, Math.round((Number(cap || 0) - used) * 100) / 100)
}

export function statusOf(e: EncounterLike, doses: DoseLike[]) {
  if (e.remark === 'Transferred') return 'Transferred'
  return e.rer ? caseInfo(e, doses).status : 'For RER'
}

export function pad(n: number, l = 4) {
  return String(n).padStart(l, '0')
}

export function fullName(p: { last?: string; first?: string; middle?: string; suffix?: string }) {
  const last = (p.last || '').trim(), first = (p.first || '').trim(), mid = (p.middle || '').trim(), suf = (p.suffix || '').trim()
  const mi = mid ? mid[0].toUpperCase() + '.' : ''
  return [last && first ? last + ', ' + first : last || first, mi, suf].filter(Boolean).join(' ')
}

export function ageFrom(b: string, today = clinicDate()) {
  if (!b) return 0
  const [y, m, d] = b.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  return ty - y - ((tm < m || (tm === m && td < d)) ? 1 : 0)
}

export const normalized = (v: string) => (v || '').trim().toLowerCase()
export function samePerson(a: { last: string; first: string; middle?: string; birthday: string }, b: typeof a) {
  return normalized(a.last) === normalized(b.last)
    && normalized(a.first) === normalized(b.first)
    && normalized(a.middle || '') === normalized(b.middle || '')
    && a.birthday === b.birthday
}

export const isAccredited = (accreditation: string) => accreditation === 'Accredited'
export const isPhilhealthBill = (c: string) => c === 'PhilHealth' || c === 'For PhilHealth'
export const visitNeedsPay = (enc: { billing: string, booster?: boolean, category?: string }) => !!enc.booster || (enc.billing === 'Walk-in' && enc.category !== 'I')
export const visitPaid = (pays: { encounterId: string; status: string; amount: number }[], eid: string) =>
  pays.some(p => p.encounterId === eid && p.status === 'Paid' && Number(p.amount) > 0)

export const DAY_LABEL: Record<string, string> = {
  D0: 'Day 0', D2: 'Day 2', D3: 'Day 3', D7: 'Day 7', D14: 'Day 14', D21: 'Day 21/28', D14P: 'Day 14/28', D28: 'Day 21/28'
}

export const blankHistory = { iddm: null, kidney: null, dialysis: null, cancer: null, allergy: null, steroids: null, insulin: null, others: '' }
export const blankTt = { given: false, date: '', time: '', refused: false, withPrevious: false }
export const blankErig = { brand: '', date: '', skinTime: '', skinResult: '', weight: '', infiltration: null, ml: '', refused: false }
export const blankProgress = { healthy: false, healed: false, others: '' }
