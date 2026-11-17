const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const source = fs.readFileSync('lib/routes/clinical.ts', 'utf8')
const start = source.indexOf('function openBillLines(')
const end = source.indexOf('async function repairStaleOpenBills(', start)
assert(start >= 0 && end > start)
const js = ts.transpileModule(source.slice(start, end), {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
const packageJs=ts.transpileModule(fs.readFileSync('lib/philhealthPackage.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const packageExports={};new Function('exports','module',packageJs)(packageExports,{exports:packageExports})
const {openBillLines,needsOpenBillRewrite} = new Function('boosterServiceForBrand','isBoosterVaccineLine','PHILHEALTH_CATEGORY_III_PACKAGE',js+'; return {openBillLines,needsOpenBillRewrite}')(brand=>brand==='Speeda'?'Speeda':'Anti-rabies vaccine',service=>['Booster dose','Speeda','Anti-rabies vaccine','Not set yet'].includes(service),packageExports.PHILHEALTH_CATEGORY_III_PACKAGE)
const coreJs=ts.transpileModule(fs.readFileSync('lib/clinical.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText
const core={};new Function('exports',coreJs)(core)
assert.equal(core.visitNeedsPay({billing:'PhilHealth',preExp:true}),true)
assert.equal(core.visitNeedsPay({billing:'For PhilHealth',preExp:true}),true)
const encounter={billing:'PhilHealth',booster:false,preExp:false,category:'III',brand:'Bioshoot'}
for (const billing of ['PhilHealth','For PhilHealth','Walk-in']) {
  assert.deepEqual(openBillLines({...encounter,billing,preExp:true,category:''}).map(x=>[x.service,x.price,x.status]),[['Anti-rabies vaccine',750,'Pending']])
}
for (const billing of ['PhilHealth','For PhilHealth']) {
  const lines=openBillLines({...encounter,billing})
  assert.deepEqual(lines.map(x=>x.service),['Anti-rabies vaccine','Tetanus Toxoid','ERIG (serum)','Medical supplies'])
  assert(lines.every(x=>x.price===0&&x.status==='Not billed'))
  assert.equal(lines.reduce((sum,x)=>sum+x.claimValueCentavos,0),585000)
}
const walkIn=openBillLines({...encounter,billing:'Walk-in',category:'II'})
assert.deepEqual(walkIn.map(x=>[x.service,x.price,x.status]),[['Anti-rabies vaccine',750,'Pending']])
assert.equal(needsOpenBillRewrite(encounter,[{status:'Paid',amount:0,service:'Anti-rabies vaccine'}]),false)
assert.equal(needsOpenBillRewrite(encounter,[{status:'Paid',amount:750,service:'Anti-rabies vaccine'}]),false)
assert.equal(needsOpenBillRewrite(encounter,[{status:'Not billed',amount:0,service:'Anti-rabies vaccine'}]),true)
async function checkPaymentGuards() {
  const first=source.indexOf("clinicalRouter.post('/payments'")
  const last=source.indexOf("clinicalRouter.post('/referrals'",first)
  assert(first>=0&&last>first)
  const code=ts.transpileModule(source.slice(first,last),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
  let handler,encounter
  const names=['clinicalRouter','requirePage','prisma','servicingBranch','boosterServiceForBrand']
  const dependencies=[{post:(_path,_guard,fn)=>{handler=fn}},()=>()=>{}, {encounter:{findUnique:async()=>encounter}},()=> 'Guimba',()=> 'Anti-rabies vaccine']
  new Function(...names,code)(...dependencies)
  async function call(category,philhealth,classification,billing=classification,preExp=false){
    encounter={id:'e',branch:'Guimba',booster:false,preExp,category,billing,patient:{philhealth}}
    const result={statusCode:200,status(n){this.statusCode=n;return this},json(body){this.body=body;return this}}
    await handler({body:{encounterId:'e',classification},user:{allBranches:true}},result)
    return result
  }
  assert.equal((await call('II',true,'PhilHealth')).statusCode,400)
  assert.equal((await call('II',true,'For PhilHealth')).statusCode,400)
  assert.equal((await call('III',false,'PhilHealth')).statusCode,400)
  assert.equal((await call('III',true,'Walk-in','PhilHealth')).statusCode,400)
  assert.equal((await call('',true,'PhilHealth','PhilHealth',true)).statusCode,400)
  assert.equal((await call('',true,'For PhilHealth','For PhilHealth',true)).statusCode,400)
  assert.equal((await call('',true,'Walk-in','PhilHealth',true)).statusCode,409)
}
checkPaymentGuards().then(()=>console.log('Category II payment guards, membership validation, covered service lines, and paid record preservation: PASS')).catch(err=>{console.error(err);process.exitCode=1})
