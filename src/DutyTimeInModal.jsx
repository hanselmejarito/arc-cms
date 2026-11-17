import React from 'react'
import { api } from './api'
import { Button, Field, Modal } from './components'
import { branchShiftAvailable, dutyHours } from './data'

export default function DutyTimeInModal({selection,branchMaster,role,onChange,onConfirm,onClose}) {
  const [clock,setClock]=React.useState(null),[error,setError]=React.useState(''),[attempt,setAttempt]=React.useState(0),[submitting,setSubmitting]=React.useState(false)
  const base=React.useRef(null)
  React.useEffect(()=>{
    let live=true,sequence=0
    const sync=async()=>{const current=++sequence,start=performance.now();try{const result=await api('/api/clock',{cache:'no-store'});const end=performance.now(),epoch=Date.parse(result.serverTime);if(!Number.isFinite(epoch))throw Error('Invalid server time');if(live&&current===sequence){base.current={epoch,at:(start+end)/2};setClock(epoch+(end-start)/2);setError('')}}catch{if(live&&current===sequence){base.current=null;setClock(null);setError('Server time is unavailable. Check your connection and try again.')}}}
    const visible=()=>{if(document.visibilityState==='visible')sync()}
    sync();const tick=window.setInterval(()=>{if(base.current)setClock(base.current.epoch+performance.now()-base.current.at)},1000),resync=window.setInterval(sync,30000)
    document.addEventListener('visibilitychange',visible);window.addEventListener('focus',sync)
    return()=>{live=false;window.clearInterval(tick);window.clearInterval(resync);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',sync)}
  },[attempt])
  const serverDate=clock==null?'':new Date(clock).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})
  const options=serverDate?branchMaster.filter(b=>branchShiftAvailable(b,selection.kind,serverDate)):[]
  const valid=options.some(b=>b.name===selection.branch)
  const win=valid?dutyHours(role,selection.kind==='night'?'Night Shift':'Morning Shift',selection.branch,serverDate,branchMaster):null
  const confirm=async()=>{if(submitting)return;setSubmitting(true);try{await onConfirm()}finally{setSubmitting(false)}}
  return <Modal title={selection.kind==='night'?'Night duty branch':'Morning duty branch'} onClose={()=>!submitting&&onClose()} footer={<><Button variant="secondary" disabled={submitting} onClick={onClose}>Cancel</Button><Button disabled={submitting||clock==null||!valid} onClick={confirm}>Time In</Button></>}>
    <p className="card-note">Select the branch where you will work for this shift.</p>
    <Field label="Branch" value={selection.branch} options={options.map(b=>[b.name,b.name])} onChange={e=>onChange({...selection,branch:e.target.value})}/>
    {clock!=null&&<div className="detail-grid"><div><small>Current time · Philippines</small><strong>{new Date(clock).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true})}</strong></div><div><small>Shift</small><strong>{selection.kind==='night'?'Night':'Morning'}</strong></div><div><small>Schedule</small><strong>{win?.display||'Select a branch'}</strong></div><div><small>Break</small><strong>{selection.kind==='night'?'No unpaid break':'12:00 PM – 1:00 PM'}</strong></div></div>}
    {clock==null&&!error&&<p className="card-note">Loading server time…</p>}{error&&<><p role="alert">{error}</p><Button variant="secondary" onClick={()=>{setError('');setAttempt(n=>n+1)}}>Retry</Button></>}
    <p className="card-note">The server records the official Time In when you confirm.</p>
  </Modal>
}
