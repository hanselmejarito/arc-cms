import React from 'react'
import { BrandLogo } from '../components'
import { addDays, fmt, money, periodInputsFromAttendance } from '../data'

const datesFor = period => {
  const dates=[]
  for(let day=period.from;day<=period.to;day=addDays(day,1))dates.push(day)
  return dates
}
function branchGroups(rows){const groups=new Map();for(const row of rows){const group=groups.get(row.branch)||[];group.push(row);groups.set(row.branch,group)}return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b))}
function Header({branch,period,title}){return <header className="hr-sheet-header"><span className="arc-form-logo"><BrandLogo/></span><div><strong>ARC ANTI-RABIES VACCINE CLINIC</strong><span>{branch} branch</span><b>{title}</b><span>{fmt(period.from)} – {fmt(period.to)}</span></div></header>}
function Signatories(){return <div className="hr-signatories">{['Prepared by','Checked by','Approved by'].map(label=><div key={label}><span>{label}:</span><i/><small>Signature over printed name</small></div>)}</div>}
export function AttendancePrint({employees,attendance,users,period,overtimeRequests}){
 const days=datesFor(period),userEmployee=new Map((users||[]).map(u=>[u.id,u.employeeId||u.employee]))
 return <div className="hr-print-document">{branchGroups(employees).map(([branch,staff])=><section className="hr-sheet" key={branch}><Header branch={branch} period={period} title="ATTENDANCE SUMMARY OF EMPLOYEES"/>
 <table className="hr-table hr-attendance-table"><thead><tr><th>Employee</th>{days.map(day=><th key={day}>{Number(day.slice(8,10))}</th>)}<th>Recorded days</th><th>Review</th></tr></thead><tbody>{staff.map(e=>{
  const records=attendance.filter(r=>r.date>=period.from&&r.date<=period.to&&r.branch===branch&&(r.employeeId===e.id||userEmployee.get(r.userId)===e.id))
  const review=periodInputsFromAttendance(e,period.id,records,users,overtimeRequests).needsReview||[]
  let count=0,issues=0
  const marks=days.map(day=>{const rows=records.filter(r=>r.date===day);if(!rows.length)return '—';const needs=rows.some(r=>(!!r.in!==!!r.out)||(!!r.nightIn!==!!r.nightOut))||review.some(r=>r===day||r.startsWith(day+' '));if(needs){issues++;return '?'}const base=rows.some(r=>r.in&&r.out),night=rows.some(r=>r.nightIn&&r.nightOut);if(base||night){count++;return base&&night?'2':'P'}return '?'})
  return <tr key={e.id}><td className="hr-name">{e.name}</td>{marks.map((mark,i)=><td key={days[i]}>{mark}</td>)}<td>{count}</td><td>{issues||'—'}</td></tr>
 })}</tbody></table><p className="hr-legend">P = completed time in/out · 2 = completed morning and night shifts · ? = needs review · — = no recorded attendance; not automatically absent. Days with ? are excluded from recorded-day totals.</p><Signatories/></section>)}</div>
}
export function PayrollPrint({rows,period}){
 return <div className="hr-print-document">{branchGroups(rows).map(([branch,staff])=><section className="hr-sheet" key={branch}><Header branch={branch} period={period} title="PAYROLL REGISTER"/>
 <p className="hr-legend">Based on saved payroll inputs and recorded attendance. Amounts are for review; signatures below are handwritten.</p>
 <table className="hr-table hr-payroll-table"><thead><tr><th>Employee</th><th>Days</th><th>Night shifts</th><th>Basic</th><th>OT</th><th>Night diff.</th><th>Holiday</th><th>Allowance</th><th>Gross</th><th>Late / UT</th><th>SSS</th><th>PhilHealth</th><th>Pag-IBIG</th><th>Other</th><th>Net</th><th>Signature</th></tr></thead><tbody>{staff.map(r=><tr key={r.id}><td className="hr-name">{r.name}</td><td>{r.c.calendarDays}</td><td>{r.c.nightShiftDays}</td>{[r.c.basic,r.c.otPay,r.c.nightPay,r.c.holidayPay,r.c.allowance,r.c.gross,r.c.lateDed+r.c.underDed,r.c.sss,r.c.phil,r.c.pagibig,r.c.other,r.c.net].map((n,i)=><td key={i} className="hr-amount">{money(n)}</td>)}<td/></tr>)}</tbody><tfoot><tr><th>Total</th><th/><th/>{['basic','otPay','nightPay','holidayPay','allowance','gross'].map(key=><th key={key}>{money(staff.reduce((a,r)=>a+r.c[key],0))}</th>)}<th>{money(staff.reduce((a,r)=>a+r.c.lateDed+r.c.underDed,0))}</th>{['sss','phil','pagibig','other','net'].map(key=><th key={key}>{money(staff.reduce((a,r)=>a+r.c[key],0))}</th>)}<th/></tr></tfoot></table><Signatories/></section>)}</div>
}
export function printHrDocument(id){
 const source=document.getElementById(id)
 if(!source)return
 const host=document.createElement('div');host.className='hr-print-host';const clone=source.cloneNode(true);clone.removeAttribute('id');clone.classList.remove('hr-print-source');host.appendChild(clone);document.body.appendChild(host)
 const root=document.documentElement;root.classList.add('print-hr')
 const style=document.createElement('style');style.textContent='@media print{@page{size:A4 landscape;margin:7mm}}';document.head.appendChild(style)
 const clear=()=>{root.classList.remove('print-hr');host.remove();style.remove();window.removeEventListener('afterprint',clear)}
 window.addEventListener('afterprint',clear);window.setTimeout(clear,120000);window.setTimeout(()=>window.print(),100)
}
