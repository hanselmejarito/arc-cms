import React from 'react'

const date=d=>d?d.slice(5,7)+'/'+d.slice(8,10)+'/'+d.slice(2,4):''
const columns=[
 [['Birthday',r=>date(r.birthday)],['Address',r=>r.address],['Age',r=>r.age],['Sex',r=>r.sex],['Exposure date',r=>date(r.expDate)],['Place',r=>r.place],['Animal',r=>r.animalCode],['B / NB',r=>r.type],['Site',r=>r.site],['Category',r=>r.category],['Washed',r=>r.washed]],
 [['RIG date',r=>date(r.rigDate)],['Route',r=>r.route],['Day 0',r=>date(r.d0)],['Day 3',r=>date(r.d3)],['Day 7',r=>date(r.d7)],['Day 14',r=>date(r.d14)],['Day 21/28',r=>date(r.d28)],['Brand',r=>r.brand],['Outcome',r=>r.outcome],['PrEP / Booster',r=>r.prep],['Animal status after 14 days',r=>r.animal14],['Remarks',r=>r.remarks]]
]

function RegistryPrintHeader({part}){
 return part===0 ? <thead>
  <tr><th colSpan={2}>Registration</th><th rowSpan={2}>Name of patient</th><th rowSpan={2}>Birthday</th><th rowSpan={2}>Address</th><th rowSpan={2}>Age</th><th rowSpan={2}>Sex</th><th colSpan={5}>History of Exposure</th><th colSpan={2}>Post Exposure Prophylaxis (PEP)</th></tr>
  <tr><th>No.</th><th>Date</th><th>Date</th><th>Place (where biting occurred)</th><th>Type of animal</th><th>Type (B/NB)</th><th>Site (body parts)</th><th>Category (1, 2 and 3)</th><th>Washing of bite (Y/N)</th></tr>
 </thead> : <thead>
  <tr><th rowSpan={3}>Registry no.</th><th rowSpan={3}>Name of patient</th><th colSpan={8}>Post Exposure Prophylaxis (PEP)</th><th rowSpan={2}>Outcome</th><th rowSpan={3}>PrEP / Booster</th><th rowSpan={3}>Biting animal status after 14 days (Alive/Dead/Lost)</th><th rowSpan={3}>Remarks</th></tr>
  <tr><th rowSpan={2}>RIG date given</th><th colSpan={7}>Tissue Culture Vaccine (Date Given)</th></tr>
  <tr><th>Route</th><th>D0</th><th>D3</th><th>D7</th><th>D14 (IM)</th><th>D28</th><th>Brand name</th><th>C/Inc/N/D</th></tr>
 </thead>
}

export default function RegistryPrintParts({rows,center,period}){
 const batches=[]
 for(let i=0;i<rows.length;i+=8)batches.push(rows.slice(i,i+8))
 return <div className="registry-print-parts" aria-hidden="true">{batches.flatMap((batch,batchIndex)=>columns.map((part,partIndex)=><section className="registry-print-part" key={batchIndex+'-'+partIndex}>
  <header className="registry-print-head"><img src="/bagong-pilipinas.png" alt="Bagong Pilipinas"/><div><strong>Department of Health</strong><div>National Rabies Prevention and Control Program</div><h3>Rabies Exposure Registry</h3><div>{center} · {period}</div><b>Part {partIndex+1} of 2 · Records {batchIndex*8+1}–{batchIndex*8+batch.length}</b></div><img src="/doh-seal.png" alt="Department of Health"/></header>
  <p className="registry-print-note">Match both parts using the registry number and record range.</p>
  <table className={'registry-print-table registry-print-table-'+partIndex}><colgroup><col style={{width:'11%'}}/>{partIndex===0&&<col style={{width:'7%'}}/>}<col style={{width:'13%'}}/>{part.map(([label])=><col key={label}/>)}</colgroup><RegistryPrintHeader part={partIndex}/><tbody>{batch.map(r=><tr key={r.id}><td>{r.no||''}</td>{partIndex===0&&<td>{date(r.date)}</td>}<td>{r.name||''}</td>{part.map(([label,value])=><td key={label}>{value(r)??''}</td>)}</tr>)}</tbody></table>
  <div className="registry-print-legend">Animal: PD = pet dog; SD = stray dog; C = cat; O = others. Type: B = bite; NB = non-bite. Outcome: C = complete; Inc = incomplete; N = none; D = died.</div>
 </section>))}</div>
}
