import React from 'react'
import { Clock3, Printer, ShieldCheck } from 'lucide-react'
import { branchMaster as seedBranches, fmt, money, overrideFor, payPeriods, periodInputsFromAttendance, today } from '../data'
import { decideOvertimeApi, resetPayrollInputApi, saveContributionOverrideApi, savePayrollInputApi } from '../api'
import { Badge, BrandLogo, Button, Card, Field, Modal, SectionTitle, Select, Table, Tabs } from '../components'
import { calc } from './People'

const scope = (items, b) => b === 'All branches' ? items : items.filter(x => x.branch === b)
const initials = n => n.split(' ').map(x => x[0]).join('').slice(0, 2)
const nightOf = (list, b) => (list || seedBranches).find(x => x.name === b)?.night
const payrollAdmins = ['Superadmin', 'Admin']
const payslipListRoles = ['Superadmin', 'Admin']
const remit = c => (Number(c.sssEr) || 0) + (Number(c.sssEc) || 0) + (Number(c.philEr) || 0) + (Number(c.pagibigEr) || 0)
function EmployerBox({ c }) {
  const rows = []
  if (c.sss || c.sssEr || c.sssEc) { rows.push(['SSS', c.sssEr], ['EC', c.sssEc]) }
  if (c.phil || c.philEr) rows.push(['PhilHealth', c.philEr])
  if (c.pagibig || c.pagibigEr) rows.push(['Pag-IBIG', c.pagibigEr])
  return <div className="payslip-employer"><h3>Clinic remittance <small>Not deducted from net pay</small></h3>{rows.length ? rows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{money(value)}</strong></div>) : <div><span>This cutoff</span><strong>{money(0)}</strong></div>}<div className="employer-total"><span>Total to remit</span><strong>{money(remit(c))}</strong></div></div>
}

function payOf(e, period, attendance, users, payrollInputs, drafts, overtimeRequests) {
  const auto = periodInputsFromAttendance(e, period, attendance, users, overtimeRequests)
  const stored = (payrollInputs || []).find(p => p.employeeId === e.id && p.periodId === period)
  return { ...auto, ...(stored || {}), ...(drafts[period + e.id] || {}), ot: auto.ot, otApproved: auto.ot > 0, auto, stored: !!stored }
}

export function PayrollPage({
  branch, role, notify, employeeId, employees = [], branchMaster, attendance = [], users = [],
  payrollInputs = [], setPayrollInputs, contributionOverrides = [], setContributionOverrides, overtimeRequests = [], setOvertimeRequests
}) {
  const visible = scope(employees, branch).filter(e => e.payroll)
  const [period, setPeriod] = React.useState(payPeriods[0].id)
  const [tab, setTab] = React.useState('Payroll register')
  const [selected, setSelected] = React.useState(visible[0]?.id || '')
  const [inputs, setInputs] = React.useState({})
  const [decision, setDecision] = React.useState(null)
  const [ovForm, setOvForm] = React.useState({ sss: '', phil: '', pagibig: '', reason: '', from: payPeriods[0].id })
  const [payReason, setPayReason] = React.useState('')
  const P = payPeriods.find(p => p.id === period)
  const admin = payrollAdmins.includes(role)
  const inp = e => payOf(e, period, attendance, users, payrollInputs, inputs, overtimeRequests)
  const ov = (e, periodId = period) => overrideFor(contributionOverrides, e.id, periodId) || {}
  const pay = (e, periodId = period) => calc(e, periodId === period ? inp(e) : payOf(e, periodId, attendance, users, payrollInputs, inputs, overtimeRequests), ov(e, periodId), 1, branchMaster, { payday: payPeriods.find(p => p.id === periodId)?.half })
  const employee = visible.find(x => x.id === selected) || visible[0]
  if (!employee) {
    return (
      <>
        <SectionTitle eyebrow="PEOPLE OPERATIONS" title="Payroll" description="Auto from Time In / Time Out after you add staff." />
        <Card><p className="card-note">No employees yet. Add staff under Employees, then they can Time In.</p></Card>
      </>
    )
  }
  const current = inp(employee)
  const c = pay(employee)
  const upd = ev => setInputs({
    ...inputs,
    [period + employee.id]: { ...current, [ev.target.name]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value }
  })
  const register = visible.map(e => ({ ...e, c: pay(e), i: inp(e) }))
  const total = k => register.reduce((a, r) => a + r.c[k], 0)
  const lines = [
    ['Basic pay (' + c.days + ' duty days)', c.basic, 'plus'],
    ['Approved overtime', c.otPay, 'plus'],
    ['Night differential (10%)', c.nightPay, 'plus'],
    ['Regular holiday pay (' + c.holidayRegular + ' days)', c.regularHolidayPay, 'plus'],
    ['Special holiday pay (' + c.holidaySpecial + ' days)', c.specialHolidayPay, 'plus'],
    ['Officer allowance', c.allowance, 'plus'],
    ['Late deduction', c.lateDed, 'minus'],
    ['Undertime deduction', c.underDed, 'minus'],
    ['SSS', c.sss, 'minus'],
    ['PhilHealth', c.phil, 'minus'],
    ['Pag-IBIG', c.pagibig, 'minus'],
    ['Other approved deductions', c.other, 'minus']
  ]
  const savePay = async () => {
    if (!payReason) { notify('Reason is required to update payroll'); return }
    try {
      const saved = await savePayrollInputApi({
        employeeId: employee.id, periodId: period, days: Number(current.days) || 0, late: Number(current.late) || 0,
        undertime: Number(current.undertime) || 0, night: Number(current.night) || 0, ot: Number(current.ot) || 0,
        otApproved: Number(current.ot) > 0,
        holiday: Number(current.holidayRegular ?? current.holiday) || 0,
        holidayRegular: Number(current.holidayRegular ?? current.holiday) || 0,
        holidaySpecial: Number(current.holidaySpecial) || 0,
        other: Number(current.other) || 0, reason: payReason
      })
      if (setPayrollInputs) setPayrollInputs(list => [saved, ...list.filter(x => !(x.employeeId === saved.employeeId && x.periodId === saved.periodId))])
      setInputs(x => { const n = { ...x }; delete n[period + employee.id]; return n })
      setPayReason('')
      notify('Payroll updated. Payslip uses this until reset to Time In.', 'Payroll')
    } catch (err) { notify(err.message, 'error') }
  }
  const resetPay = async () => {
    try {
      await resetPayrollInputApi(employee.id, period)
      if (setPayrollInputs) setPayrollInputs(list => list.filter(x => !(x.employeeId === employee.id && x.periodId === period)))
      setInputs(x => { const n = { ...x }; delete n[period + employee.id]; return n })
      notify('Payroll reset to Time In / Time Out', 'Payroll')
    } catch (err) { notify(err.message, 'error') }
  }
  return (
    <>
      <SectionTitle eyebrow="PEOPLE OPERATIONS" title="Payroll" description="Auto from Time In / Time Out. Admin can update a cutoff with a reason." action={<><Select value={period} onChange={setPeriod} options={payPeriods.map(p => [p.id, p.label])} /><Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button></>} />
      <div className="notice-line"><ShieldCheck size={18} /><span>Duty days come from Time In / Time Out. Enrolled staff: 15th payslip deducts Pag-IBIG ₱200 and PhilHealth ₱337.50, 30th payslip deducts SSS ₱675. Employees whose membership is still being processed stay at ₱0. Employer share is remitted by the clinic, not deducted.</span></div>
      <div className="payroll-header">
        <div><span>PAY PERIOD</span><strong>{P.label}</strong><small>Cutoff: {fmt(P.cutoff)} · Release: {fmt(P.pay)}</small></div>
        <div><span>PAYROLL BASIS</span><strong>Auto from attendance</strong><small>No work, no pay · days with Time In</small></div>
        <div><span>HOLIDAYS IN PERIOD</span><strong>{P.holidays.length ? P.holidays.map(h => h[1] + (h[2] === 'Special' ? ' (Special)' : '')).join(', ') : 'None'}</strong><small>Regular +100% · Special +30%</small></div>
      </div>
      <Tabs items={['Payroll register', 'Computation', 'Contribution overrides', 'OT approvals', 'Payroll history']} value={tab} onChange={setTab} />
      {tab === 'Payroll register' && <Card title={'Payroll register · ' + P.label + (branch === 'All branches' ? ' · consolidated' : ' · ' + branch)}>
        <Table pageSize={10} columns={[
          { label: 'EMPLOYEE', render: r => <div><strong>{r.name}</strong><small className="block-sub">{r.id} · {r.branch}</small></div> },
          { label: 'SOURCE', render: r => <Badge tone={r.i.stored ? 'amber' : 'slate'}>{r.i.stored ? 'Updated' : 'Time In'}</Badge> },
          { label: 'DUTY DAYS', render: r => r.c.days },
          { label: 'BASIC', render: r => money(r.c.basic) },
          { label: 'LATE / UT', render: r => <span className="negative">−{money(r.c.lateDed + r.c.underDed)}</span> },
          { label: 'OT', render: r => money(r.c.otPay) },
          { label: 'NIGHT DIFF', render: r => money(r.c.nightPay) },
          { label: 'HOLIDAY', render: r => money(r.c.holidayPay) },
          { label: 'ALLOWANCE', render: r => money(r.c.allowance) },
          { label: 'SSS', render: r => money(r.c.sss) },
          { label: 'PHILHEALTH', render: r => money(r.c.phil) },
          { label: 'PAG-IBIG', render: r => money(r.c.pagibig) },
          { label: 'EMPLOYER', render: r => money(remit(r.c)) },
          { label: 'NET PAY', render: r => <strong>{money(r.c.net)}</strong> },
          { label: '', render: r => <button className="table-link" onClick={() => { setSelected(r.id); setTab('Computation') }}>{admin ? 'Update →' : 'View →'}</button> }
        ]} rows={register} />
        <div className="net-line"><span>Total net pay · {register.length} employees</span><strong>{money(total('net'))}</strong></div>
        <div className="remit-line"><span>Clinic remittance · not deducted</span><strong>{money(register.reduce((a, r) => a + remit(r.c), 0))}</strong></div>
        <p className="card-note">Employer share follows the employee contribution for this cutoff. PhilHealth and Pag-IBIG match. SSS employer is double, plus EC. SSS is on the 30th. PhilHealth and Pag-IBIG are on the 15th.</p>
      </Card>}
      {tab === 'Computation' && <div className="payroll-layout">
        <div className="payroll-form">
          <Card title="Employee and attendance inputs">
            <div className="form-grid">
              <Field label="Employee" value={selected} options={visible.map(x => [x.id, x.name + ' · ' + x.branch])} onChange={e => setSelected(e.target.value)} />
              <Field label="Branch / shift" value={employee.branch + ' · ' + employee.shift} disabled />
              <Field label="Daily rate" value={money(employee.rate)} disabled />
              <Field label="Approved hours per day" value={employee.hours} disabled />
              <Field label="Approved duty days" name="days" type="number" value={current.days} onChange={upd} disabled={!admin} />
              <Field label="Late minutes" name="late" type="number" value={current.late} onChange={upd} disabled={!admin} />
              <Field label="Undertime minutes" name="undertime" type="number" value={current.undertime} onChange={upd} disabled={!admin} />
              <Field label="Other approved deductions" name="other" type="number" value={current.other} onChange={upd} disabled={!admin} />
            </div>
            <p className="card-note">{current.stored ? 'Updated by ' + (current.by || 'Admin') + (current.reason ? ' · ' + current.reason : '') : 'Auto from Time In / Time Out for this cutoff (' + (current.auto?.days || 0) + ' days).'} Late / undertime = Daily rate ÷ hours ÷ 60 × minutes.</p>
          </Card>
          <Card title="Additional earnings">
            <div className="form-grid">
              <Field label="Approved OT hours" value={current.ot || 0} disabled help="From approved Attendance requests. Paid at daily rate ÷ 8 × 1.25." />
              <Field label="Night-duty hours" name="night" type="number" value={current.night} onChange={upd} disabled={!admin || !(employee.shift === 'Night Shift' && nightOf(branchMaster, employee.branch))} help="Auto from night Time In / Time Out" />
              <Field label="Regular holiday days" name="holidayRegular" type="number" value={current.holidayRegular ?? current.holiday} onChange={upd} disabled={!admin} help="Daily rate × 100%" />
              <Field label="Special holiday days" name="holidaySpecial" type="number" value={current.holidaySpecial ?? 0} onChange={upd} disabled={!admin} help="Daily rate × 30%" />
            </div>
            <p className="card-note">Overtime is filed on Attendance after Time Out. This cutoff pays the approved hours only.</p>
          </Card>
          {admin && <Card title="Save update">
            <Field label="Reason (required to update)" type="textarea" value={payReason} onChange={e => setPayReason(e.target.value)} placeholder="e.g. Time Out missed · verified against Bundy" />
            <div className="row-actions margin-top">
              <Button onClick={savePay}>Save payroll update</Button>
              {current.stored && <Button variant="secondary" onClick={resetPay}>Reset to Time In</Button>}
            </div>
          </Card>}
        </div>
        <div className="payroll-summary">
          <Card title="Computation preview">
            <div className="payslip-person"><span className="person-avatar">{initials(employee.name)}</span><div><strong>{employee.name}</strong><small>{employee.id} · {employee.branch}</small></div></div>
            <div className="pay-lines">{lines.map(([label, value, type]) => <div key={label}><span>{label}</span><strong className={type === 'minus' ? 'negative' : ''}>{type === 'minus' ? '−' : '+'} {money(value)}</strong></div>)}</div>
            <div className="net-line"><span>Net pay</span><strong>{money(c.net)}</strong></div>
            <EmployerBox c={c} />
            <p className="card-note">Night differential = 10% of hourly rate × night hours. Regular holiday = daily rate × days. Special holiday = daily rate × 30% × days. This cutoff shows only that payday.</p>
          </Card>
        </div>
      </div>}
      {tab === 'Contribution overrides' && <div className="split-overview">
        <Card title="Per-employee override">
          <div className="form-grid">
            <Field label="Employee" value={selected} options={visible.map(x => [x.id, x.name])} onChange={e => setSelected(e.target.value)} />
            <Field label="Effective from cutoff" value={ovForm.from} options={payPeriods.map(p => [p.id, p.label])} onChange={e => setOvForm({ ...ovForm, from: e.target.value })} />
            <Field label={'SSS (computed ' + money(c.sss) + ')'} type="number" value={ovForm.sss} onChange={e => setOvForm({ ...ovForm, sss: e.target.value })} />
            <Field label={'PhilHealth (computed ' + money(c.phil) + ')'} type="number" value={ovForm.phil} onChange={e => setOvForm({ ...ovForm, phil: e.target.value })} />
            <Field label={'Pag-IBIG (computed ' + money(c.pagibig) + ')'} type="number" value={ovForm.pagibig} onChange={e => setOvForm({ ...ovForm, pagibig: e.target.value })} />
          </div>
          <Field label="Reason (required)" type="textarea" value={ovForm.reason} onChange={e => setOvForm({ ...ovForm, reason: e.target.value })} />
          <p className="card-note">Blank keeps the standard amount. SSS applies on the 30th only. PhilHealth and Pag-IBIG apply on the 15th only. Employer share follows: PhilHealth and Pag-IBIG match the employee amount, SSS employer is double, and EC is ₱10 up to an employee share of ₱725 and ₱30 from ₱750.</p>
          <Button onClick={async () => { if (!ovForm.reason.trim()) { notify('Enter a reason for the contribution override'); return } try { const saved = await saveContributionOverrideApi({ employeeId: employee.id, fromPeriod: ovForm.from, sss: ovForm.sss, phil: ovForm.phil, pagibig: ovForm.pagibig, reason: ovForm.reason.trim() }); if (setContributionOverrides) setContributionOverrides(list => [saved, ...list.filter(x => x.id !== saved.id)]); setOvForm({ ...ovForm, reason: '' }); notify('Contribution override saved. Employer share follows this amount.', 'Payroll') } catch (err) { notify(err.message, 'error') } }}>Save override</Button>
        </Card>
        <Card title="Override audit"><Table columns={[{ label: 'EMPLOYEE', key: 'employee' }, { label: 'SSS / PHIC / HDMF', key: 'values' }, { label: 'REASON', key: 'reason' }, { label: 'EFFECTIVE', key: 'effective' }, { label: 'CHANGED BY', key: 'by' }]} rows={[...contributionOverrides].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(r => { const show = v => v === null || v === undefined || v === '' ? 'auto' : money(v); return { id: r.id, employee: (employees.find(e => e.id === r.employeeId) || {}).name || r.employeeId, values: [show(r.sss), show(r.phil), show(r.pagibig)].join(' / '), reason: r.reason, effective: (payPeriods.find(p => p.id === r.fromPeriod) || {}).label || r.fromPeriod, by: r.by } })} empty="No contribution overrides recorded." /></Card>
      </div>}
      {tab === 'OT approvals' && <Card title="Overtime approval">
        <div className="notice-line"><Clock3 size={18} /><span>Staff file overtime on Attendance after Time Out. Pay is daily rate ÷ 8 × 1.25, and only after approval. An approver cannot decide their own request.</span></div>
        <Table columns={[
          { label: 'DATE', render: r => fmt(r.date) },
          { label: 'EMPLOYEE', render: r => r.name },
          { label: 'BRANCH', key: 'branch' },
          { label: 'HOURS', key: 'hours' },
          { label: 'REASON', key: 'reason' },
          { label: 'STATUS', render: r => <Badge>{r.status}</Badge> },
          { label: 'DECISION', render: r => r.decisionReason || '—' },
          { label: '', render: r => admin && r.employeeId !== employeeId ? <span className="row-actions"><button className="table-link" onClick={() => setDecision({ id: r.id, status: 'Approved', name: r.name, reason: '' })}>Approve</button><button className="table-link" onClick={() => setDecision({ id: r.id, status: 'Rejected', name: r.name, reason: '' })}>Reject</button></span> : <span className="block-sub">{r.employeeId === employeeId ? 'Own request' : ''}</span> }
        ]} rows={(overtimeRequests || []).filter(r => r.date >= P.from && r.date <= P.to).map(r => { const emp = employees.find(e => e.id === r.employeeId) || {}; return { ...r, name: emp.name || r.employeeId, branch: emp.branch || '—' } }).filter(r => branch === 'All branches' || r.branch === branch)} empty="No overtime filed for this cutoff." />
      </Card>}
      {tab === 'Payroll history' && <Card title="Payroll history">
        <Table columns={[
          { label: 'PAY PERIOD', key: 'label' }, { label: 'CUTOFF', render: r => fmt(r.cutoff) }, { label: 'RELEASE', render: r => fmt(r.pay) },
          { label: 'EMPLOYEES', key: 'count' }, { label: 'GROSS', render: r => money(r.gross) }, { label: 'NET PAY', render: r => <strong>{money(r.net)}</strong> },
          { label: 'STATUS', render: r => <Badge>{r.pay < today ? 'Released' : 'Open'}</Badge> }
        ]} rows={payPeriods.map(p => { const rs = visible.map(e => pay(e, p.id)); return { id: p.id, ...p, count: rs.length, gross: rs.reduce((a, r) => a + r.gross, 0), net: rs.reduce((a, r) => a + r.net, 0) } })} />
        <p className="card-note">History uses Time In unless Admin saved an update for that cutoff. Approved overtime comes from Attendance requests.</p>
      </Card>}
      {decision && <Modal title={(decision.status === 'Approved' ? 'Approve' : 'Reject') + ' overtime · ' + decision.name} onClose={() => setDecision(null)} footer={<><Button variant="secondary" onClick={() => setDecision(null)}>Cancel</Button><Button onClick={async () => { if (!decision.reason.trim()) { notify('A reason is required'); return } try { const saved = await decideOvertimeApi(decision.id, { status: decision.status, reason: decision.reason.trim() }); if (setOvertimeRequests) setOvertimeRequests(list => [saved, ...list.filter(x => x.id !== saved.id)]); setDecision(null); notify('Overtime ' + saved.status.toLowerCase() + ' for ' + decision.name, 'Payroll') } catch (err) { notify(err.message, 'error') } }}>{decision.status === 'Approved' ? 'Approve' : 'Reject'}</Button></>}><Field label="Reason (required)" type="textarea" value={decision.reason} onChange={e => setDecision({ ...decision, reason: e.target.value })} placeholder="Verified against the Bundy clock" /></Modal>}
    </>
  )
}

export function PayslipsPage({
  branch, role, employees = [], employeeId, branchMaster, attendance = [], users = [], payrollInputs = [], contributionOverrides = [], overtimeRequests = []
}) {
  const listAll = payslipListRoles.includes(role)
  const me = employeeId || employees[0]?.id || ''
  const visible = listAll ? scope(employees, branch) : employees.filter(e => e.id === me)
  const [id, setId] = React.useState(visible[0]?.id || me)
  const [period, setPeriod] = React.useState(payPeriods[0].id)
  const employee = employees.find(x => x.id === id) || visible[0] || employees[0]
  const P = payPeriods.find(p => p.id === period)
  if (!employee) {
    return (
      <>
        <SectionTitle eyebrow="PEOPLE OPERATIONS" title="Payslips" description="Payslips appear after you add employees and they Time In." />
        <Card><p className="card-note">No employees yet. Add staff under Employees first.</p></Card>
      </>
    )
  }
  const current = payOf(employee, period, attendance, users, payrollInputs, {}, overtimeRequests)
  const c = calc(employee, current, overrideFor(contributionOverrides, employee.id, period) || {}, 1, branchMaster, { payday: P?.half })
  return (
    <>
      <SectionTitle eyebrow="PEOPLE OPERATIONS" title="Payslips" description={listAll ? 'Printable payslips. Figures come from Time In unless payroll was updated.' : 'Your payslips from Time In / Time Out.'} action={<Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print / download payslip</Button>} />
      <div className="payslip-select">
        {listAll && <Field label="Select employee" value={id} options={visible.map(e => [e.id, e.name + ' · ' + e.branch])} onChange={e => setId(e.target.value)} />}
        <Field label="Payroll period" value={period} options={payPeriods.map(p => [p.id, p.label])} onChange={e => setPeriod(e.target.value)} />
        <span>Cutoff: {fmt(P.cutoff)} · Pay date: {fmt(P.pay)} · {current.stored ? 'Updated' : 'Auto from Time In'}</span>
      </div>
      <div className="payslip-sheet">
        <div className="payslip-brand"><div className="brand-mark"><BrandLogo /></div><div><strong>ARC</strong><span>EMPLOYEE PAYSLIP</span></div><small>{fmt(P.pay)}</small></div>
        <div className="payslip-info">
          <div><small>EMPLOYEE</small><strong>{employee.name}</strong><span>{employee.id} · {employee.position}</span></div>
          <div><small>BRANCH</small><strong>{employee.branch}</strong><span>{employee.shift}</span></div>
          <div><small>PAY PERIOD</small><strong>{P.label}</strong><span>{c.days} duty days</span></div>
          <div><small>DAILY RATE</small><strong>{money(employee.rate)}</strong><span>No work, no pay</span></div>
        </div>
        <div className="payslip-columns">
          <div><h3>Earnings</h3><div><span>Basic pay</span><strong>{money(c.basic)}</strong></div><div><span>Approved overtime</span><strong>{money(c.otPay)}</strong></div><div><span>Night differential</span><strong>{money(c.nightPay)}</strong></div><div><span>Regular holiday pay</span><strong>{money(c.regularHolidayPay)}</strong></div><div><span>Special holiday pay</span><strong>{money(c.specialHolidayPay)}</strong></div><div><span>Officer allowance</span><strong>{money(c.allowance)}</strong></div></div>
          <div><h3>Deductions</h3><div><span>Late</span><strong>{money(c.lateDed)}</strong></div><div><span>Undertime</span><strong>{money(c.underDed)}</strong></div><div><span>SSS</span><strong>{money(c.sss)}</strong></div><div><span>PhilHealth</span><strong>{money(c.phil)}</strong></div><div><span>Pag-IBIG</span><strong>{money(c.pagibig)}</strong></div><div><span>Other approved deductions</span><strong>{money(c.other)}</strong></div></div>
        </div>
        <div className="payslip-net"><span>NET PAY</span><strong>{money(c.net)}</strong></div>
        {listAll && <EmployerBox c={c} />}
        <p>{current.stored ? 'Updated by Admin · ' + (current.reason || '') : 'Auto from Time In / Time Out'}. Approved overtime is daily rate ÷ 8 × 1.25 after approval.</p>
      </div>
    </>
  )
}
