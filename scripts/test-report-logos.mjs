import {readFile,writeFile} from 'node:fs/promises'
import {buildReportXlsx} from '../src/xlsxExport.js'
const cell=text=>({tagName:'TH',textContent:text,colSpan:1,rowSpan:1,classList:{contains:()=>false},querySelector:()=>null})
const row={children:Array.from({length:26},(_,i)=>cell('Column '+i)),closest:()=>null}
const table={querySelectorAll:()=>[row],tHead:{rows:[row]}}
const logos=await Promise.all(['public/bagong-pilipinas.png','public/doh-seal.png'].map(async path=>new Uint8Array(await readFile(path))))
const blob=buildReportXlsx(table,['Republic of the Philippines','Department of Health','National Rabies Prevention and Control Program','Rabies Exposure Registry'],logos)
await writeFile('tmp/report-logo-test.xlsx',Buffer.from(await blob.arrayBuffer()))
console.log('Excel report generated with embedded logos')
