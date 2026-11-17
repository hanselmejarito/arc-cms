const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync('lib/philhealthPackage.ts', 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const exportsObject = {}
new Function('exports','module',code)(exportsObject,{exports:exportsObject})
const {PHILHEALTH_CATEGORY_III_PACKAGE: items,PHILHEALTH_PACKAGE_TOTAL_CENTAVOS:total,isPhilhealthCashFollowUp:followUp}=exportsObject
assert.equal(total,585000)
assert.deepEqual(items.map(x=>x.quantity*x.unitValueCentavos),[255000,30000,260000,40000])
for(const day of ['D14','D21','D28']) assert.equal(followUp(day),true)
for(const day of ['D0','D3','D7']) assert.equal(followUp(day),false)
const data=fs.readFileSync('src/data.js','utf8')
const groupedSource=data.slice(data.indexOf('export function lineService('),data.indexOf('export const visitNeedsPay='))
const groupedJs=ts.transpileModule(groupedSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
const groupedExports={};new Function('exports','module','servicePrice',groupedJs)(groupedExports,{exports:groupedExports},()=>750)
const bills=groupedExports.groupBills(items.map((item,index)=>({id:'p'+index,txn:'txn',service:item.service,classification:'PhilHealth',amount:0,status:'Not billed',quantity:item.quantity,claimValueCentavos:item.quantity*item.unitValueCentavos})))
assert.equal(bills.length,1);assert.equal(bills[0].amount,0);assert.equal(bills[0].claimValueCentavos,585000)
assert(bills[0].service.includes('Anti-rabies vaccine × 3'))
console.log('PhilHealth package valuation and covered/follow-up dose boundaries: PASS')
