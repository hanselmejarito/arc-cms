import React from 'react'
import { api } from './api'
import { Button, Field, Modal } from './components'
import { branchShiftAvailable } from './data'

export default function BranchCorrection({attendance,branchMaster,onClose,onSaved,notify}) {
  const eligible=attendance.filter(r=>r.in||r.nightIn)
  const [id,setId]=React.useState(eligible[0]?.id||'')
  const [shift,setShift]=React.useState('morning'),[target,setTarget]=React.useState(''),[reason,setReason]=React.useState(''),[busy,setBusy]=React.useState(false)
  const row=eligible.find(r=>r.id===id), original=shift==='morning'?row?.branch:(row?.nightBranch||row?.branch)
  const options=branchMaster.filter(b=>branchShiftAvailable(b,shift,row?.date||''))
  const save=async()=>{if(!row||!target||!reason.trim()){notify('Select a branch and enter a reason.','error');return}setBusy(true);try{const result=await api('/api/attendance/correct-branch',{body:{userId:row.userId,date:row.date,shift,branch:target,expectedBranch:original,reason:reason.trim()}});onSaved(result);try{localStorage.setItem('arc-duty-change',String(Date.now()))}catch{}notify('Attendance branch correction saved.','Attendance');onClose()}catch(err){notify(err.message,'error')}finally{setBusy(false)}}
  return <Modal title="Correct duty branch" onClose={()=>!busy&&onClose()} footer={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={save}>Save correction</Button></>}><p className="card-note">Patient and treatment records are not moved. Review them separately.</p><Field label="Attendance record" value={id} options={eligible.map(r=>[r.id,(r.userName||'Staff')+' · '+r.date])} onChange={e=>{setId(e.target.value);setTarget('')}}/><Field label="Duty" value={shift} options={[["morning","Morning"],["night","Night"]]} onChange={e=>{setShift(e.target.value);setTarget('')}}/><Field label="Current branch" value={original||'—'} disabled/><Field label="Correct branch" value={target} options={options.map(b=>[b.name,b.name])} onChange={e=>setTarget(e.target.value)}/><Field label="Reason" value={reason} onChange={e=>setReason(e.target.value)} type="textarea"/></Modal>
}
