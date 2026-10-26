import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { dispatch } from '../lib/dispatch.js'
import { prisma } from '../lib/prisma.js'
import { clinicDate } from '../lib/clinical.js'

const dbUrl = process.env.DATABASE_URL
if (!dbUrl || new URL(dbUrl).pathname !== '/arc_clinic_test') {
  throw new Error('Clinical smoke test requires the isolated arc_clinic_test database')
}

async function call(method: string, path: string, body?: object, cookie?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  const request = new NextRequest('http://localhost:3000' + path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const response = await dispatch(request)
  const data = await response.json() as any
  return { response, data }
}

try {
  const unauth = await call('GET', '/api/clinical')
  assert.equal(unauth.response.status, 401)

  const login = await call('POST', '/api/auth/login', {
    email: 'superadmin@arc.clinic', password: 'Demo@2026'
  })
  assert.equal(login.response.status, 200, JSON.stringify(login.data))
  const token = login.response.cookies.get('arc_session')?.value
  assert.ok(token)
  const cookie = 'arc_session=' + token

  const patient = {
    first: 'Api', last: 'Smoke' + Date.now(), middle: '', birthday: '1990-01-01',
    sex: 'Female', contact: '09000000000', address: 'Test address',
    municipality: 'Guimba', branch: 'Guimba', philhealth: false
  }
  const admission = await call('POST', '/api/admissions', {
    mode: 'New patient', patient,
    visit: { branch: 'Guimba', date: clinicDate(), billing: 'Walk-in' }
  }, cookie)
  assert.equal(admission.response.status, 200, JSON.stringify(admission.data))
  const encounterId = admission.data.encounter?.id
  assert.ok(encounterId)
  assert.match(admission.data.registry, /^ARCGUI\-\d{2}\-\d{4}$/)

  const rer = await call('PATCH', '/api/encounters/' + encounterId, {
    rer: true, animal: 'Dog', biteType: 'Bite', category: 'II',
    pepEligible: true, vaccine: 'PVRV', brand: 'Bioshoot', regimen: 'ID',
    biteDate: clinicDate(), site: 'Lower extremity', side: 'L',
    day0: { given: true, vaccinator: 'Jamie Torres' }
  }, cookie)
  assert.equal(rer.response.status, 200, JSON.stringify(rer.data))
  assert.equal(rer.data.doseSkip, 'pay')
  assert.equal(await prisma.dose.count({ where: { encounterId } }), 0)

  const payment = await call('POST', '/api/payments', {
    encounterId, intent: 'collect', classification: 'Walk-in',
    branch: 'Guimba', method: 'Cash'
  }, cookie)
  assert.equal(payment.response.status, 200, JSON.stringify(payment.data))
  assert.equal(payment.data.payments?.[0]?.status, 'Paid')
  assert.equal(payment.data.dose?.day, 'D0')
  assert.equal(await prisma.dose.count({ where: { encounterId, day: 'D0' } }), 1)
  assert.ok(await prisma.movement.findFirst({
    where: { ref: admission.data.registry, type: 'Stock Out · treatment' }
  }))

  const referralPatient = { ...patient, last: 'ReferralSmoke' + Date.now(), branch: 'Baloc' }
  const origin = await call('POST', '/api/admissions', {
    mode: 'New patient', patient: referralPatient,
    visit: { branch: 'Baloc', date: clinicDate(), billing: 'Walk-in' }
  }, cookie)
  assert.equal(origin.response.status, 200, JSON.stringify(origin.data))
  const originId = origin.data.encounter.id
  const originRer = await call('PATCH', '/api/encounters/' + originId, {
    rer: true, animal: 'Dog', biteType: 'Bite', category: 'II',
    pepEligible: true, vaccine: 'PVRV', brand: 'Bioshoot', regimen: 'ID',
    biteDate: clinicDate(), site: 'Lower extremity', side: 'L',
    day0: { given: true, vaccinator: 'Riley Cruz' }
  }, cookie)
  assert.equal(originRer.response.status, 200, JSON.stringify(originRer.data))
  const originPay = await call('POST', '/api/payments', {
    encounterId: originId, intent: 'collect', classification: 'Walk-in',
    branch: 'Baloc', method: 'Cash'
  }, cookie)
  assert.equal(originPay.response.status, 200, JSON.stringify(originPay.data))
  assert.equal(originPay.data.dose?.day, 'D0')
  const referral = await call('POST', '/api/referrals', {
    encounterId: originId, to: 'Guimba', classification: 'PhilHealth',
    reason: 'Continue PEP at accredited branch'
  }, cookie)
  assert.equal(referral.response.status, 200, JSON.stringify(referral.data))
  const acceptance = await call('POST', '/api/referrals/' + referral.data.id + '/accept', {}, cookie)
  assert.equal(acceptance.response.status, 200, JSON.stringify(acceptance.data))
  assert.match(acceptance.data.receivingRegistry, /^ARCGUI\-\d{2}\-\d{4}$/)
  assert.equal(acceptance.data.refund?.status, 'Pending')
  assert.equal(acceptance.data.refund?.branch, 'Baloc')
  assert.equal((await prisma.encounter.findUnique({ where: { id: originId } }))?.remark, 'Transferred')

  const payroll = await call('POST', '/api/payroll/inputs', {
    employeeId: 'EMP-101', periodId: '2026-10-A',
    days: 5, late: 30, undertime: 15, night: 2,
    ot: 1, otApproved: true, holidayRegular: 0, holidaySpecial: 1,
    reason: 'Isolated workflow smoke test'
  }, cookie)
  assert.equal(payroll.response.status, 200, JSON.stringify(payroll.data))
  assert.equal((await prisma.payrollInput.findUnique({
    where: { employeeId_periodId: { employeeId: 'EMP-101', periodId: '2026-10-A' } }
  }))?.holidaySpecial, 1)
  const override = await call('POST', '/api/payroll/overrides', {
    employeeId: 'EMP-101', fromPeriod: '2026-10-A',
    sss: 100, phil: 50, pagibig: 100,
    reason: 'Isolated workflow smoke test'
  }, cookie)
  assert.equal(override.response.status, 200, JSON.stringify(override.data))
  const ops = await call('GET', '/api/ops', undefined, cookie)
  assert.equal(ops.response.status, 200, JSON.stringify(ops.data))
  assert.ok(ops.data.payrollInputs?.some((p: any) => p.employeeId === 'EMP-101' && p.periodId === '2026-10-A'))

  const nurseLogin = await call('POST', '/api/auth/login', {
    email: 'nurse@arc.local', password: 'Demo@2026'
  })
  assert.equal(nurseLogin.response.status, 200, JSON.stringify(nurseLogin.data))
  const nurseCookie = 'arc_session=' + nurseLogin.response.cookies.get('arc_session')?.value
  const denied = await call('POST', '/api/admissions', {
    mode: 'New patient', patient: { ...patient, last: 'OtherBranch' + Date.now(), branch: 'Palayan' },
    visit: { branch: 'Palayan', date: clinicDate(), billing: 'Walk-in' }
  }, nurseCookie)
  assert.equal(denied.response.status, 403)

  const hydrated = await call('GET', '/api/clinical', undefined, cookie)
  assert.equal(hydrated.response.status, 200, JSON.stringify(hydrated.data))
  assert.ok(hydrated.data.encounters?.some((e: any) => e.id === encounterId))

  console.log('PASS unauthenticated guard, login, admission, RER payment gate, payment, Day 0 stock movement, referral, refund, payroll input and override, branch guard, hydration')
} finally {
  await prisma.$disconnect()
}
