import React from 'react'
import { History, Pencil } from 'lucide-react'
import { api } from './api'
import { Button, Field, Modal } from './components'
import SignaturePad from './SignaturePad'

export default function SignatureCorrection({ kind, recordId, currentImage, currentSigner, onSaved, notify }) {
  const [open, setOpen] = React.useState(false)
  const [historyOpen, setHistoryOpen] = React.useState(false)
  const [history, setHistory] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  const [signer, setSigner] = React.useState('')
  const [image, setImage] = React.useState('')
  const [method, setMethod] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState('')
  const path = '/api/signature-corrections/' + kind + '/' + encodeURIComponent(recordId)

  async function loadHistory() {
    setLoading(true); setError(''); setHistoryOpen(true)
    try { setHistory(await api(path)) } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  async function save() {
    if (!signer.trim() || !image || !reason.trim()) { setError('Enter the signer name, replacement signature and reason.'); return }
    if (loading) return
    setLoading(true); setError('')
    try {
      const result = await api(path, { body: { expectedImage: currentImage, signer: signer.trim(), image, method, reason: reason.trim() } })
      onSaved(result)
      setOpen(false)
      notify('Signature corrected. Previous signature is in history.')
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  return <>
    <div className="signature-actions">
      <Button variant="secondary" icon={Pencil} onClick={() => {setSigner(currentSigner || '');setImage('');setMethod('');setReason('');setError('');setOpen(true)}}>Replace signature</Button>
      <Button variant="secondary" icon={History} onClick={loadHistory}>View history</Button>
    </div>
    {open && <Modal title="Replace signature" width="wide" onClose={() => !loading && setOpen(false)} footer={<><Button variant="secondary" disabled={loading} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={loading} onClick={save}>Save correction</Button></>}>
      <p className="card-note">The previous signature will be retained in history. The replacement will appear on the printed record.</p>
      <Field label="Signer name" value={signer} onChange={event => setSigner(event.target.value)} required/>
      <SignaturePad allowUpload value={image} onChange={(v, m) => {setImage(v);setMethod(m)}}/>
      <Field label="Reason for correction" type="textarea" value={reason} onChange={event => setReason(event.target.value)} required/>
      {error && <p className="signature-error" role="alert">{error}</p>}
    </Modal>}
    {historyOpen && <Modal title="Signature history" width="wide" onClose={() => setHistoryOpen(false)} footer={<Button variant="secondary" onClick={() => setHistoryOpen(false)}>Close</Button>}>
      {loading ? <p className="card-note">Loading history…</p> : error ? <p className="signature-error" role="alert">{error}</p> : history.length === 0 ? <p className="card-note">No previous signatures.</p> : history.map(row => <div key={row.id} className="signature-preview" style={{marginBottom:12}}>
        <strong>{row.previousSigner || 'Previous signer'}</strong>
        <img src={row.previousImage} alt="Previous signature"/>
        <p>Replaced by {row.correctedByName} · {new Date(row.createdAt).toLocaleString('en-PH', {timeZone:'Asia/Manila'})}</p>
        <p>Reason: {row.reason}</p>
      </div>)}
    </Modal>}
  </>
}