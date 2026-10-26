import { writeFile } from 'node:fs/promises'
import { buildReportXlsx } from '../src/xlsxExport.js'
const cell = (tagName, textContent, colSpan = 1, rowSpan = 1, classes = []) => ({tagName, textContent, colSpan, rowSpan, classList:{contains:name=>classes.includes(name)}, querySelector:()=>null, closest:()=>null})
const header = {children:[cell('TH','LOCATION',1,2), cell('TH','Sex',2,1)]}
const subheader = {children:[cell('TH','Male'), cell('TH','Female')]}
const data = {children:[cell('TD','GUIMBA'), cell('TD','3',1,1,['num']), cell('TD','2',1,1,['num'])]}
for (const row of [header,subheader,data]) row.closest = () => null
const table = {querySelectorAll:()=>[header,subheader,data], tHead:{rows:[header,subheader]}}
const blob = buildReportXlsx(table, ['REPUBLIC OF THE PHILIPPINES','DEPARTMENT OF HEALTH','National Rabies Prevention and Control Program','Animal Bite and Rabies Report Form','Region III · 2026 Q4'])
await writeFile('/tmp/arc-report-check.xlsx', Buffer.from(await blob.arrayBuffer()))
