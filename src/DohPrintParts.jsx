import React from 'react'
import { BrandLogo } from './components'

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

export default function DohPrintParts({ rows, totals, region, period, branch, valuesFor }) {
  const parts = Array.from({ length: 4 }, (_, part) => ({ start: part * 10, columns: dohPrintColumns.slice(part * 10, part * 10 + 10) }))
  return <div className="doh-print-parts" aria-hidden="true">{parts.map((part, index) => <section className="doh-print-part" key={part.start}>
    <header className="doh-print-head"><span className="arc-form-logo"><BrandLogo/></span><div><strong>DEPARTMENT OF HEALTH</strong><div>National Rabies Prevention and Control Program</div><h3>Animal Bite and Rabies Report · Part {index + 1} of {parts.length}</h3><div>Region: {region} · Period: {period} · Branch: {branch}</div></div></header>
    <p className="doh-print-note">Match the municipality and period across all parts. Green cells on screen are computed; verify totals against the approved report.</p>
    <table className="doh-part-table"><thead><tr><th>Location (Municipality/City)</th>{part.columns.map((name, i) => <th key={part.start+i}>{name}</th>)}</tr></thead>
      <tbody>{rows.map(row => { const values = valuesFor(row); return <tr key={row.name}><th scope="row">{row.name.toUpperCase()}</th>{part.columns.map((_, i) => <td key={part.start+i}>{values[part.start+i] ?? ''}</td>)}</tr> })}</tbody>
      <tfoot><tr><th scope="row">TOTAL</th>{part.columns.map((_, i) => <td key={part.start+i}>{totals[part.start+i] ?? ''}</td>)}</tr></tfoot>
    </table>
  </section>)}</div>
}
