import React from 'react'
import { Clock3, Printer, ShieldCheck } from 'lucide-react'
import { branchMaster as seedBranches, fmt, money, payPeriods, periodInputsFromAttendance, today } from '../data'
import { resetPayrollInputApi, savePayrollInputApi } from '../api'
import { Badge, BrandLogo, Button, Card, Field, SectionTitle, Select, Table, Tabs } from '../components'
import { calc } from './People'

const scope = (items, b) => b === 'All branches' ? items : items.filter(x => x.branch === b)
const initials = n => n.split(' ').map(x => x[0]).join('').slice(0, 2)
const nightOf = (list, b) => (list || seedBranches).find(x => x.name === b)?.night
const payrollAdmins = ['Admin']

function payOf(e, period, attendance, users, payrollInputs, drafts) {
  const auto = periodInputsFromAttendance(e, period, attendance, users)
  const stored = (payrollInputs || []).find(p => p.employeeId === e.id && p.periodId === period)
  return { ...auto, ...(stored || {}), ...(drafts[period + e.id] || {}), auto, stored: !!stored }
}

export function PayrollPage({
  branch, role, notify, employees = [], branchMaster, attendance = [], users = [],
  payrollInputs = [], setPayrollInputs
}) {
  const visible = scope(employees, branch).filter(e => e.payroll)
  const [period, setPeriod] = React.useState(payPeriods[0].id)
  const [tab, setTab] = React.useState('Payroll register')
  const [selected, setSelected] = React.useState(visible[0]?.id || '')
  const [inputs, setInputs] = React.useState({})
  const [overrides, setOverrides] = React.useState({})
  const [otRate, setOtRate] = React.useState(1)
  const [overrideLog, setOverrideLog] = React.useState([])
  const [ovForm, setOvForm] = React.useState({ sss: '', phil: '', pagibig: '', reason: '', from: payPeriods[0].id })
  const [payReason, setPayReason] = React.useState('')
  const P = payPeriods.find(p => p.id === period)
  const admin = payrollAdmins.includes(role)
  const inp = e => payOf(e, period, attendance, users, payrollInputs, inputs)
  const ov = e => overrides[e.id] || {}
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
  const c = calc(employee, current, ov(employee), otRate, branchMaster)
  const upd = ev => setInputs({
    ...inputs,
    [period + employee.id]: { ...current, [ev.target.name]: ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value }
  })
  const register = visible.map(e => ({ ...e, c: calc(e, inp(e), ov(e), otRate, branchMaster), i: inp(e) }))
  const total = k => register.reduce((a, r) => a + r.c[k], 0)
  const lines = [
    ['Basic pay (' + c.days + ' duty days)', c.basic, 'plus'],
    ['Approved overtime', c.otPay, 'plus'],
    ['Night differential (10%)', c.nightPay, 'plus'],
    ['Holiday pay', c.holidayPay, 'plus'],
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
        otApproved: !!current.otApproved, holiday: Number(current.holiday) || 0, holidayType: current.holidayType || 'Regular',
        other: Number(current.other) || 0, reason: payReason
      })
      if (setPayrollInputs) setPayrollInputs(list => [saved, ...list.filter(x => !(x.employeeId === saved.employeeId && x.periodId === saved.periodId))])
      setInputs(x => { const n = { ...x }; delete n[period + employee.id]; return n })
      setPayReason('')
      notify('Payroll updated. Payslip uses this until reset to Time In.', 'Payroll')
    } catch (err) { notify(err.message) }
  }
  const resetPay = async () => {
    try {
      await resetPayrollInputApi(employee.id, period)
      if (setPayrollInputs) setPayrollInputs(list => list.filter(x => !(x.employeeId === employee.id && x.periodId === period)))
      setInputs(x => { const n = { ...x }; delete n[period + employee.id]; return n })
      notify('Payroll reset to Time In / Time Out', 'Payroll')
    } catch (err) { notify(err.message) }
  }
  return (
    <>
      <SectionTitle eyebrow="PEOPLE OPERATIONS" title="Payroll" description="Auto from Time In / Time Out. Admin or HR can update a cutoff with a reason." action={<><Select value={period} onChange={setPeriod} options={payPeriods.map(p => [p.id, p.label])} /><Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print</Button></>} />
      <div className="notice-line"><ShieldCheck size={18} /><span>Duty days, late, undertime, and night hours come from Time In / Time Out. Two logins of the same person count as one day. OT is not automatic. Contribution tables are demo values.</span></div>
      <div className="payroll-header">
        <div><span>PAY PERIOD</span><strong>{P.label}</strong><small>Cutoff: {fmt(P.cutoff)} · Release: {fmt(P.pay)}</small></div>
        <div><span>PAYROLL BASIS</span><strong>Auto from attendance</strong><small>No work, no pay · days with Time In</small></div>
        <div><span>HOLIDAYS IN PERIOD</span><strong>{P.holidays.length ? P.holidays.map(h => h[1]).join(', ') : 'None'}</strong><small>Regular +100% · Special +30%</small></div>
      </div>
      <Tabs items={['Payroll register', 'Computation', 'Contribution overrides', 'OT approvals', 'Payroll history']} value={tab} onChange={setTab} />
      {tab === 'Payroll register' && <Card title={'Payroll register · ' + P.label + (branch === 'All branches' ? ' · consolidated' : ' · ' + branch)}>
        <Table pageSize={12} columns={[
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
          { label: 'NET PAY', render: r => <strong>{money(r.c.net)}</strong> },
          { label: '', render: r => <button className="table-link" onClick={() => { setSelected(r.id); setTab('Computation') }}>{admin ? 'Update →' : 'View →'}</button> }
        ]} rows={register} />
        <div className="net-line"><span>Total net pay · {register.length} employees</span><strong>{money(total('net'))}</strong></div>
        <p className="card-note">Gross {money(total('gross'))} · Contributions {money(total('sss') + total('phil') + total('pagibig'))} · Late/undertime {money(total('lateDed') + total('underDed'))}</p>
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
              <Field label="Approved OT hours" name="ot" type="number" value={current.ot} onChange={upd} disabled={!admin} help="Not auto. Enter then approve." />
              <Field label="OT rate multiplier" type="number" value={otRate} onChange={e => setOtRate(Number(e.target.value) || 1)} disabled={!admin} />
              <Field label="Night-duty hours" name="night" type="number" value={current.night} onChange={upd} disabled={!admin || !(employee.shift === 'Night Shift' && nightOf(branchMaster, employee.branch))} help="Auto from night Time In / Time Out" />
              <Field label="Holiday duty days" name="holiday" type="number" value={current.holiday} onChange={upd} disabled={!admin} />
              <Field label="Holiday type" name="holidayType" value={current.holidayType} onChange={upd} options={['Regular', 'Special']} disabled={!admin} />
            </div>
            <label className="toggle-line"><input type="checkbox" name="otApproved" checked={!!current.otApproved} onChange={upd} disabled={!admin} /><span>Overtime approved by an authorized management approver</span></label>
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
            <p className="card-note">Night differential = 10% of hourly rate × night hours. Holiday pay = daily rate × (100% regular / 30% special).</p>
          </Card>
        </div>
      </div>}
      {tab === 'Contribution overrides' && <div className="split-overview">
        <Card title="Per-employee override">
          <div className="form-grid">
            <Field label="Employee" value={selected} options={visible.map(x => [x.id, x.name])} onChange={e => setSelected(e.target.value)} />
            <Field label="Effective from cutoff" value={ovForm.from} options={payPeriods.map(p => [p.id, p.label])} onChange={e => setOvForm({ ...ovForm, from: e.target.value })} />
            <Field label={'SSS (computed ' + money(calc(employee, current).sss) + ')'} type="number" value={ovForm.sss} onChange={e => setOvForm({ ...ovForm, sss: e.target.value })} />
            <Field label={'PhilHealth (computed ' + money(calc(employee, current).phil) + ')'} type="number" value={ovForm.phil} onChange={e => setOvForm({ ...ovForm, phil: e.target.value })} />
            <Field label={'Pag-IBIG (computed ' + money(calc(employee, current).pagibig) + ')'} type="number" value={ovForm.pagibig} onChange={e => setOvForm({ ...ovForm, pagibig: e.target.value })} />
          </div>
          <Field label="Reason (required)" type="textarea" value={ovForm.reason} onChange={e => setOvForm({ ...ovForm, reason: e.target.value })} />
          <Button onClick={() => { if (!ovForm.reason) { notify('Enter a reason for the contribution override'); return } setOverrides({ ...overrides, [employee.id]: { sss: ovForm.sss, phil: ovForm.phil, pagibig: ovForm.pagibig } }); setOverrideLog([{ id: Date.now(), employee: employee.name, values: [ovForm.sss || 'auto', ovForm.phil || 'auto', ovForm.pagibig || 'auto'].join(' / '), reason: ovForm.reason, effective: payPeriods.find(p => p.id === ovForm.from).label, by: 'Alex Rivera (' + role + ')' }, ...overrideLog]); setOvForm({ ...ovForm, reason: '' }); notify('Contribution override saved with audit trail', 'Payroll') }}>Save override</Button>
        </Card>
        <Card title="Override audit"><Table columns={[{ label: 'EMPLOYEE', key: 'employee' }, { label: 'SSS / PHIC / HDMF', key: 'values' }, { label: 'REASON', key: 'reason' }, { label: 'EFFECTIVE', key: 'effective' }, { label: 'CHANGED BY', key: 'by' }]} rows={overrideLog} empty="No contribution overrides recorded." /></Card>
      </div>}
      {tab === 'OT approvals' && <Card title="Overtime approval">
        <div className="notice-line"><Clock3 size={18} /><span>Overtime is not automatic. Paid only when entered and approved by Admin or HR.</span></div>
        <Table columns={[
          { label: 'EMPLOYEE', key: 'name' }, { label: 'BRANCH', key: 'branch' }, { label: 'OT HOURS', render: r => r.i.ot },
          { label: 'STATUS', render: r => <Badge>{r.i.otApproved ? 'Approved' : 'Pending'}</Badge> },
          { label: '', render: r => !r.i.otApproved && admin ? <button className="table-link" onClick={() => { setInputs({ ...inputs, [period + r.id]: { ...r.i, otApproved: true } }); notify('Overtime approved for ' + r.name, 'Payroll') }}>Approve →</button> : null }
        ]} rows={register.filter(r => Number(r.i.ot) > 0)} empty="No overtime filed for this cutoff." />
      </Card>}
      {tab === 'Payroll history' && <Card title="Payroll history">
        <Table columns={[
          { label: 'PAY PERIOD', key: 'label' }, { label: 'CUTOFF', render: r => fmt(r.cutoff) }, { label: 'RELEASE', render: r => fmt(r.pay) },
          { label: 'EMPLOYEES', key: 'count' }, { label: 'GROSS', render: r => money(r.gross) }, { label: 'NET PAY', render: r => <strong>{money(r.net)}</strong> },
          { label: 'STATUS', render: r => <Badge>{r.pay < today ? 'Released' : 'Open'}</Badge> }
        ]} rows={payPeriods.map(p => { const rs = visible.map(e => calc(e, payOf(e, p.id, attendance, users, payrollInputs, inputs), ov(e), otRate, branchMaster)); return { id: p.id, ...p, count: rs.length, gross: rs.reduce((a, r) => a + r.gross, 0), net: rs.reduce((a, r) => a + r.net, 0) } })} />
        <p className="card-note">History uses Time In unless Admin saved an update for that cutoff.</p>
      </Card>}
    </>
  )
}

export function PayslipsPage({
  branch, role, employees = [], employeeId, branchMaster, attendance = [], users = [], payrollInputs = []
}) {
  const admin = payrollAdmins.includes(role)
  const me = employeeId || employees[0]?.id || ''
  const visible = admin ? scope(employees, branch) : employees.filter(e => e.id === me)
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
  const current = payOf(employee, period, attendance, users, payrollInputs, {})
  const c = calc(employee, current, {}, 1, branchMaster)
  return (
    <>
      <SectionTitle eyebrow="PEOPLE OPERATIONS" title="Payslips" description={admin ? 'Printable payslips. Figures come from Time In unless payroll was updated.' : 'Your payslips from Time In / Time Out.'} action={<Button variant="secondary" icon={Printer} onClick={() => window.print()}>Print / download payslip</Button>} />
      <div className="payslip-select">
        {admin && <Field label="Select employee" value={id} options={visible.map(e => [e.id, e.name + ' · ' + e.branch])} onChange={e => setId(e.target.value)} />}
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
          <div><h3>Earnings</h3><div><span>Basic pay</span><strong>{money(c.basic)}</strong></div><div><span>Approved overtime</span><strong>{money(c.otPay)}</strong></div><div><span>Night differential</span><strong>{money(c.nightPay)}</strong></div><div><span>Holiday pay</span><strong>{money(c.holidayPay)}</strong></div><div><span>Officer allowance</span><strong>{money(c.allowance)}</strong></div></div>
          <div><h3>Deductions</h3><div><span>Late</span><strong>{money(c.lateDed)}</strong></div><div><span>Undertime</span><strong>{money(c.underDed)}</strong></div><div><span>SSS</span><strong>{money(c.sss)}</strong></div><div><span>PhilHealth</span><strong>{money(c.phil)}</strong></div><div><span>Pag-IBIG</span><strong>{money(c.pagibig)}</strong></div><div><span>Other approved deductions</span><strong>{money(c.other)}</strong></div></div>
        </div>
        <div className="payslip-net"><span>NET PAY</span><strong>{money(c.net)}</strong></div>
        <p>{current.stored ? 'Updated by Admin · ' + (current.reason || '') : 'Auto from Time In / Time Out'} · Statutory tables require production validation.</p>
      </div>
    </>
  )
}
