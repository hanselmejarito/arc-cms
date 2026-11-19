import React from 'react'
import { formatTime12 } from './timeFormat'
import { api } from './api'
import { clinicDate, fmt } from './data'

// Schedule configuration is temporarily view-only. Saving other branch details
// must never create or change a schedule.
const BranchScheduleEditor = React.forwardRef(function BranchScheduleEditor({ branch, temporaryBranchEnabled = false }, ref) {
  const [history, setHistory] = React.useState([])
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  React.useImperativeHandle(ref, () => ({ schedule: () => undefined }), [])
  React.useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    api('/api/branches/' + encodeURIComponent(branch.name) + '/schedules')
      .then(rows => { if (live) setHistory(rows) })
      .catch(() => { if (live) setError('Unable to load the duty schedule. Please reopen this branch.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [branch.name])

  const date = clinicDate()
  const active = history.filter(row => row.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
  const future = history.filter(row => row.effectiveFrom > date).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
  const special = ['Muñoz', 'Palayan'].includes(branch.name)
  const earlyNurse = ['Guimba', 'Cabanatuan'].includes(branch.name)
  const fallback = { morningStart: '08:00', morningEnd: special ? '18:00' : '17:00', nurseStart: earlyNurse ? '07:00' : '08:00', nurseEnd: earlyNurse ? '16:00' : special ? '18:00' : '17:00', nightEnabled: !!branch.night, nightStart: '16:00', nightEnd: '23:00' }
  const displayed = temporaryBranchEnabled && active ? active : fallback
  const range = (start, end) => start && end ? formatTime12(start) + ' – ' + formatTime12(end) : 'Not configured'

  return <section>
    <h3>Duty schedule</h3>
    <p className="card-note">View only. Schedule changes are temporarily unavailable.</p>
    {loading ? <p className="card-note">Loading schedule…</p> : error ? <p role="alert">{error}</p> : <>
      <p className="card-note">{temporaryBranchEnabled && active ? 'Current saved schedule · effective ' + fmt(active.effectiveFrom) : 'Current built-in schedule · no active saved schedule applied.'}</p>
      <div className="detail-grid">
        <div><small>MORNING</small><strong>{range(displayed.morningStart, displayed.morningEnd)}</strong></div>
        <div><small>NURSE MORNING</small><strong>{range(displayed.nurseStart, displayed.nurseEnd)}</strong></div>
        <div><small>NIGHT SHIFT</small><strong>{displayed.nightEnabled ? range(displayed.nightStart, displayed.nightEnd) : 'Not enabled'}</strong></div>
      </div>
      {!temporaryBranchEnabled && active && <p className="card-note">A saved schedule exists, but schedule integration is not enabled; attendance and payroll use built-in rules.</p>}
      {future.length > 0 && <p className="card-note">A future schedule is saved for {fmt(future[0].effectiveFrom)}; it is not shown as the current schedule.</p>}
    </>}
  </section>
})

export default BranchScheduleEditor
