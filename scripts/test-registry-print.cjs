const fs=require('node:fs'),ts=require('typescript'),assert=require('node:assert/strict'),React=require('react')
const {renderToStaticMarkup}=require('react-dom/server')
const source=fs.readFileSync('src/RegistryPrintParts.jsx','utf8')
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText
const loaded={};new Function('exports','require',js)(loaded,require)
const rows=Array.from({length:9},(_,i)=>({id:'ID'+i,no:'REG-'+i,name:'Person '+i,date:'2026-11-26',animalCode:'C',rigDate:'2026-11-26',brand:'Bioshoot',remarks:'Remark-'+i}))
const html=renderToStaticMarkup(React.createElement(loaded.default,{rows,center:'Synthetic clinic',period:'2026 Q4'}))
assert.equal((html.match(/class="registry-print-part"/g)||[]).length,4)
assert.equal((html.match(/Part 1 of 2/g)||[]).length,2);assert.equal((html.match(/Part 2 of 2/g)||[]).length,2)
for(const group of ['History of Exposure','Post Exposure Prophylaxis (PEP)','Tissue Culture Vaccine (Date Given)','Outcome','Remarks']) assert.ok(html.includes(group),group)
for(let i=0;i<9;i++){assert.equal((html.match(new RegExp('REG-'+i,'g'))||[]).length,2);assert.match(html,new RegExp('Remark-'+i))}
assert.match(html,/Records 9–9/);assert.match(html,/bagong-pilipinas.png/);assert.match(html,/doh-seal.png/)
console.log('Registry print pairs, repeated identifiers and multiple batches: PASS')
