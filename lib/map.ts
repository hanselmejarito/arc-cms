import type {
  Attendance, Branch, Dose, Employee, Encounter, FinanceEntry, InventoryLine,
  LedgerRow, Movement, Patient, Payment, ProgressNote, ReceivedRow, Referral, Refund, User
} from '@prisma/client'

export function patientClient(p: Patient) {
  return {
    id: p.id,
    first: p.first,
    middle: p.middle,
    last: p.last,
    suffix: p.suffix,
    name: p.name,
    birthday: p.birthday,
    age: p.age,
    sex: p.sex,
    contact: p.contact,
    address: p.address,
    municipality: p.municipality,
    municipalityOther: p.municipalityOther,
    guardian: p.guardian,
    senior: p.senior,
    pwd: p.pwd,
    vetmed: p.vetmed,
    philhealth: p.philhealth,
    branch: p.branch,
    classification: p.classification
  }
}

export function patientDirectory(p: Patient, lastRegistry?: string) {
  return {
    id: p.id,
    first: p.first,
    middle: p.middle,
    last: p.last,
    suffix: p.suffix,
    name: p.name,
    birthday: p.birthday,
    contact: p.contact,
    address: p.address,
    branch: p.branch,
    lastRegistry: lastRegistry || ''
  }
}

export function encounterClient(e: Encounter) {
  return {
    id: e.id,
    registry: e.registry,
    patientId: e.patientId,
    branch: e.branch,
    date: e.date,
    time: e.time,
    chief: e.chief,
    animal: e.animal,
    animalOther: e.animalOther,
    biteType: e.biteType,
    pet: e.pet,
    vaccinated: e.vaccinated,
    stray: e.stray,
    owned: e.owned,
    owner: e.owner,
    biteDate: e.biteDate,
    biteTime: e.biteTime,
    side: e.side,
    site: e.site,
    place: e.place,
    washed: e.washed,
    tandok: e.tandok,
    wound: e.wound,
    category: e.category,
    booster: e.booster,
    preExp: e.preExp,
    vaccine: e.vaccine,
    brand: e.brand,
    regimen: e.regimen,
    history: e.history,
    bp: e.bp,
    weight: e.weight,
    temp: e.temp,
    consent: e.consent,
    consentBy: e.consentBy,
    tt: e.tt,
    rig: e.rig,
    erig: e.erig,
    pepEligible: e.pepEligible,
    stopAfter: e.stopAfter,
    animalStatus: e.animalStatus,
    progress: e.progress,
    doctor: e.doctor,
    remark: e.remark,
    transferredTo: e.transferredTo,
    died: e.died,
    rer: e.rer,
    billing: e.billing,
    past: e.past,
    seriesStartDate: e.seriesStartDate || undefined,
    continuedFromEncounterId: e.continuedFromEncounterId || undefined,
    originRegistry: e.originRegistry || undefined,
    referredFrom: e.referredFrom || undefined,
    referredTo: e.referredTo || undefined,
    receivingRegistry: e.receivingRegistry || undefined,
    receivingEncounterId: e.receivingEncounterId || undefined
  }
}

export function doseClient(d: Dose) {
  return {
    id: d.id,
    encounterId: d.encounterId,
    day: d.day,
    date: d.date,
    time: d.time,
    dose: d.dose,
    side: d.side,
    brand: d.brand,
    batch: d.batch,
    route: d.route,
    advised: d.advised,
    animalStatus: d.animalStatus,
    vaccinator: d.vaccinator,
    branch: d.branch
  }
}

export function noteClient(n: ProgressNote) {
  return {
    id: n.id,
    patientId: n.patientId,
    encounterId: n.encounterId,
    date: n.date,
    s: n.s,
    animal: n.animal,
    o: n.o,
    a: n.a,
    p: n.p,
    staff: n.staff,
    branch: n.branch
  }
}

export function paymentClient(p: Payment) {
  return {
    id: p.id,
    registry: p.registry,
    encounterId: p.encounterId,
    patient: p.patient,
    branch: p.branch,
    date: p.date,
    service: p.service,
    classification: p.classification,
    amount: p.amount,
    method: p.method,
    reference: p.reference,
    status: p.status,
    remarks: p.remarks,
    txn: p.txn || ''
  }
}

export function referralClient(r: Referral) {
  return {
    id: r.id,
    patient: r.patient,
    patientId: r.patientId,
    encounterId: r.encounterId,
    registry: r.registry,
    originRegistry: r.originRegistry,
    receivingRegistry: r.receivingRegistry,
    receivingEncounterId: r.receivingEncounterId,
    from: r.from,
    to: r.to,
    date: r.date,
    reason: r.reason,
    treatment: r.treatment,
    next: r.next,
    classification: r.classification,
    status: r.status,
    remarks: r.remarks
  }
}

export function inventoryClient(x: InventoryLine) {
  return {
    id: x.id,
    item: x.item,
    type: x.type,
    branch: x.branch,
    batch: x.batch,
    expiry: x.expiry,
    stock: x.stock,
    begin: x.begin,
    received: x.received,
    used: x.used,
    uses: x.uses,
    usesPerVial: x.usesPerVial,
    date: x.date,
    shift: x.shift,
    unit: x.unit,
    threshold: x.threshold
  }
}

export function ledgerClient(x: LedgerRow) {
  return {
    id: x.id,
    stockId: x.stockId,
    item: x.item,
    branch: x.branch,
    date: x.date,
    shift: x.shift,
    begin: x.begin,
    received: x.received,
    batch: x.batch,
    used: x.used,
    stock: x.stock,
    remarks: x.remarks,
    signature: x.signature
  }
}

export function receivedClient(x: ReceivedRow) {
  return {
    id: x.id,
    date: x.date,
    shift: x.shift,
    item: x.item,
    branch: x.branch,
    batch: x.batch,
    expiry: x.expiry,
    received: x.received,
    remaining: x.remaining,
    total: x.total
  }
}

export function movementClient(x: Movement) {
  return {
    id: x.id,
    date: x.date,
    time: x.time,
    by: x.by,
    shift: x.shift,
    item: x.item,
    branch: x.branch,
    type: x.type,
    qty: x.qty,
    uses: x.uses,
    batch: x.batch,
    ref: x.ref,
    reason: x.reason
  }
}

export function financeClient(x: FinanceEntry) {
  return {
    id: x.id,
    date: x.date,
    branch: x.branch,
    type: x.type,
    category: x.category,
    description: x.description,
    amount: x.amount,
    reference: x.reference,
    remarks: x.remarks,
    by: x.by
  }
}

export function refundClient(x: Refund) {
  return {
    id: x.id,
    patient: x.patient,
    payment: x.payment,
    branch: x.branch,
    amount: x.amount,
    reason: x.reason,
    requested: x.requested,
    approvedBy: x.approvedBy,
    processedBy: x.processedBy,
    refunded: x.refunded,
    status: x.status
  }
}

export function employeeClient(x: Employee & { users?: Pick<User, 'email'>[] }) {
  const logins = (x.users || []).map(u => u.email)
  return {
    id: x.id,
    name: x.name,
    branch: x.branch,
    position: x.position,
    role: x.role,
    rate: x.rate,
    hours: x.hours,
    shift: x.shift,
    status: x.status,
    officer: x.officer,
    payroll: x.payroll,
    benefits: x.benefits !== false,
    email: logins[0] || '',
    logins
  }
}

export function overtimeRequestClient(x: { id: string, employeeId: string, date: string, hours: number, reason: string, status: string, decisionReason: string, by: string, decidedAt: Date | null, createdAt: Date, updatedAt: Date }) {
  return {
    id: x.id,
    employeeId: x.employeeId,
    date: x.date,
    hours: x.hours,
    reason: x.reason,
    status: x.status,
    decisionReason: x.decisionReason,
    by: x.by,
    decidedAt: x.decidedAt ? x.decidedAt.toISOString() : '',
    createdAt: x.createdAt.toISOString(),
    updatedAt: x.updatedAt.toISOString()
  }
}

export function attendanceClient(x: Attendance & { user?: { employeeId: string | null, name: string } | null }) {
  return {
    id: x.id,
    userId: x.userId,
    employeeId: x.user?.employeeId || '',
    userName: x.user?.name || '',
    date: x.date,
    in: x.clockIn,
    out: x.clockOut,
    source: x.source,
    branch: x.branch,
    device: x.device,
    corrected: x.corrected
  }
}

function holidayDays(x: { holiday: number, holidaySpecial?: number, holidayType: string }) {
  const fromColumn = Number(x.holidaySpecial) || 0
  const type = String(x.holidayType || '')
  if (type === 'Special' && !fromColumn) return { holidayRegular: 0, holidaySpecial: Number(x.holiday) || 0 }
  const encoded = /^(?:\d+|\d+\.\d+)$/.test(type) ? Number(type) : 0
  return { holidayRegular: Number(x.holiday) || 0, holidaySpecial: fromColumn || encoded }
}

export function payrollInputClient(x: { id: string, employeeId: string, periodId: string, days: number, late: number, undertime: number, night: number, ot: number, otApproved: boolean, holiday: number, holidaySpecial?: number, holidayType: string, other: number, reason: string, by: string }) {
  const days = holidayDays(x)
  return {
    id: x.id,
    employeeId: x.employeeId,
    periodId: x.periodId,
    days: x.days,
    late: x.late,
    undertime: x.undertime,
    night: x.night,
    ot: x.ot,
    otApproved: x.otApproved,
    holiday: days.holidayRegular,
    holidayRegular: days.holidayRegular,
    holidaySpecial: days.holidaySpecial,
    holidayType: x.holidayType,
    other: x.other,
    reason: x.reason,
    by: x.by
  }
}

export function contributionOverrideClient(x: { id: string, employeeId: string, fromPeriod: string, sss: number | null, phil: number | null, pagibig: number | null, reason: string, by: string, createdAt: Date }) {
  return {
    id: x.id,
    employeeId: x.employeeId,
    fromPeriod: x.fromPeriod,
    sss: x.sss,
    phil: x.phil,
    pagibig: x.pagibig,
    reason: x.reason,
    by: x.by,
    createdAt: x.createdAt.toISOString()
  }
}

export function attendanceCorrectionClient(row: { id: string, userName: string, record: string, oldValue: string, newValue: string, time: string }) {
  const [date, field] = row.record.split(' · ')
  const splitAt = row.newValue.indexOf(' · ')
  return {
    id: row.id,
    date: date || '',
    field: field || '',
    original: row.oldValue,
    updated: splitAt === -1 ? row.newValue : row.newValue.slice(0, splitAt),
    reason: splitAt === -1 ? '' : row.newValue.slice(splitAt + 3),
    by: row.userName,
    timestamp: row.time
  }
}

export function branchClient(b: Branch) {
  return {
    name: b.name,
    code: b.code,
    address: b.address,
    contact: b.contact,
    hours: b.hours,
    accreditation: b.accreditation,
    night: b.night,
    main: b.main,
    morning: b.morning,
    status: b.status
  }
}

export function userClient(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    branch: u.branchName || 'All branches',
    branchName: u.branchName,
    employee: u.employeeId || '',
    employeeId: u.employeeId || '',
    status: u.status
  }
}
