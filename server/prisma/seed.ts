// @ts-nocheck
import 'dotenv/config'
import argon2 from 'argon2'
import { PrismaClient } from '@prisma/client'
import {
  attendanceForEmployee, branchCodes, branchMaster, doses, employees, encounters, financeEntries,
  inventory, ledger, patients, payments, progressNotes, receivedReport, referrals, refunds
} from '../../src/data.js'

const prisma = new PrismaClient()
const DEMO_PASSWORD = 'Demo@2026'
const clinicOnly = process.argv.includes('--clinic')

type Enc = (typeof encounters)[number]

async function main() {
  await prisma.payrollInput.deleteMany()
  await prisma.attendance.deleteMany()
  await prisma.movement.deleteMany()
  await prisma.ledgerRow.deleteMany()
  await prisma.receivedRow.deleteMany()
  await prisma.inventoryLine.deleteMany()
  await prisma.financeEntry.deleteMany()
  await prisma.refund.deleteMany()
  await prisma.dose.deleteMany()
  await prisma.progressNote.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.referral.deleteMany()
  await prisma.encounter.deleteMany()
  await prisma.patient.deleteMany()
  await prisma.session.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.registryCounter.deleteMany()
  await prisma.user.deleteMany()
  await prisma.employee.deleteMany()
  await prisma.branch.deleteMany()

  await prisma.branch.createMany({
    data: branchMaster.map(b => ({
      name: b.name,
      code: branchCodes[b.name as keyof typeof branchCodes],
      address: b.address,
      contact: b.contact,
      hours: b.hours,
      accreditation: b.accreditation,
      night: b.night,
      main: !!b.main,
      morning: b.morning !== false,
      status: b.status || 'Active'
    }))
  })

  if (clinicOnly) {
    const passwordHash = await argon2.hash(DEMO_PASSWORD)
    await prisma.user.create({
      data: { name: 'Admin', email: 'admin@arc.local', passwordHash, role: 'Admin', branchName: null, employeeId: null }
    })
    console.log('Seeded empty ARC clinic for live encoding')
    console.log('  Login: admin@arc.local / Demo@2026')
    console.log('  Add real staff under Employees. Stock in inventory before Day 0.')
    return
  }

  await prisma.employee.createMany({
    data: employees.map(e => ({
      id: e.id,
      name: e.name,
      branch: e.branch,
      position: e.position,
      role: e.role,
      rate: Number(e.rate),
      hours: Number(e.hours || 8),
      shift: e.shift,
      status: e.status || 'Active',
      officer: !!e.officer,
      payroll: e.payroll !== false
    }))
  })

  const empByName = Object.fromEntries(employees.map(e => [e.name, e.id]))
  const passwordHash = await argon2.hash(DEMO_PASSWORD)
  const allBranchRoles = ['Admin']
  const demoUsers = [
    { name: 'Alex Rivera', email: 'admin@arc.local', passwordHash, role: 'Admin', branchName: null, employeeId: null },
    { name: 'Jamie Torres', email: 'nurse@arc.local', passwordHash, role: 'Nurse / Staff', branchName: 'Guimba', employeeId: empByName['Jamie Torres'] },
    { name: 'Lyka Tenorio', email: 'po@arc.local', passwordHash, role: 'PO / PhilHealth Officer', branchName: 'Guimba', employeeId: empByName['Lyka Tenorio'] },
    { name: 'Taylor Aquino', email: 'secretary@arc.local', passwordHash, role: 'Secretary', branchName: 'Palayan', employeeId: empByName['Taylor Aquino'] }
  ]
  const linked = new Set(demoUsers.map(u => u.employeeId).filter(Boolean))
  const restUsers = employees.filter(e => !linked.has(e.id)).map(e => ({
    name: e.name,
    email: e.name.split(' ')[0].toLowerCase() + '@arc.local',
    passwordHash,
    role: e.role,
    branchName: allBranchRoles.includes(e.role) ? null : e.branch,
    employeeId: e.id
  }))
  await prisma.user.createMany({ data: [...demoUsers, ...restUsers] })

  await prisma.patient.createMany({
    data: patients.map(p => ({
      id: p.id,
      first: p.first,
      middle: p.middle || '',
      last: p.last,
      suffix: p.suffix || '',
      name: p.name,
      birthday: p.birthday,
      age: p.age ?? null,
      sex: p.sex,
      contact: p.contact || '',
      address: p.address || '',
      municipality: p.municipality || '',
      municipalityOther: p.municipalityOther || '',
      guardian: p.guardian || '',
      senior: !!p.senior,
      pwd: !!p.pwd,
      vetmed: !!p.vetmed,
      philhealth: !!p.philhealth,
      branch: p.branch,
      classification: p.classification || (p.philhealth ? 'PhilHealth' : 'Walk-in')
    }))
  })

  for (const e of encounters as Enc[]) {
    await prisma.encounter.create({
      data: {
        id: e.id,
        registry: e.registry,
        patientId: e.patientId,
        branch: e.branch,
        date: e.date,
        time: e.time || '',
        chief: e.chief || '',
        animal: e.animal || 'Dog',
        animalOther: e.animalOther || '',
        biteType: e.biteType || 'Bite',
        pet: !!e.pet,
        vaccinated: !!e.vaccinated,
        stray: !!e.stray,
        owned: e.owned !== false,
        owner: e.owner || '',
        biteDate: e.biteDate || e.date,
        biteTime: e.biteTime || '',
        side: e.side || 'L',
        site: e.site || '',
        place: e.place || '',
        washed: e.washed !== false,
        tandok: !!e.tandok,
        wound: e.wound || [],
        category: e.category || '',
        booster: !!e.booster,
        preExp: !!e.preExp,
        vaccine: e.vaccine || 'PVRV',
        brand: e.brand || 'Bioshoot',
        regimen: e.regimen || 'ID',
        history: e.history || {},
        bp: e.bp || '',
        weight: e.weight || '',
        temp: e.temp || '',
        consent: !!e.consent,
        consentBy: e.consentBy || '',
        tt: e.tt || {},
        rig: e.rig || '',
        erig: e.erig || {},
        pepEligible: e.pepEligible !== false,
        stopAfter: e.stopAfter ?? null,
        animalStatus: e.animalStatus || 'Alive',
        progress: e.progress || {},
        doctor: e.doctor || '',
        remark: e.remark || '',
        transferredTo: e.transferredTo || '',
        died: !!e.died,
        rer: e.rer !== false,
        billing: e.billing || '',
        past: !!e.past,
        seriesStartDate: e.seriesStartDate || null,
        continuedFromEncounterId: e.continuedFromEncounterId || null,
        originRegistry: e.originRegistry || '',
        referredFrom: e.referredFrom || '',
        referredTo: e.referredTo || '',
        receivingRegistry: e.receivingRegistry || '',
        receivingEncounterId: e.receivingEncounterId || ''
      }
    })
  }

  if (doses.length) {
    await prisma.dose.createMany({
      data: doses.map(d => ({
        id: d.id,
        encounterId: d.encounterId,
        day: d.day,
        date: d.date,
        time: d.time || '',
        dose: d.dose || '',
        side: d.side || '',
        brand: d.brand || '',
        batch: d.batch || '',
        route: d.route || 'ID',
        advised: d.advised || '',
        animalStatus: d.animalStatus || 'Alive',
        vaccinator: d.vaccinator,
        branch: d.branch
      }))
    })
  }

  if (payments.length) {
    await prisma.payment.createMany({
      data: payments.map(p => ({
        id: p.id,
        registry: p.registry,
        encounterId: p.encounterId,
        patient: p.patient,
        branch: p.branch,
        date: p.date,
        service: p.service,
        classification: p.classification,
        amount: Number(p.amount || 0),
        method: p.method || '—',
        reference: p.reference || '—',
        status: p.status,
        remarks: p.remarks || ''
      }))
    })
  }

  if (progressNotes.length) {
    await prisma.progressNote.createMany({
      data: progressNotes.filter(n => n.encounterId && n.patientId).map(n => ({
        id: n.id,
        patientId: n.patientId,
        encounterId: n.encounterId as string,
        date: n.date,
        s: n.s,
        animal: n.animal,
        o: n.o,
        a: n.a,
        p: n.p,
        staff: n.staff,
        branch: n.branch
      }))
    })
  }

  if (referrals.length) {
    await prisma.referral.createMany({
      data: referrals.map(r => ({
        id: r.id,
        patient: r.patient,
        patientId: r.patientId,
        encounterId: r.encounterId,
        registry: r.registry,
        originRegistry: r.originRegistry || r.registry,
        receivingRegistry: r.receivingRegistry || '',
        receivingEncounterId: r.receivingEncounterId || '',
        from: r.from,
        to: r.to,
        date: r.date,
        reason: r.reason || '',
        treatment: r.treatment || '',
        next: r.next || '',
        classification: r.classification || 'PhilHealth',
        status: r.status,
        remarks: r.remarks || ''
      }))
    })
  }

  const counters = new Map<string, number>()
  for (const e of encounters) {
    const year = e.date.slice(2, 4)
    const key = e.branch + '|' + year
    const n = Number(String(e.registry).split('-').pop() || 0)
    counters.set(key, Math.max(counters.get(key) || 0, n))
  }
  await prisma.registryCounter.createMany({
    data: [...counters.entries()].map(([key, lastSeq]) => {
      const [branchName, year] = key.split('|')
      return { branchName, year, lastSeq }
    })
  })

  if (inventory.length) {
    await prisma.inventoryLine.createMany({
      data: inventory.map(x => ({
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
        uses: x.uses || 0,
        usesPerVial: x.usesPerVial || 0,
        date: x.date,
        shift: x.shift,
        unit: x.unit,
        threshold: x.threshold
      }))
    })
  }

  if (ledger.length) {
    await prisma.ledgerRow.createMany({
      data: ledger.map(l => ({
        id: l.id,
        stockId: l.stockId,
        item: l.item,
        branch: l.branch,
        date: l.date,
        shift: l.shift,
        begin: l.begin,
        received: l.received,
        batch: l.batch || '',
        used: l.used,
        stock: l.stock,
        remarks: l.remarks || '',
        signature: l.signature || ''
      }))
    })
  }

  if (receivedReport.length) {
    await prisma.receivedRow.createMany({
      data: receivedReport.map(r => ({
        id: r.id,
        date: r.date,
        shift: r.shift || 'MS',
        item: r.item,
        branch: r.branch,
        batch: r.batch,
        expiry: r.expiry,
        received: r.received,
        remaining: r.remaining,
        total: r.total
      }))
    })
  }

  if (financeEntries.length) {
    await prisma.financeEntry.createMany({
      data: financeEntries.map(f => ({
        id: f.id,
        date: f.date,
        branch: f.branch,
        type: f.type,
        category: f.category,
        description: f.description,
        amount: Number(f.amount),
        reference: f.reference || '',
        remarks: f.remarks || '',
        by: f.by || 'Lyka Tenorio'
      }))
    })
  }

  const paymentIds = new Set(payments.map(p => p.id))
  const refundRows = refunds.filter(r => paymentIds.has(r.payment))
  if (refundRows.length) {
    await prisma.refund.createMany({
      data: refundRows.map(r => ({
        id: r.id,
        patient: r.patient,
        payment: r.payment,
        branch: r.branch,
        amount: Number(r.amount),
        reason: r.reason || '',
        requested: r.requested,
        approvedBy: r.approvedBy || '—',
        processedBy: r.processedBy || '—',
        refunded: r.refunded || '—',
        status: r.status
      }))
    })
  }

  const users = await prisma.user.findMany()
  const empById = Object.fromEntries(employees.map(e => [e.id, e]))
  const seededEmp = new Set()
  let att = 1
  for (const user of users) {
    if (!user.employeeId || user.role === 'Admin' || seededEmp.has(user.employeeId)) continue
    seededEmp.add(user.employeeId)
    const emp = empById[user.employeeId] || { shift: 'Morning Shift', role: user.role, branch: user.branchName || 'Guimba' }
    await prisma.attendance.createMany({
      data: attendanceForEmployee(emp).map(a => ({
        id: 'ATT-' + String(att++).padStart(4, '0'),
        userId: user.id,
        date: a.date,
        clockIn: a.in,
        clockOut: a.out || '',
        source: a.source || 'Time In button',
        branch: user.branchName || emp.branch || 'Guimba',
        device: a.device || 'Branch workstation'
      }))
    })
  }

  console.log('Seeded ARC clinic · demo password Demo@2026')
  console.log('  admin@arc.local (Admin) · nurse@arc.local (Nurse / Guimba) · po@arc.local')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
}).finally(() => prisma.$disconnect())
