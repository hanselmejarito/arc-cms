export const TODAY = '2026-10-14'
export const GRACE_DAYS = 7
export const ALL_BRANCH_ROLES = ['Admin', 'HR']
export const NURSE_ROLE = 'Nurse / Staff'
export const HIGH_RISK_SITES = new Set(['Head', 'Hand', 'Foot'])
export const BRANCH_CODES: Record<string, string> = {
  Guimba: 'GUI', Baloc: 'BAL', Talavera: 'TAV', Cabanatuan: 'CAB', Palayan: 'PAL',
  Laur: 'LAU', Paniqui: 'PAN', Rizal: 'RIZ', Talugtug: 'TLG', Gapan: 'GAP', Muñoz: 'MUN'
}

export const PAGE_ACCESS: Record<string, string[]> = {
  HR: ['dashboard', 'employees', 'attendance', 'payroll', 'payslips', 'reports'],
  'Nurse / Staff': ['dashboard', 'patients', 'admissions', 'exposure', 'treatments', 'notes', 'schedule', 'stock', 'receiving', 'usage', 'alerts', 'invreport', 'referrals', 'registry', 'doh', 'attendance', 'payslips'],
  'PO / PhilHealth Officer': ['dashboard', 'patients', 'admissions', 'exposure', 'treatments', 'notes', 'schedule', 'stock', 'receiving', 'usage', 'adjustments', 'alerts', 'invreport', 'payments', 'finance', 'referrals', 'refunds', 'reports', 'registry', 'doh', 'attendance', 'payslips'],
  Secretary: ['dashboard', 'patients', 'admissions', 'schedule', 'payments', 'referrals', 'registry', 'attendance', 'payslips'],
  Cashier: ['dashboard', 'patients', 'payments', 'finance', 'referrals', 'refunds', 'reports', 'attendance', 'payslips'],
  Employee: ['dashboard', 'attendance', 'payslips']
}

export const canPage = (role: string, page: string) => !PAGE_ACCESS[role] || PAGE_ACCESS[role].includes(page)

const PROTOCOLS: Record<string, { label: string; route: string; days: [string, number][] }> = {
  ID: { label: 'Intradermal (ID)', route: 'ID', days: [['D0', 0], ['D3', 3], ['D7', 7], ['D28', 28]] },
  IM: { label: 'Intramuscular (IM)', route: 'IM', days: [['D0', 0], ['D3', 3], ['D7', 7], ['D14', 14], ['D28', 28]] },
  BOOSTER: { label: 'Booster', route: 'ID', days: [['D0', 0], ['D3', 3]] },
  PREEXP: { label: 'Pre-exposure (PrEP)', route: 'ID', days: [['D0', 0], ['D2', 2], ['D14P', 14]] }
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
  seriesStartDate?: string | null
  continuedFromEncounterId?: string | null
  receivingEncounterId?: string | null
}

export type DoseLike = { encounterId: string; day: string; date: string }

export function addDays(d: string, n: number) {
  const x = new Date(d.slice(0, 10) + 'T00:00:00Z')
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

export function protocolOf(e: Pick<EncounterLike, 'regimen' | 'preExp' | 'booster'>) {
  const route = PROTOCOLS[e.regimen]?.route || 'ID'
  if (e.preExp) return { ...PROTOCOLS.PREEXP, route, label: `Pre-exposure (${route})` }
  if (e.booster) return { ...PROTOCOLS.BOOSTER, route, label: `Booster (${route})` }
  return PROTOCOLS[e.regimen] || PROTOCOLS.ID
}

export const seriesStart = (e: EncounterLike) => e.seriesStartDate || e.date

export function caseInfo(e: EncounterLike, allDoses: DoseLike[]) {
  const linkedIds = new Set([e.id, e.continuedFromEncounterId, e.receivingEncounterId].filter(Boolean) as string[])
  const given = allDoses.filter(d => linkedIds.has(d.encounterId))
  if (e.rer === false) return { given, next: null as null, status: 'For RER', outcome: '' }
  if (e.died) return { given, next: null, status: 'Died', outcome: 'D' }
  if (!e.preExp && (e.category === 'I' || !e.pepEligible)) return { given, next: null, status: 'No PEP', outcome: 'N' }
  const d0 = seriesStart(e)
  const pending = protocolOf(e).days.filter(([d]) => !given.some(g => g.day === d))
  if (!pending.length) return { given, next: null, status: 'Complete', outcome: 'C' }
  const [day, off] = pending[0]
  const due = addDays(d0, off)
  const lapsed = due < addDays(TODAY, -GRACE_DAYS)
  return { given, next: { day, due }, status: lapsed ? 'Incomplete' : 'Ongoing', outcome: lapsed ? 'Inc' : '' }
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

export function ageFrom(b: string, today = TODAY) {
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
export const visitNeedsPay = (billing: string) => billing === 'Walk-in'
export const visitPaid = (pays: { encounterId: string; status: string; amount: number }[], eid: string) =>
  pays.some(p => p.encounterId === eid && p.status === 'Paid' && Number(p.amount) > 0)

export const DAY_LABEL: Record<string, string> = {
  D0: 'Day 0', D2: 'Day 2', D3: 'Day 3', D7: 'Day 7', D14: 'Day 14', D14P: 'Day 14/28', D28: 'Day 21/28'
}

export const blankHistory = { iddm: false, kidney: false, dialysis: false, cancer: false, allergy: false, steroids: false, insulin: false, others: '' }
export const blankTt = { given: false, date: '', time: '', refused: false, withPrevious: false }
export const blankErig = { brand: '', date: '', skinTime: '', skinResult: '', weight: '', infiltration: false, ml: '', refused: false }
export const blankProgress = { healthy: false, healed: false, others: '' }
