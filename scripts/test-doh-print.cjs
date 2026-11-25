const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const source = fs.readFileSync('src/DohPrintParts.jsx', 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText
const loaded = {}
new Function('exports','require',js)(loaded, id => id === './components' ? { BrandLogo: () => React.createElement('img', {src:'/arc-mark.png',alt:'ARC'}) } : require(id))
assert.equal(loaded.dohPrintColumns.length, 40)
const markerValues = Array.from({length:40},(_,i)=>'VALUE'+i)
const totalValues = Array.from({length:40},(_,i)=>'TOTAL'+i)
const html = renderToStaticMarkup(React.createElement(loaded.default,{rows:[{name:'Synthetic Municipality'}],totals:totalValues,region:'Test region',period:'Test period',branch:'Test branch',valuesFor:()=>markerValues}))
assert.equal((html.match(/Part [1-2] of 2/g)||[]).length,2)
assert.equal((html.match(/SYNTHETIC MUNICIPALITY/g)||[]).length,2)
for(const group of ['Animal Bite Cases','Post-Exposure Prophylaxis (PEP)','Biting Animals','PEP Completed','PEP Coverage','Human Rabies Cases']) assert.ok(html.includes(group),group)
for(const value of [...markerValues,...totalValues]) assert.equal((html.match(new RegExp('>'+value+'<','g'))||[]).length,1,value)
assert.equal((html.match(/bagong-pilipinas\.png/g)||[]).length,2)
assert.equal((html.match(/doh-seal\.png/g)||[]).length,2)
assert.doesNotMatch(html,/arc-mark\.png/)

async function checkExcel() {
  const { buildReportXlsx } = await import('../src/xlsxExport.js')
  const cells = Array.from({length:41},(_,i)=>({colSpan:1,rowSpan:1,tagName:'TD',textContent:'COLUMN-'+i,classList:{contains:()=>false},querySelector:()=>null}))
  const row={children:cells,closest:()=>null}
  const blob=buildReportXlsx({querySelectorAll:()=>[row],tHead:{rows:[]}},['Synthetic report'])
  const zip=Buffer.from(await blob.arrayBuffer()).toString('utf8')
  assert.ok(zip.includes('COLUMN-0'))
  assert.ok(zip.includes('COLUMN-40'))
  assert.ok(zip.includes('r="AO3"'))
  console.log('Two print parts, full values, logos and 41-column Excel: PASS')
}
checkExcel().catch(e=>{console.error(e);process.exitCode=1})
