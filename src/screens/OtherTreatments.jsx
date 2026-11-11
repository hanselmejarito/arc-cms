import React from 'react'
import { Plus, Syringe, CreditCard, X } from 'lucide-react'
import { api } from '../api'
import { branches, fmt, money, servicePrice } from '../data'
import { Badge, Button, Card, Field, Modal, SectionTitle, Table } from '../components'

const services = ['ERIG', 'TT', 'Flu', 'Pneumococcal', 'Hepatitis B']
const serviceLabel = service => ({ ERIG: 'ERIG (serum)', TT: 'Tetanus Toxoid' }[service] || service)
const priceName = { ERIG: 'ERIG (serum)', TT: 'Tetanus Toxoid', Flu: 'Flu', 'Flu Regular': 'Flu Regular', 'Flu Student': 'Flu Student', 'Flu Senior-PWD': 'Flu Senior-PWD', Pneumococcal: 'Pneumococcal vaccine', 'Hepatitis B': 'Hepatitis B' }
const blankItem = () => ({ id: crypto.randomUUID(), service: '', stockLineId: '', stockQuantity: '1', brand: '', remarks: '', price: '' })
const blank = (branch, patientId, userName) => ({ branch: branch === 'All branches' ? '' : branch, patientId: patientId || '', requestId: crypto.randomUUID(), administeredBy: userName || '', items: [blankItem()] })
const errorMessage = e => e instanceof Error ? e.message : 'Request failed.'

function cents(value) {
  const text = String(value).trim()
  if (!/^[0-9]+(?:[.][0-9]{1,2})?$/.test(text)) return null
  const [whole, decimals = ''] = text.split('.')
  const amount = Number(whole) * 100 + Number(decimals.padEnd(2, '0'))
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100000000 ? amount : null
}
function groupTreatmentVisits(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = row.visitId ? 'visit:' + row.visitId : 'treatment:' + row.id
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return Array.from(groups.values()).map(items => {
    const ordered = [...items].sort((a, b) => a.reference.localeCompare(b.reference))
    const first = ordered[0]
    const statuses = [...new Set(ordered.map(item => item.status))]
    return { ...first, payment: ordered.find(item => item.payment)?.payment || null,
      status: statuses.length === 1 ? statuses[0] : statuses.join(' / '), treatments: ordered }
  })
}
const visitServices = row => (row.treatments || [row]).map(item => serviceLabel(item.service)).join(' + ')
const sameVisitValue = (row, key) => { const items = row.treatments || [row]; return items.length > 0 && items.every(item => (item[key] || '') === (items[0][key] || '')) }
function paymentRow(t) {
  const p = t.payment
  return { id: p.id, registry: '', encounterId: '', patientId: t.patient.id, patient: t.patient.name, otherTreatmentStatus: t.status, branch: t.branch,
    date: p.paymentDate, service: t.service, classification: 'Other treatment', amount: p.amountCentavos / 100,
    method: p.method, reference: p.externalReference || '—', status: 'Paid',
    remarks: 'Other treatment · ' + t.reference, txn: t.reference, otherTreatmentId: t.visitId ? t.id : undefined, otherTreatmentVisitId: t.visitId || null }
}

function pendingPaymentRow(treatments) {
  const ordered = [...treatments].sort((a, b) => a.reference.localeCompare(b.reference)), first = ordered[0]
  return { id: 'OT-PENDING-' + first.id, txn: first.reference, registry: '', encounterId: '', patientId: first.patient.id, patient: first.patient.name,
    branch: first.branch, date: first.date, service: ordered.map(t => t.service).join(' + '), classification: 'Other treatment',
    amount: ordered.reduce((sum, t) => sum + (t.priceCentavos || 0), 0) / 100, method: '—', reference: '—', status: 'Pending',
    remarks: 'Other treatment · ' + first.reference, otherTreatmentId: first.id, otherTreatmentVisitId: first.visitId }
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
  const filtered = groupTreatmentVisits((rows || []).filter(row => branch === 'All branches' || row.branch === branch))
  return <Card title="Other treatments">
    {error ? <p role="alert">{error}</p> : rows === null ? <p className="card-note">Loading…</p> :
      <Table columns={[
        { label: 'REFERENCE', key: 'reference' }, { label: 'DATE', render: r => fmt(r.date) },
        { label: 'SERVICE', render: visitServices }, { label: 'BRANCH', key: 'branch' },
        { label: 'STATUS', render: r => <Badge>{r.status}</Badge> },
        { label: 'PRODUCT / BATCH', render: r => r.treatments.map(t => t.product ? serviceLabel(t.service) + ': ' + t.product + (t.brand ? ' · ' + t.brand : '') + ' · ' + t.batch : '—').join(' | ') },
        { label: 'GIVEN BY', render: r => [...new Set(r.treatments.map(t => t.administeredBy).filter(Boolean))].join(', ') || '—' }
      ]} rows={filtered} empty="No other treatments recorded."/>}
  </Card>
}

export default function OtherTreatmentsPage({ branch, patientId, patients = [], userName, can, notify, go, setPayments, setInventory, setMovements }) {
  const [rows, setRows] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState('')
  const [modal, setModal] = React.useState(null)
  const [form, setForm] = React.useState(() => blank(branch, patientId, userName))
  const [stock, setStock] = React.useState([])
  const [stockError, setStockError] = React.useState('')
  const [visitStock, setVisitStock] = React.useState({})
  const [visitStockError, setVisitStockError] = React.useState('')
  const [visitStockLoading, setVisitStockLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const requestInFlight = React.useRef(false)
  const visitStockCache = React.useRef({ branch: '', services: {} })
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
      .then(lines => { if (active) { setStock(lines); setForm(f => ({ ...f, stockLineId: lines.some(line => line.id === f.stockLineId) ? f.stockLineId : (lines[0]?.id || '') })) } })
      .catch(e => { if (active) setStockError(errorMessage(e)) })
    return () => { active = false }
  }, [modal?.kind, modal?.row?.id])
  const selectedServices = form.items?.map(item => item.service).filter(Boolean).sort().join('|') || ''
  React.useEffect(() => {
    if (modal?.kind !== 'create' || !form.branch || !selectedServices) {
      setVisitStock({}); setVisitStockLoading(false); setVisitStockError(''); return
    }
    let active = true
    if (visitStockCache.current.branch !== form.branch) {
      visitStockCache.current = { branch: form.branch, services: {} }
      setVisitStock({})
    }
    const cache = visitStockCache.current.services
    const requested = selectedServices.split('|')
    const missing = requested.filter(service => !Object.prototype.hasOwnProperty.call(cache, service))
    const applySelections = () => {
      setVisitStock({ ...cache })
      setForm(f => ({ ...f, items: f.items.map(item => {
        const lines = cache[item.service]
        if (!lines) return item
        return { ...item, stockLineId: lines.some(line => line.id === item.stockLineId) ? item.stockLineId : (lines[0]?.id || '') }
      }) }))
    }
    setVisitStockError('')
    if (!missing.length) { applySelections(); setVisitStockLoading(false); return }
    setVisitStockLoading(true)
    Promise.allSettled(missing.map(service => api('/api/other-treatments/stock?branch=' + encodeURIComponent(form.branch) + '&service=' + encodeURIComponent(service))))
      .then(results => {
        if (!active) return
        const failed = []
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') cache[missing[index]] = result.value
          else failed.push(serviceLabel(missing[index]))
        })
        applySelections()
        if (failed.length) setVisitStockError('Unable to load stock for ' + failed.join(', ') + '. Close and reopen the form to retry.')
      })
      .finally(() => { if (active) setVisitStockLoading(false) })
    return () => { active = false }
  }, [modal?.kind, form.branch, selectedServices])
  const replace = row => setRows(list => list.some(x => x.id === row.id) ? list.map(x => x.id === row.id ? row : x) : [row, ...list])
  const visible = groupTreatmentVisits(rows.filter(x => branch === 'All branches' || x.branch === branch))
  async function run(action) {
    if (requestInFlight.current) return
    requestInFlight.current = true
    setBusy(true)
    try { await action(); setModal(null) }
    catch (e) { notify(errorMessage(e), 'error') }
    finally { requestInFlight.current = false; setBusy(false) }
  }
  const setItem = (id, values) => setForm(f => ({ ...f, items: f.items.map(x => x.id === id ? { ...x, ...values } : x) }))
  const selectService = (id, service) => setItem(id, { service, stockLineId: '', stockQuantity: '1', brand: '', price: service ? String(servicePrice(priceName[service]) || '') : '' })
  const openCreate = () => { visitStockCache.current = { branch: '', services: {} }; setVisitStock({}); setForm(blank(branch, patientId, userName)); setModal({ kind: 'create' }) }
  const openGive = row => { setForm({ stockLineId: '', stockQuantity: '1', brand: '', administeredQuantity: '', administeredUnit: '', administeredBy: userName || '', remarks: '' }); setModal({ kind: 'give', row }) }
  const openPayment = row => { const group = row.visitId ? rows.filter(x => x.visitId === row.visitId) : [row]; if (row.visitId) { const pending = pendingPaymentRow(group); if (setPayments) setPayments(list => list.some(p => p.otherTreatmentVisitId === pending.otherTreatmentVisitId) ? list : [pending, ...list]); go('payments', 'other:' + pending.otherTreatmentId); return } setForm({ amount: '', method: '', externalReference: '' }); setModal({ kind: 'pay', row, group }) }
  const openCancel = row => { setForm({ reason: '' }); setModal({ kind: 'cancel', row }) }
  const onSave = () => run(async () => {
    if (modal.kind === 'create') {
      if (!form.patientId || !form.branch || !form.items.length) throw new Error('Select a patient, branch and at least one treatment.')
      if (!form.administeredBy.trim()) throw new Error('Enter the administering staff member.')
      const items = form.items.map(item => {
        const priceCentavos = cents(item.price), stockQuantity = Number(item.stockQuantity)
        if (!item.service || !item.stockLineId || !priceCentavos || !Number.isInteger(stockQuantity) || stockQuantity < 1) throw new Error('Complete the batch, vials used and price for every service.')
        return { service: item.service, stockLineId: item.stockLineId, stockQuantity, brand: item.brand, administeredBy: form.administeredBy, remarks: item.remarks, priceCentavos }
      })
      const result = await api('/api/other-treatment-visits', { body: { requestId: form.requestId, patientId: form.patientId, branch: form.branch, items } })
      setRows(list => [...result.treatments, ...list.filter(x => !result.treatments.some(t => t.id === x.id))])
      if (setPayments && can('payments') && result.treatments.length && !result.treatments.some(t => t.payment)) { const pending = pendingPaymentRow(result.treatments); setPayments(list => [pending, ...list.filter(p => p.otherTreatmentVisitId !== pending.otherTreatmentVisitId && p.id !== pending.id)]) }
      if (setInventory) setInventory(list => list.map(x => [...result.lines].reverse().find(line => line.id === x.id) || x))
      if (setMovements) setMovements(list => [...result.movements, ...list.filter(x => !result.movements.some(m => m.id === x.id))])
      notify('Treatments recorded · stock deducted')
    } else if (modal.kind === 'give') {
      if (!form.stockLineId || !form.administeredBy.trim()) throw new Error('Select the stock batch and enter the administering staff.')
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
      if (modal.row.visitId) setRows(list => list.map(x => x.visitId === modal.row.visitId ? { ...x, payment: row.payment } : x)); else replace(row)
      if (setPayments && row.payment?.id) setPayments(list => [paymentRow({ ...row, service: modal.group.map(x => x.service).join(' + ') }), ...list.filter(p => p.id !== row.payment.id && (!row.visitId || p.otherTreatmentVisitId !== row.visitId))])
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
        { label: 'SERVICE', render: visitServices }, { label: 'TREATMENT', render: r => <Badge tone={r.status === 'Given' ? 'green' : r.status === 'Cancelled' ? 'red' : 'amber'}>{r.status}</Badge> },
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
    {modal && <Modal title={modal.kind === 'create' ? 'New other treatment' : modal.kind === 'give' ? 'Confirm treatment given' : modal.kind === 'pay' ? 'Record payment' : modal.kind === 'view' ? 'Treatment details' : 'Cancel treatment'} width="wide" onClose={() => !busy && setModal(null)} footer={<><Button variant="secondary" disabled={busy} onClick={() => setModal(null)}>Close</Button>{modal.kind !== 'view' && <Button disabled={busy || (modal.kind === 'create' && visitStockLoading)} onClick={onSave}>{modal.kind === 'give' ? 'Confirm given & deduct stock' : modal.kind === 'pay' ? 'Record payment' : modal.kind === 'cancel' ? 'Cancel treatment' : 'Save treatments as given'}</Button>}</>}>
      {modal.kind === 'view' && <>
        <div className="detail-grid">
          <div><small>Treatment reference</small><strong>{modal.row.reference}</strong></div>
          <div><small>Patient</small><strong>{modal.row.patient?.name || '—'}</strong></div>
          <div><small>Branch / date</small><strong>{modal.row.branch} · {fmt(modal.row.date)}</strong></div>
          <div><small>Services</small><strong>{visitServices(modal.row)}</strong></div>
          {sameVisitValue(modal.row, 'administeredBy') && <div><small>Administered by</small><strong>{modal.row.administeredBy || '—'}</strong></div>}
          {sameVisitValue(modal.row, 'administeredAt') && <div><small>Given at</small><strong>{modal.row.administeredAt ? new Date(modal.row.administeredAt).toLocaleString('en-PH', {timeZone:'Asia/Manila'}) : '—'}</strong></div>}
          <div><small>Payment</small><strong>{modal.row.payment ? (can('payments') && modal.row.payment.amountCentavos != null ? 'Paid · ' + money(modal.row.payment.amountCentavos / 100) : 'Paid') : 'Pending'}</strong></div>
        </div>
        {(modal.row.treatments || [modal.row]).map(t => <Card key={t.id} title={serviceLabel(t.service)}><div className="detail-grid">
          <div><small>Status</small><strong>{t.status}</strong></div>
          <div><small>Product / brand</small><strong>{t.product ? t.product + (t.brand ? ' · ' + t.brand : '') : '—'}</strong></div>
          <div><small>Batch / expiry</small><strong>{t.batch ? t.batch + ' · ' + fmt(t.stockExpiry) : '—'}</strong></div>
          <div><small>Stock used</small><strong>{t.stockQuantity == null ? '—' : t.stockQuantity + ' ' + (t.stockQuantity === 1 && t.stockUnit === 'vials' ? 'vial' : t.stockUnit)}</strong></div>
          {t.administeredQuantity != null && <div><small>Previously recorded quantity</small><strong>{t.administeredQuantity + ' ' + t.administeredUnit}</strong></div>}
          {!sameVisitValue(modal.row, 'administeredBy') && <div><small>Administered by</small><strong>{t.administeredBy || '—'}</strong></div>}
          {!sameVisitValue(modal.row, 'administeredAt') && <div><small>Given at</small><strong>{t.administeredAt ? new Date(t.administeredAt).toLocaleString('en-PH', {timeZone:'Asia/Manila'}) : '—'}</strong></div>}
          {can('payments') && t.priceCentavos != null && <div><small>Price</small><strong>{money(t.priceCentavos / 100)}</strong></div>}
          <div><small>Remarks</small><strong>{t.remarks || '—'}</strong></div>
        </div></Card>)}
      </>}
      {modal.kind === 'create' && <><div className="form-grid">
        <Field label="Patient" value={form.patientId} options={patients.map(p => [p.id, p.name + ' · ' + fmt(p.birthday) + ' · ' + p.branch])} onChange={e => setForm({ ...form, patientId: e.target.value })} required/>
        <Field label="Branch" value={form.branch} options={branch === 'All branches' ? branches.slice(1) : [branch]} onChange={e => { setVisitStock({}); setForm({ ...form, branch: e.target.value, items: form.items.map(x => ({ ...x, stockLineId: '' })) }) }} required/>
        <Field label="Administered by" value={form.administeredBy} onChange={e => setForm({ ...form, administeredBy: e.target.value })} required/>
        <Field label="Given at" value="Recorded automatically when saved" disabled/>
      </div><p className="card-note">Select the services already given. Saving records each treatment and deducts its stock. Payment may follow later.</p>
      {visitStockError && <p role="alert">{visitStockError}</p>}
      {form.items.map((item, index) => <Card key={item.id} title={'Service ' + (index + 1)} action={form.items.length > 1 && <Button variant="secondary" icon={X} onClick={() => setForm(f => ({ ...f, items: f.items.filter(x => x.id !== item.id) }))}>Remove</Button>}>
        <div className="form-grid">
          <Field label="Service" value={item.service} options={services.filter(service => service === item.service || !form.items.some(x => x.service === service)).map(service => [service, serviceLabel(service)])} onChange={e => selectService(item.id, e.target.value)} required/>
          <Field label="Price (PHP)" value={item.price} onChange={e => setItem(item.id, { price: e.target.value })} required/>
          <Field label="Stock batch" value={item.stockLineId} options={(visitStock[item.service] || []).map(x => [x.id, x.item + ' · ' + x.batch + ' · expires ' + fmt(x.expiry) + ' · ' + x.stock + ' vials'])} onChange={e => setItem(item.id, { stockLineId: e.target.value })} required/>
          <Field label="Product brand (optional)" value={item.brand} onChange={e => setItem(item.id, { brand: e.target.value })}/>
          <Field label="Vials used" type="number" min="1" value={item.stockQuantity} disabled={item.service !== 'ERIG'} onChange={e => setItem(item.id, { stockQuantity: e.target.value })} required/>
        </div>{item.service && form.branch && (visitStockLoading ? <p className="card-note">Loading available stock batches…</p> : !visitStockError && !(visitStock[item.service] || []).length ? <p className="card-note" role="status">No available, unexpired stock batch for {serviceLabel(item.service)} in {form.branch}. Record stock in first or select the correct branch.</p> : null)}<Field label="Remarks" type="textarea" value={item.remarks} onChange={e => setItem(item.id, { remarks: e.target.value })}/></Card>)}
      <div className="row-actions"><Button variant="secondary" icon={Plus} disabled={form.items.length >= services.length || form.items.some(item => !item.service)} onClick={() => setForm(f => ({ ...f, items: [...f.items, blankItem()] }))}>Add service</Button></div>
      <div className="net-line"><span>Total</span><strong>{money(form.items.reduce((sum, item) => sum + (cents(item.price) || 0), 0) / 100)}</strong></div></>}
      {modal.kind === 'give' && <><p className="card-note">Confirm only after the treatment was actually administered. This deducts stock from {modal.row.branch}.</p>
        {stockError && <p role="alert">{stockError}</p>}
        {!stock.length && !stockError && <p className="card-note">No usable stock batch found. Receive stock first.</p>}
        <div className="form-grid">
          <Field label="Stock batch" value={form.stockLineId} options={stock.map(x => [x.id, x.item + ' · ' + x.batch + ' · expires ' + fmt(x.expiry) + ' · ' + x.stock + ' vials'])} onChange={e => setForm({ ...form, stockLineId: e.target.value })} required/>
          <Field label="Product brand (optional)" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })}/>
          <Field label="Vials used" type="number" min="1" value={form.stockQuantity} disabled={modal.row.service !== 'ERIG'} onChange={e => setForm({ ...form, stockQuantity: e.target.value })} required/>
          <Field label="Administered by" value={form.administeredBy} onChange={e => setForm({ ...form, administeredBy: e.target.value })} required/>
        </div><Field label="Remarks" type="textarea" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })}/></>}
      {modal.kind === 'pay' && <><p className="card-note">Use the clinic-approved price. Recording payment does not mark treatment as given or deduct stock.</p><div className="form-grid">
        <Field label="Amount (PHP)" value={form.amount} disabled={!!modal.row.visitId} onChange={e => setForm({ ...form, amount: e.target.value })} required/>
        <Field label="Payment method" value={form.method} options={['Cash', 'GCash', 'Bank transfer']} onChange={e => setForm({ ...form, method: e.target.value })} required/>
        <Field label="External receipt / reference" value={form.externalReference} onChange={e => setForm({ ...form, externalReference: e.target.value })}/>
      </div></>}
      {modal.kind === 'cancel' && <><p className="card-note">Only treatment not yet given can be cancelled. An existing payment stays on the ledger; request a refund separately.</p><Field label="Reason" type="textarea" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} required/></>}
    </Modal>}
  </>
}