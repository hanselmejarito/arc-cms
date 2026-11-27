import React from 'react'

// Keep this list in the same order as the original aggregate table and export.
export const dohPrintColumns = [
  'Total population', 'Sex · Male', 'Sex · Female', 'Sex · Total', 'Age · <15', 'Age · >15', 'Age · Total',
  'Category I', 'Category II · Primary eligible', 'Category II · Booster eligible', 'Category II · Total eligible',
  'Category II · Non-eligible', 'Category II · Total', 'Category III · Primary eligible', 'Category III · Booster eligible',
  'Category III · Total eligible', 'Category III · Non-eligible', 'Category III · Total', 'Total PEP eligible', 'Total cases',
  'PEP completed II · Primary', 'PEP completed II · Booster', 'PEP completed III · ERIG', 'PEP completed III · HRIG',
  'PEP completed III · Primary total', 'PEP completed III · Booster', 'Coverage II · Primary', 'Coverage II · Booster',
  'Coverage III · Primary', 'Coverage III · Booster', 'Coverage · Total', 'Animal · Dog', 'Animal · Cat', 'Animal · Others',
  'Animal · Pet / domestic', 'Animal · Stray / free-roaming', 'Animal · Unknown', 'Animal · Total', 'Human rabies · Cases', 'Human rabies · Incidence proportion'
]

function PrintHeader({part}) {
  return part===0 ? <thead>
    <tr><th rowSpan={4}>Location (Municipality/City)</th><th rowSpan={4}>Total population</th><th colSpan={3} rowSpan={2}>Sex</th><th colSpan={3} rowSpan={2}>Age</th><th colSpan={13}>Animal Bite Cases</th></tr>
    <tr><th rowSpan={3}>Category I</th><th colSpan={5}>Category II</th><th colSpan={5}>Category III</th><th rowSpan={3}>Total PEP eligible</th><th rowSpan={3}>Total cases</th></tr>
    <tr><th rowSpan={2}>Male</th><th rowSpan={2}>Female</th><th rowSpan={2}>Total</th><th rowSpan={2}>&lt;15</th><th rowSpan={2}>&gt;15</th><th rowSpan={2}>Total</th><th colSpan={3}>PEP eligible</th><th rowSpan={2}>Non-eligible</th><th rowSpan={2}>Total</th><th colSpan={3}>PEP eligible</th><th rowSpan={2}>Non-eligible</th><th rowSpan={2}>Total</th></tr>
    <tr><th>Primary (CCEEV)</th><th>Booster (CCEEV)</th><th>Total (3)</th><th>Primary (CCEEV+RIG)</th><th>Booster (CCEEV only)</th><th>Total</th></tr>
  </thead> : <thead>
    <tr><th colSpan={11}>Post-Exposure Prophylaxis (PEP)</th><th colSpan={7}>Biting Animals</th><th colSpan={2} rowSpan={2}>Human Rabies Cases</th></tr>
    <tr><th colSpan={6}>PEP Completed</th><th colSpan={5}>PEP Coverage</th><th colSpan={3}>Type</th><th colSpan={3}>Status</th><th rowSpan={3}>Total</th></tr>
    <tr><th colSpan={2}>Category II</th><th colSpan={4}>Category III</th><th colSpan={2}>Category II</th><th colSpan={2}>Category III</th><th rowSpan={2}>Total CCEEV</th><th rowSpan={2}>Dog</th><th rowSpan={2}>Cat</th><th rowSpan={2}>Others</th><th rowSpan={2}>Pet / Domestic</th><th rowSpan={2}>Stray / Free-roaming</th><th rowSpan={2}>Unknown</th><th rowSpan={2}>Cases</th><th rowSpan={2}>Incidence proportion</th></tr>
    <tr><th>Primary (CCEEV)</th><th>Booster (CCEEV)</th><th>ERIG</th><th>HRIG</th><th>Primary total</th><th>Booster (CCEEV only)</th><th>Primary</th><th>Booster</th><th>Primary (CCEEV+RIG)</th><th>Booster (CCEEV only)</th></tr>
  </thead>
}

export default function DohPrintParts({ rows, totals, region, period, branch, valuesFor }) {
  const parts = Array.from({ length: 2 }, (_, part) => ({ start: part * 20, columns: dohPrintColumns.slice(part * 20, part * 20 + 20) }))
  return <div className="doh-print-parts" aria-hidden="true">{parts.map((part, index) => <section className="doh-print-part" key={part.start}>
    <header className="doh-print-head"><img className="report-print-logo" src="/bagong-pilipinas.png" alt="Bagong Pilipinas"/><div><div>REPUBLIC OF THE PHILIPPINES</div><strong>DEPARTMENT OF HEALTH</strong><div>National Rabies Prevention and Control Program</div><h3>Animal Bite and Rabies Report · Part {index + 1} of {parts.length}</h3><div>Region: {region} · Period: {period} · Branch: {branch}</div></div><img className="report-print-logo" src="/doh-seal.png" alt="Department of Health"/></header>
    <p className="doh-print-note">Match the municipality rows by their order and period across both parts. Green cells on screen are computed; verify totals against the approved report.</p>
    <table className={'doh-part-table doh-part-table-'+index}><PrintHeader part={index}/>
      <tbody>{rows.map(row => { const values = valuesFor(row); return <tr key={row.name}>{index===0&&<th scope="row">{row.name.toUpperCase()}</th>}{part.columns.map((_, i) => <td key={part.start+i}>{values[part.start+i] ?? ''}</td>)}</tr> })}</tbody>
      <tfoot><tr>{index===0&&<th scope="row">TOTAL</th>}{part.columns.map((_, i) => <td key={part.start+i}>{totals[part.start+i] ?? ''}</td>)}</tr></tfoot>
    </table>
  </section>)}</div>
}
