import React from 'react'
import { api } from './api'
import { Button, Card, Field, Modal, Table } from './components'
import SignaturePad from './SignaturePad'

export function useStaffSignatures() {
  const [rows,setRows]=React.useState([]),[error,setError]=React.useState(''),[loading,setLoading]=React.useState(true)
  React.useEffect(()=>{let live=true;api('/api/staff-signatures').then(r=>{if(live)setRows(r)}).catch(()=>{if(live)setError('Saved signatures are unavailable. You can still sign or upload for this record.')}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[])
  const refresh=React.useCallback(async()=>{try{const next=await api('/api/staff-signatures');setRows(next);setError('')}catch{setError('Saved signatures are unavailable. You can still sign or upload for this record.')}},[])
  return {rows,error,loading,refresh}
}

export function MySignatureProfile({onClose,notify}) {
  const [profile,setProfile]=React.useState(null),[draft,setDraft]=React.useState(null),[reason,setReason]=React.useState(''),[loading,setLoading]=React.useState(true),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('')
  React.useEffect(()=>{let live=true;api('/api/my-signature').then(p=>{if(live)setProfile(p)}).catch(e=>{if(live)setError(e.message)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[])
  const existing=profile?.signature
  const save=async()=>{
    if(!draft?.image){setError('Sign or upload your signature first.');return}
    if(existing&&!reason.trim()){setError('Enter a reason for the replacement.');return}
    setBusy(true);setError('')
    try{await api('/api/my-signature',{body:{image:draft.image,method:draft.method,...(existing?{expectedUpdatedAt:existing.updatedAt,reason:reason.trim()}:{})}});notify('Your signature was saved.');onClose()}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  return <Modal title="My profile" onClose={()=>!busy&&onClose()} footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Close</Button><Button disabled={loading||busy||!draft?.image||existing?.active===false} onClick={save}>Save signature</Button></>}>
    {loading?<p className="card-note">Loading your profile…</p>:profile&&<><Field label="Name" value={profile.name} disabled/><Field label="Branch" value={profile.branch} disabled/><p className="card-note">Your default signature is used when you are selected as the nurse. Previously saved records keep their original signature.</p>{existing?.active===false?<p role="alert">Your saved signature is disabled. Please contact an administrator.</p>:<>{existing&&!draft?.image&&<figure className="signature-preview"><figcaption>CURRENT SIGNATURE</figcaption><img src={existing.image} alt="Your current saved signature"/></figure>}{existing&&!draft?.image&&<p className="card-note">Sign or upload below to replace your signature.</p>}<SignaturePad allowUpload value={draft?.image||''} onChange={(image,method)=>{setDraft({image,method});setError('')}}/>{existing&&draft?.image&&<Field label="Reason for replacement" value={reason} onChange={e=>setReason(e.target.value)} required/>}</>}</>}
    {error&&<p role="alert">{error}</p>}
  </Modal>
}

export function StaffSignaturesManager({employees=[],notify}) {
  const [rows,setRows]=React.useState([]),[form,setForm]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('')
  const load=async()=>{try{setRows(await api('/api/staff-signatures'));setError('')}catch(e){setError(e.message)}}
  React.useEffect(()=>{load()},[])
  const nurses=employees.filter(e=>e.role==='Nurse'&&e.status==='Active')
  const open=row=>setForm(row?{...row,reason:'',expectedUpdatedAt:row.updatedAt}:{kind:'Doctor',name:'',employeeId:'',image:'',method:'',active:true,reason:''})
  const save=async()=>{if(!form.image||!form.method||(form.kind==='Doctor'&&!form.name.trim())||(form.kind==='Nurse'&&!form.employeeId)){setError('Select a signer and signature.');return}if(form.id&&!form.reason.trim()){setError('Enter a reason for the change.');return}setBusy(true);try{await api('/api/staff-signatures',{body:form});await load();setForm(null);notify('Staff signature saved.')}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <><Card title="Doctor and nurse signatures" action={<Button variant="secondary" onClick={()=>{setError('');open(null)}}>Add signature</Button>}><p className="card-note">Admin and Superadmin manage staff signatures. Nurses may also update their own in My profile. Confirm the signer has authorized use. Each clinical record keeps its own copy.</p>{error&&<p role="alert">{error}</p>}<Table columns={[{label:'NAME',key:'name'},{label:'ROLE',key:'kind'},{label:'BRANCH',render:r=>r.branch||'All branches'},{label:'STATUS',render:r=>r.active?'Active':'Disabled'},{label:'',render:r=><button className="table-link" onClick={()=>{setError('');open(r)}}>Manage →</button>}]} rows={rows} empty="No saved signatures."/></Card>{form&&<Modal title={form.id?'Manage staff signature':'Add staff signature'} onClose={()=>!busy&&setForm(null)} footer={<><Button variant="secondary" disabled={busy} onClick={()=>setForm(null)}>Cancel</Button><Button disabled={busy} onClick={save}>Save signature</Button></>}><Field label="Role" value={form.kind} options={['Doctor','Nurse']} disabled={!!form.id} onChange={e=>setForm({...form,kind:e.target.value,name:'',employeeId:''})}/>{form.kind==='Nurse'?<Field label="Nurse" value={form.employeeId||''} options={nurses.map(e=>[e.id,e.name+' · '+e.branch])} disabled={!!form.id} onChange={e=>setForm({...form,employeeId:e.target.value})}/>:<Field label="Doctor name" value={form.name} disabled={!!form.id} onChange={e=>setForm({...form,name:e.target.value})}/>}<SignaturePad allowUpload value={form.image} onChange={(image,method)=>setForm({...form,image,method})}/>{form.id&&<><Field label="Status" value={form.active?'Active':'Disabled'} options={['Active','Disabled']} onChange={e=>setForm({...form,active:e.target.value==='Active'})}/><Field label="Reason for change" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})} required/></>}{error&&<p role="alert">{error}</p>}</Modal>}</>
}
