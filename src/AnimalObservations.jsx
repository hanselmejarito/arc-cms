import React from 'react'
import { api } from './api'
import { Button, Card, Field, Modal, Table } from './components'
import { clinicDate, fmt } from './data'

export default function AnimalObservations({ encounter, status, onReviewed, notify, reviewOnly = false }) {
  const [rows, setRows] = React.useState([])
  const [error, setError] = React.useState('')
  const [modal, setModal] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [form, setForm] = React.useState({ status: '', observedDate: '', reportedDate: clinicDate(), remarks: '', clinician: '', reason: '' })
  const base = '/api/encounters/' + encodeURIComponent(encounter.id)
  React.useEffect(() => {
    let live = true
    setRows([]); setError('')
    api(base + '/animal-observations').then(result => { if (live) setRows(result) }).catch(() => { if (live) setError('Unable to load animal status history.') })
    return () => { live = false }
  }, [encounter.id])
  const reviewAvailable = encounter.day14Workflow === 'legacy' && encounter.regimen !== 'IM' && !encounter.preExp && !encounter.booster && ['Ongoing','Incomplete'].includes(status)
  const save = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (modal === 'review') {
        const updated = await api(base + '/day14-workflow-review', { body: { clinician: form.clinician, reason: form.reason } })
        onReviewed(updated)
        notify('Clinical review recorded.', 'Treatment')
      } else {
        const row = await api(base + '/animal-observations', { body: { status: form.status, observedDate: form.observedDate || null, reportedDate: form.reportedDate, remarks: form.remarks } })
        setRows(current => [row, ...current])
        notify('Animal status report saved.', 'Treatment')
      }
      setModal('')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  if (reviewOnly && !reviewAvailable) return null
  return <Card title={reviewOnly ? 'Day 14 workflow review' : 'Biting animal status'}>
    <p className="card-note">{reviewOnly ? 'A clinician must review this existing case before enabling the optional Day 14 workflow.' : 'Record new reports separately. The clinician decides whether Day 14 is needed; updating this history does not record a vaccine dose.'}</p>
    <div className="row-actions">{!reviewOnly&&<Button variant="secondary" onClick={() => { setForm({ status: '', observedDate: '', reportedDate: clinicDate(), remarks: '', clinician: '', reason: '' }); setError(''); setModal('observation') }}>Record status report</Button>}{reviewAvailable && <Button variant="secondary" onClick={() => { setError(''); setModal('review') }}>Record clinical review</Button>}</div>
    {error && !modal && <p role="alert">{error}</p>}
    {!reviewOnly&&<Table pageSize={5} columns={[{label:'STATUS',key:'status'},{label:'OBSERVED',render:r=>r.observedDate?fmt(r.observedDate):'Unknown'},{label:'REPORTED',render:r=>fmt(r.reportedDate)},{label:'RECORDED BY',key:'recordedBy'},{label:'REMARKS',render:r=>r.remarks||'—'}]} rows={rows} empty="No separate status reports recorded."/>}
    {modal && <Modal title={modal === 'review' ? 'Clinical review for Day 14' : 'Record animal status report'} onClose={() => !busy && setModal('')} footer={<><Button variant="secondary" disabled={busy} onClick={() => setModal('')}>Cancel</Button><Button disabled={busy} onClick={save}>Save</Button></>}>
      {modal === 'review' ? <><p className="card-note">Record the clinician's review before enabling the optional Day 14 workflow for this ongoing case.</p><Field label="Reviewing clinician" value={form.clinician} onChange={e=>setForm({...form,clinician:e.target.value})}/><Field label="Reason" type="textarea" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></> : <><Field label="Animal status" value={form.status} options={['Alive','Lost/Stray','Dead']} onChange={e=>setForm({...form,status:e.target.value})}/><Field label="Date observed (optional)" type="date" value={form.observedDate} onChange={e=>setForm({...form,observedDate:e.target.value})}/><Field label="Date reported" type="date" value={form.reportedDate} onChange={e=>setForm({...form,reportedDate:e.target.value})}/><Field label="Remarks" type="textarea" value={form.remarks} onChange={e=>setForm({...form,remarks:e.target.value})}/></>}
      {error && <p role="alert">{error}</p>}
    </Modal>}
  </Card>
}
