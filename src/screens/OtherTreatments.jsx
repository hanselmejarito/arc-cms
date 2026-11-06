import React from 'react'
import { Plus, Syringe, CreditCard, X } from 'lucide-react'
import { api } from '../api'
import { branches, fmt, money } from '../data'
import { Badge, Button, Card, Field, Modal, SectionTitle, Table } from '../components'

const services = ['ERIG', 'TT', 'Flu', 'Pneumococcal', 'Hepatitis B']
const blank = (branch, patientId) => ({ branch: branch === 'All branches' ? '' : branch, patientId: patientId || '', service: '' })
const errorMessage = e => e instanceof Error ? e.message : 'Request failed.'

function cents(value) {
  const text = String(value).trim()
  if (!/^[0-9]+(?:[.][0-9]{1,2})?$/.test(text)) return null
  const [whole, decimals = ''] = text.split('.')
  const amount = Number(whole) * 100 + Number(decimals.padEnd(2, '0'))
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100000000 ? amount : null
}
function paymentRow(t) {
  const p = t.payment
  return { id: p.id, registry: '', encounterId: '', patientId: t.patient.id, patient: t.patient.name, otherTreatmentStatus: t.status, branch: t.branch,
    date: p.paymentDate, service: t.service, classification: 'Other treatment', amount: p.amountCentavos / 100,
    method: p.method, reference: p.externalReference || '—', status: 'Paid',
    remarks: 'Other treatment · ' + t.reference, txn: t.reference }
}

export function OtherTreatmentHistory({ patientId, branch }) {
  const [rows, setRows] = React.useState(null)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let active = true
    setRows(null); setError('')
    api('/api/other-treatments?patientId=' + encodeURIComponent(patientId))
      .then(data => { if (active) setRows(data) })
      .catch(e => { if (active) setError(errorMessage(e)) })
    return () => { active = false }
  }, [patientId])
  const filtered = (rows || []).filter(row => branch === 'All branches' || row.branch === branch)
  return <Card title="Other treatments">
    {error ? <p role="alert">{error}</p> : rows === null ? <p className="card-note">Loading…</p> :
      <Table columns={[
        { label: 'REFERENCE', key: 'reference' }, { label: 'DATE', render: r => fmt(r.date) },
        { label: 'SERVICE', key: 'service' }, { label: 'BRANCH', key: 'branch' },
        { label: 'STATUS', render: r => <Badge>{r.status}</Badge> },
        { label: 'PRODUCT / BATCH', render: r => r.product ? r.product + (r.brand ? ' · ' + r.brand : '') + ' · ' + r.batch : '—' },
        { label: 'GIVEN BY', render: r => r.administeredBy || '—' }
      ]} rows={filtered} empty="No other treatments recorded."/>}
  </Card>
}

export default function OtherTreatmentsPage({ branch, patientId, patients = [], userName, can, notify, go, setPayments, setInventory, setMovements }) {
  const [rows, setRows] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState('')
  const [modal, setModal] = React.useState(null)
  const [form, setForm] = React.useState(() => blank(branch, patientId))
  const [stock, setStock] = React.useState([])
  const [stockError, setStockError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const requestInFlight = React.useRef(false)
  const load = React.useCallback(async () => {
    setLoading(true); setLoadError('')
    try { setRows(await api('/api/other-treatments')) }
    catch (e) { setLoadError(errorMessage(e)) }
    finally { setLoading(false) }
  }, [])
  React.useEffect(() => { load() }, [load])
  React.useEffect(() => {
    if (modal?.kind !== 'give') return
    let active = true
    setStock([]); setStockError('')
    api('/api/other-treatments/stock?branch=' + encodeURIComponent(modal.row.branch) + '&service=' + encodeURIComponent(modal.row.service))
      .then(lines => { if (active) setStock(lines) })
      .catch(e => { if (active) setStockError(errorMessage(e)) })
    return () => { active = false }
  }, [modal?.kind, modal?.row?.id])
  const replace = row => setRows(list => list.some(x => x.id === row.id) ? list.map(x => x.id === row.id ? row : x) : [row, ...list])
  const visible = rows.filter(x => branch === 'All branches' || x.branch === branch)
  async function run(action) {
    if (requestInFlight.current) return
    requestInFlight.current = true
    setBusy(true)
    try { await action(); setModal(null) }
    catch (e) { notify(errorMessage(e), 'error') }
    finally { requestInFlight.current = false; setBusy(false) }
  }
  const openCreate = () => { setForm(blank(branch, patientId)); setModal({ kind: 'create' }) }
  const openGive = row => { setForm({ stockLineId: '', stockQuantity: '1', brand: '', administeredQuantity: '', administeredUnit: '', administeredBy: userName || '', remarks: '' }); setModal({ kind: 'give', row }) }
  const openPayment = row => { setForm({ amount: '', method: '', externalReference: '' }); setModal({ kind: 'pay', row }) }
  const openCancel = row => { setForm({ reason: '' }); setModal({ kind: 'cancel', row }) }
  const onSave = () => run(async () => {
    if (modal.kind === 'create') {
      if (!form.patientId || !form.branch || !form.service) throw new Error('Select a patient, branch and treatment.')
      const row = await api('/api/other-treatments', { body: form })
      replace(row); notify('Other treatment created · ' + row.reference)
    } else if (modal.kind === 'give') {
      if (!form.stockLineId || !form.brand.trim() || !form.administeredBy.trim()) throw new Error('Select the stock batch and enter the product brand and administering staff.')
      const q = form.administeredQuantity.trim()
      if (!!q !== !!form.administeredUnit.trim()) throw new Error('Enter both the administered quantity and unit, or leave both blank.')
      const stockQuantity = Number(form.stockQuantity)
      if (!Number.isInteger(stockQuantity) || stockQuantity < 1) throw new Error('Enter a valid number of vials.')
      const data = { stockLineId: form.stockLineId, stockQuantity, brand: form.brand, administeredBy: form.administeredBy, remarks: form.remarks,
        ...(q ? { administeredQuantity: Number(q), administeredUnit: form.administeredUnit } : {}) }
      const result = await api('/api/other-treatments/' + encodeURIComponent(modal.row.id) + '/give', { body: data })
      replace(result.treatment)
      if (setInventory) setInventory(list => list.map(x => x.id === result.line.id ? result.line : x))
      if (setMovements) setMovements(list => [result.movement, ...list])
      notify('Treatment recorded · stock deducted')
    } else if (modal.kind === 'pay') {
      const amountCentavos = cents(form.amount)
      if (!amountCentavos || !form.method) throw new Error('Enter a valid payment amount and method.')
      const row = await api('/api/other-treatments/' + encodeURIComponent(modal.row.id) + '/payment', { body: { amountCentavos, method: form.method, externalReference: form.externalReference } })
      replace(row)
      if (setPayments && row.payment?.id) setPayments(list => [paymentRow(row), ...list.filter(p => p.id !== row.payment.id)])
      notify('Payment recorded · treatment status unchanged')
    } else if (modal.kind === 'cancel') {
      if (!form.reason.trim()) throw new Error('Enter a reason for cancellation.')
      const row = await api('/api/other-treatments/' + encodeURIComponent(modal.row.id) + '/cancel', { body: { reason: form.reason } })
      replace(row)
      if (setPayments && row.payment?.id) setPayments(list => list.map(p => p.id === row.payment.id ? paymentRow(row) : p))
      notify(row.payment ? 'Treatment cancelled · request a refund if needed' : 'Treatment cancelled')
    }
  })
  return <>
    <SectionTitle eyebrow="CLINICAL CARE" title="Other treatments" description="Standalone services linked to the patient. No RER or admission number is created." action={<Button icon={Plus} onClick={openCreate}>New other treatment</Button>}/>
    <div className="notice-line"><span>Payment and treatment are separate. Stock is deducted only when treatment is confirmed given. Amounts must be checked against the clinic-approved price list.</span></div>
    <Card title="Other treatment records">
      {loadError ? <p role="alert">{loadError} <button type="button" onClick={load}>Retry</button></p> : loading ? <p className="card-note">Loading…</p> :
      <Table columns={[
        { label: 'TREATMENT REF.', key: 'reference' }, { label: 'PATIENT', render: r => r.patient?.name || '—' },
        { label: 'BRANCH', key: 'branch' }, { label: 'DATE', render: r => fmt(r.date) },
        { label: 'SERVICE', key: 'service' }, { label: 'TREATMENT', render: r => <Badge tone={r.status === 'Given' ? 'green' : r.status === 'Cancelled' ? 'red' : 'amber'}>{r.status}</Badge> },
        { label: 'PAYMENT', render: r => <Badge>{r.payment ? 'Paid' : 'Pending'}</Badge> },
        { label: 'ACTION', render: r => <div className="row-actions">
          <button type="button" onClick={() => setModal({ kind: 'view', row: r })}>View</button>
          {r.status === 'Pending' && <button type="button" onClick={() => openGive(r)}>Mark given</button>}
          {r.status !== 'Cancelled' && !r.payment && can('payments') && <button type="button" onClick={() => openPayment(r)}>Record payment</button>}
          {r.status === 'Pending' && <button type="button" onClick={() => openCancel(r)}>Cancel</button>}
          {r.status === 'Cancelled' && r.payment && can('refunds') && <button type="button" onClick={() => go('refunds')}>Refunds</button>}
        </div> }
      ]} rows={visible} empty="No other treatments recorded."/>}
    </Card>
    {modal && <Modal title={modal.kind === 'create' ? 'New other treatment' : modal.kind === 'give' ? 'Confirm treatment given' : modal.kind === 'pay' ? 'Record payment' : modal.kind === 'view' ? 'Treatment details' : 'Cancel treatment'} width="wide" onClose={() => !busy && setModal(null)} footer={<><Button variant="secondary" disabled={busy} onClick={() => setModal(null)}>Close</Button>{modal.kind !== 'view' && <Button disabled={busy} onClick={onSave}>{modal.kind === 'give' ? 'Confirm given & deduct stock' : modal.kind === 'pay' ? 'Record payment' : modal.kind === 'cancel' ? 'Cancel treatment' : 'Create treatment'}</Button>}</>}>
      {modal.kind === 'view' && <div className="detail-grid">
        <div><small>Reference</small><strong>{modal.row.reference}</strong></div>
        <div><small>Patient</small><strong>{modal.row.patient?.name || '—'}</strong></div>
        <div><small>Branch / date</small><strong>{modal.row.branch} · {fmt(modal.row.date)}</strong></div>
        <div><small>Service / status</small><strong>{modal.row.service} · {modal.row.status}</strong></div>
        <div><small>Product / brand</small><strong>{modal.row.product ? modal.row.product + (modal.row.brand ? ' · ' + modal.row.brand : '') : '—'}</strong></div>
        <div><small>Batch / expiry</small><strong>{modal.row.batch ? modal.row.batch + ' · ' + fmt(modal.row.stockExpiry) : '—'}</strong></div>
        <div><small>Stock used</small><strong>{modal.row.stockQuantity == null ? '—' : modal.row.stockQuantity + ' ' + (modal.row.stockQuantity === 1 && modal.row.stockUnit === 'vials' ? 'vial' : modal.row.stockUnit)}</strong></div>
        <div><small>Actual quantity</small><strong>{modal.row.administeredQuantity == null ? '—' : modal.row.administeredQuantity + ' ' + modal.row.administeredUnit}</strong></div>
        <div><small>Administered by</small><strong>{modal.row.administeredBy || '—'}</strong></div>
        <div><small>Given at</small><strong>{modal.row.administeredAt ? new Date(modal.row.administeredAt).toLocaleString('en-PH', {timeZone:'Asia/Manila'}) : '—'}</strong></div>
        <div><small>Payment</small><strong>{modal.row.payment ? (can('payments') && modal.row.payment.amountCentavos != null ? 'Paid · ' + money(modal.row.payment.amountCentavos / 100) : 'Paid') : 'Pending'}</strong></div>
        <div><small>Remarks / cancellation reason</small><strong>{modal.row.remarks || '—'}</strong></div>
      </div>}
      {modal.kind === 'create' && <><div className="form-grid">
        <Field label="Patient" value={form.patientId} options={patients.map(p => [p.id, p.name + ' · ' + fmt(p.birthday) + ' · ' + p.branch])} onChange={e => setForm({ ...form, patientId: e.target.value })} required/>
        <Field label="Branch" value={form.branch} options={branch === 'All branches' ? branches.slice(1) : [branch]} onChange={e => setForm({ ...form, branch: e.target.value })} required/>
        <Field label="Treatment" value={form.service} options={services} onChange={e => setForm({ ...form, service: e.target.value })} required/>
      </div><p className="card-note">For a new patient, create a patient record first. No admission or RER is needed.</p></>}
      {modal.kind === 'give' && <><p className="card-note">Confirm only after the treatment was actually administered. This deducts stock from {modal.row.branch}.</p>
        {stockError && <p role="alert">{stockError}</p>}
        {!stock.length && !stockError && <p className="card-note">No usable stock batch found. Receive stock first.</p>}
        <div className="form-grid">
          <Field label="Stock batch" value={form.stockLineId} options={stock.map(x => [x.id, x.item + ' · ' + x.batch + ' · expires ' + fmt(x.expiry) + ' · ' + x.stock + ' vials'])} onChange={e => setForm({ ...form, stockLineId: e.target.value })} required/>
          <Field label="Product brand" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} required/>
          <Field label="Vials used" type="number" min="1" value={form.stockQuantity} disabled={modal.row.service !== 'ERIG'} onChange={e => setForm({ ...form, stockQuantity: e.target.value })} required/>
          <Field label="Administered by" value={form.administeredBy} onChange={e => setForm({ ...form, administeredBy: e.target.value })} required/>
          <Field label="Actual quantity (optional)" type="number" min="0" value={form.administeredQuantity} onChange={e => setForm({ ...form, administeredQuantity: e.target.value })}/>
          <Field label="Actual unit (if quantity entered)" value={form.administeredUnit} onChange={e => setForm({ ...form, administeredUnit: e.target.value })}/>
        </div><Field label="Remarks" type="textarea" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })}/></>}
      {modal.kind === 'pay' && <><p className="card-note">Use the clinic-approved price. Recording payment does not mark treatment as given or deduct stock.</p><div className="form-grid">
        <Field label="Amount (PHP)" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} required/>
        <Field label="Payment method" value={form.method} options={['Cash', 'GCash', 'Bank transfer']} onChange={e => setForm({ ...form, method: e.target.value })} required/>
        <Field label="External receipt / reference" value={form.externalReference} onChange={e => setForm({ ...form, externalReference: e.target.value })}/>
      </div></>}
      {modal.kind === 'cancel' && <><p className="card-note">Only treatment not yet given can be cancelled. An existing payment stays on the ledger; request a refund separately.</p><Field label="Reason" type="textarea" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required/></>}
    </Modal>}
  </>
}