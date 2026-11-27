import React from 'react'
import { registryDoseLabel } from './registryDose'

const date=d=>d?d.slice(5,7)+'/'+d.slice(8,10)+'/'+d.slice(2,4):''
const columns=[
 [['Birthday',r=>date(r.birthday)],['Address',r=>r.address],['Age',r=>r.age],['Sex',r=>r.sex],['Exposure date',r=>date(r.expDate)],['Place',r=>r.place],['Animal',r=>r.animalCode],['B / NB',r=>r.type],['Site',r=>r.site],['Category',r=>r.category],['Washed',r=>r.washed]],
 [['RIG date',r=>date(r.rigDate)],['Route',r=>r.route],['Day 0',r=>registryDoseLabel(r.d0,r.doseBranches?.d0,r.e?.branch)],['Day 3',r=>registryDoseLabel(r.d3,r.doseBranches?.d3,r.e?.branch)],['Day 7',r=>registryDoseLabel(r.d7,r.doseBranches?.d7,r.e?.branch)],['Day 14',r=>registryDoseLabel(r.d14,r.doseBranches?.d14,r.e?.branch)],['Day 21/28',r=>registryDoseLabel(r.d28,r.doseBranches?.d28,r.e?.branch)],['Brand',r=>r.brand],['Outcome',r=>r.outcome],['PrEP / Booster',r=>r.prep],['Animal status after 14 days',r=>r.animal14],['Remarks',r=>r.remarks]]
]

const columnWeights = [
 [10,7,14,7,13,4,4,7,8,5,5,9,5,5],
 [8,5,7,7,7,7,7,9,6,8,13,16]
]

// Reserve the same conservative row height on both sheets, accounting for
// wrapping in either part. The print table uses a fixed-width 13-inch sheet.
function lineCount(value, capacity){
 let lines=1, used=0
 for(const word of String(value??'').split(/\s+/).filter(Boolean)){
  if(used && used+1+word.length<=capacity){used+=1+word.length;continue}
  if(used){lines++;used=0}
  while(word.length-used>capacity){lines++;used+=capacity}
  used=word.length-used
 }
 return lines
}
function pairedRowHeight(row){
 const values=[[row.no,date(row.date),row.name,...columns[0].map(([,get])=>get(row))],columns[1].map(([,get])=>get(row))]
 let lines=1
 values.forEach((part,index)=>{const weights=columnWeights[index],total=weights.reduce((sum,n)=>sum+n,0);part.forEach((value,i)=>{const width=1120*weights[i]/total;lines=Math.max(lines,lineCount(value,Math.max(1,Math.floor((width-10)/8))))})})
 return Math.max(24,lines*13+8)
}

function RegistryPrintHeader({part}){
 return part===0 ? <thead>
  <tr><th colSpan={2}>Registration</th><th rowSpan={2}>Name of patient</th><th rowSpan={2}>Birthday</th><th rowSpan={2}>Address</th><th rowSpan={2}>Age</th><th rowSpan={2}>Sex</th><th colSpan={5}>History of Exposure</th><th colSpan={2}>Post Exposure Prophylaxis (PEP)</th></tr>
  <tr><th>No.</th><th>Date</th><th>Date</th><th>Place (where biting occurred)</th><th>Type of animal</th><th>Type (B/NB)</th><th>Site (body parts)</th><th>Category (1, 2 and 3)</th><th>Washing of bite (Y/N)</th></tr>
 </thead> : <thead>
  <tr><th colSpan={8}>Post Exposure Prophylaxis (PEP)</th><th rowSpan={2}>Outcome</th><th rowSpan={3}>PrEP / Booster</th><th rowSpan={3}>Biting animal status after 14 days (Alive/Dead/Lost)</th><th rowSpan={3}>Remarks</th></tr>
  <tr><th rowSpan={2}>RIG date given</th><th colSpan={7}>Tissue Culture Vaccine (Date Given)</th></tr>
  <tr><th>Route</th><th>D0</th><th>D3</th><th>D7</th><th>D14 (IM)</th><th>D28</th><th>Brand name</th><th>C/Inc/N/D</th></tr>
 </thead>
}

export default function RegistryPrintParts({rows,center,period}){
 const batches=[]
 let batch=[],height=0,start=0
 for(const row of rows){const rowHeight=pairedRowHeight(row);if(batch.length&&(batch.length>=8||height+rowHeight>410)){batches.push({rows:batch,start});start+=batch.length;batch=[];height=0}batch.push(row);height+=rowHeight}
 if(batch.length)batches.push({rows:batch,start})
 return <div className="registry-print-parts" aria-hidden="true">{batches.flatMap((batchInfo,batchIndex)=>columns.map((part,partIndex)=><section className="registry-print-part" key={batchIndex+'-'+partIndex}>
  <header className="registry-print-head"><img src="/bagong-pilipinas.png" alt="Bagong Pilipinas"/><div><strong>Department of Health</strong><div>National Rabies Prevention and Control Program</div><h3>Rabies Exposure Registry</h3><div>{center} · {period}</div><b>Part {partIndex+1} of 2 · Records {batchInfo.start+1}–{batchInfo.start+batchInfo.rows.length}</b></div><img src="/doh-seal.png" alt="Department of Health"/></header>
  <p className="registry-print-note">Match both parts using the record range and row order.</p>
  <table className={'registry-print-table registry-print-table-'+partIndex}><colgroup>{columnWeights[partIndex].map((weight,i)=><col key={i} style={{width:(weight/columnWeights[partIndex].reduce((sum,n)=>sum+n,0)*100)+'%'}}/>)}</colgroup><RegistryPrintHeader part={partIndex}/><tbody>{batchInfo.rows.map(r=><tr key={r.id} style={{height:pairedRowHeight(r)+'px'}}>{partIndex===0&&<><td>{r.no||''}</td><td>{date(r.date)}</td><td>{r.name||''}</td></>}{part.map(([label,value])=><td key={label}>{value(r)??''}</td>)}</tr>)}</tbody></table>
  <div className="registry-print-legend">Animal: PD = pet dog; SD = stray dog; C = cat; O = others. Type: B = bite; NB = non-bite. Outcome: C = complete; Inc = incomplete; N = none; D = died.</div>
 </section>))}</div>
}
