// Local-only integration smoke test. All synthetic records are rolled back.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { PrismaClient } = require('@prisma/client')

function load(file, dependencies) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const exports = {}
  new Function('require', 'exports', 'module', js)(name => name in dependencies ? dependencies[name] : require(name), exports, { exports })
  return exports
}
async function main() {
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    if (!process.env[key] || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env[key]).hostname))
      throw new Error('This smoke test requires a verified local database.')
  }
  const router = load(path.join('lib','router.ts'), {})
  const domain = load(path.join('lib','otherTreatment.ts'), {})
  const prisma = new PrismaClient({ log: [] })
  const tag = 'ot-test-' + randomUUID()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
  const guard = page => Object.assign(() => {}, { _guard: { auth: true, ...(page ? { page } : {}) } })
  const auth = { requireAuth: guard(), requirePage: guard, requireAny: () => guard(), canAccessBranch: (u,b) => u.allBranches || u.branchName === b }
  const clinical = { BRANCH_CODES: { Guimba:'GUI' }, clinicDate: () => today, clinicTime: () => '23:00', canPage: () => true,
    ALL_BRANCH_ROLES: ['Admin','Superadmin'], refundEligible: () => true,
    refundRemaining: (cap, rows) => cap - rows.reduce((sum, x) => sum + Number(x.amount), 0) }
  const map = new Proxy({}, { get: () => x => x })
  try {
    try {
      await prisma.$transaction(async tx => {
        const db = new Proxy(tx, { get: (obj,key) => key === '$transaction' ? async fn => {
          await tx.$executeRawUnsafe('SAVEPOINT synthetic_route')
          try {
            const result = await fn(tx)
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT synthetic_route')
            return result
          } catch (error) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT synthetic_route')
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT synthetic_route')
            throw error
          }
        } : obj[key] })
        await tx.user.create({ data: { id:tag, name:'Synthetic Staff', email:tag+'@example.invalid', passwordHash:'synthetic', role:'Admin' } })
        await tx.patient.create({ data: { id:tag, first:'Synthetic', last:'Patient', name:'Synthetic Patient', birthday:'1990-01-01', sex:'Male', branch:'Guimba' } })
        if (!await tx.branch.findUnique({ where: { name:'Guimba' } })) throw new Error('Test branch unavailable.')
        for (const item of ['Flu','Tetanus Toxoid','Hepatitis B','ERIG (serum)']) {
          await tx.inventoryLine.create({ data: { id:tag+item, item, type:'Test', branch:'Guimba', batch:tag,
            expiry:'2099-12-31', stock:3, begin:3, date:today, shift:'MS', unit:'vials' } })
        }
        const deps = { '../router.js':router, '../auth.js':auth, '../prisma.js':{prisma:db}, '../clinical.js':clinical,
          '../otherTreatment.js':domain, '../shiftClose.js':{catchUpBranch:async()=>{}}, '../map.js':map,
          '../inventory.js':{ITEM_NAMES:['Flu'],ADJUST_REASONS:['Correction'],itemMeta:()=>({})},
          '../ids.js':{nextId:async()=>tag}, '../audit.js':{audit:async()=>({})} }
        const other = load(path.join('lib','routes','otherTreatments.ts'), deps).otherTreatmentsRouter.routes
        const ops = load(path.join('lib','routes','ops.ts'), deps).opsRouter.routes
        const user = { id:tag, name:'Synthetic Staff', role:'Admin', allBranches:true, branchName:null }
        async function call(routes, method, routePath, params={}, body={}, actor=user) {
          const route = routes.find(x => x.method === method && x.path === routePath)
          assert(route, 'Missing route: '+routePath)
          const res = router.createRes()
          await route.handler({ params, body, query:{}, user:actor, userAgent:'synthetic test' }, res)
          return res
        }
        const create = async service => {
          const res = await call(other,'POST','/other-treatments',{}, {patientId:tag,branch:'Guimba',service})
          assert.equal(res.statusCode,200); return res.body
        }
        const give = async (row,item,stockQuantity=1) => call(other,'POST','/other-treatments/:id/give',{id:row.id},
          {stockLineId:tag+item,stockQuantity,brand:'Synthetic Brand',administeredBy:'Synthetic Staff',administeredQuantity:0.5,administeredUnit:'mL'})
        const pay = async row => call(other,'POST','/other-treatments/:id/payment',{id:row.id},
          {amountCentavos:150000,method:'Cash',externalReference:'synthetic'})
        const a = await create('Flu')
        assert.match(a.reference,/^OT-GUI-\d{2}-\d+$/)
        let res = await pay(a); assert.equal(res.statusCode,200)
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'Flu'}})).stock,3)
        assert.equal((await tx.otherTreatment.findUniqueOrThrow({where:{id:a.id}})).status,'Pending')
        res = await give(a,'Flu'); assert.equal(res.statusCode,200)
        assert.equal(res.body.treatment.brand,'Synthetic Brand')
        assert.equal(res.body.treatment.stockExpiry,'2099-12-31')
        assert.equal(res.body.treatment.administeredQuantity,0.5)
        assert.equal(res.body.treatment.administeredUnit,'mL')
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'Flu'}})).stock,2)
        assert.equal((await give(a,'Flu')).statusCode,409)
        assert.equal((await pay(a)).statusCode,409)

        const t = await create('TT')
        assert.equal((await give(t,'Tetanus Toxoid')).statusCode,200)
        assert.equal(await tx.otherTreatmentPayment.findUnique({where:{treatmentId:t.id}}),null)
        assert.equal((await pay(t)).statusCode,200)
        const h = await create('Hepatitis B')
        assert.equal((await give(h,'Hepatitis B',2)).statusCode,400)
        assert.equal((await give(h,'Hepatitis B')).statusCode,200)
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'Hepatitis B'}})).stock,2)

        const erig = await create('ERIG')
        assert.equal((await give(erig,'ERIG (serum)',4)).statusCode,409)
        assert.equal((await tx.otherTreatment.findUniqueOrThrow({where:{id:erig.id}})).status,'Pending')
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'ERIG (serum)'}})).stock,3)
        assert.equal((await give(erig,'ERIG (serum)',2)).statusCode,200)
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'ERIG (serum)'}})).stock,1)

        const c = await create('Flu')
        res = await pay(c); const paymentId = res.body.payment.id
        res = await call(other,'POST','/other-treatments/:id/cancel',{id:c.id},{reason:'Synthetic cancellation'})
        assert.equal(res.statusCode,200); assert(res.body.payment)
        assert.equal((await give(c,'Flu')).statusCode,409)
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'Flu'}})).stock,2)
        res = await call(ops,'POST','/refunds',{}, {payment:paymentId,amount:1500,reason:'Synthetic cancellation'})
        assert.equal(res.statusCode,200); const refundId=res.body.id
        assert.equal((await call(ops,'POST','/refunds',{}, {payment:paymentId,amount:1,reason:'Duplicate'})).statusCode,409)
        assert.equal((await call(ops,'POST','/refunds/:id/status',{id:refundId},{status:'Approved'})).statusCode,200)
        assert.equal((await call(ops,'POST','/refunds/:id/status',{id:refundId},{status:'Refunded'})).statusCode,200)
        assert(await tx.otherTreatmentPayment.findUnique({where:{id:paymentId}}))
        assert.equal((await call(other,'POST','/other-treatments',{}, {patientId:tag,branch:'Guimba',service:'Flu'},
          {...user,allBranches:false,branchName:'Baloc'})).statusCode,403)
        assert.equal(await tx.encounter.count({where:{patientId:tag}}),0)
        assert.equal(await tx.dose.count({where:{encounter:{patientId:tag}}}),0)
        // A multi-service visit produces one pending ledger row and one full payment.
        const groupId = randomUUID()
        for (const [suffix,item] of [['-group-flu','Flu'],['-group-tt','Tetanus Toxoid']]) {
          await tx.inventoryLine.create({ data: { id:tag+suffix, item, type:'Test', branch:'Guimba', batch:tag+suffix, expiry:'2099-12-31', stock:2, begin:2, date:today, shift:'MS', unit:'vials' } })
        }
        const groupRes = await call(other,'POST','/other-treatment-visits',{}, {requestId:groupId,patientId:tag,branch:'Guimba',items:[
          {service:'Flu',stockLineId:tag+'-group-flu',stockQuantity:1,administeredBy:'Synthetic Staff',priceCentavos:160000},
          {service:'TT',stockLineId:tag+'-group-tt',stockQuantity:1,administeredBy:'Synthetic Staff',priceCentavos:30000}
        ]})
        assert.equal(groupRes.statusCode,200)
        assert.equal(new Date(groupRes.body.treatments[0].administeredAt).getTime(),new Date(groupRes.body.treatments[1].administeredAt).getTime())
        assert(groupRes.body.treatments.every(t=>t.administeredBy==='Synthetic Staff'))
        assert.equal(groupRes.body.movements.length,2)
        assert(groupRes.body.movements.every(m => m.ref === groupRes.body.treatments[0].reference))
        const groupRows = () => tx.otherTreatment.findMany({where:{visitId:groupId},include:{patient:{select:{id:true,name:true}},payment:true}})
        let pendingRows = domain.otherPendingClients(await groupRows())
        assert.equal(pendingRows.length,1);assert.equal(pendingRows[0].amount,1900);assert.equal(pendingRows[0].status,'Pending')
        const data = load(path.join('src','data.js'), { '../lib/shiftPreview': load(path.join('lib','shiftPreview.ts'), {}) })
        assert.equal(data.isSale(pendingRows[0]),false)
        const prices = await call(other,'GET','/other-treatments/:id/prices',{id:pendingRows[0].otherTreatmentId})
        assert.equal(prices.statusCode,200);assert.equal(prices.body.items.length,2)
        const correction = {reason:'Synthetic price correction',items:prices.body.items.map(item=>({id:item.id,expectedPriceCentavos:item.priceCentavos,priceCentavos:item.service==='Flu'?155000:item.priceCentavos}))}
        assert.equal((await call(other,'PATCH','/other-treatments/:id/prices',{id:pendingRows[0].otherTreatmentId},{...correction,reason:''})).statusCode,400)
        assert.equal((await call(other,'PATCH','/other-treatments/:id/prices',{id:pendingRows[0].otherTreatmentId},correction,{...user,allBranches:false,branchName:'Baloc'})).statusCode,403)
        const corrected = await call(other,'PATCH','/other-treatments/:id/prices',{id:pendingRows[0].otherTreatmentId},correction)
        assert.equal(corrected.statusCode,200);assert.equal(corrected.body.amount,1850)
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'-group-flu'}})).stock,1)
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'-group-tt'}})).stock,1)
        assert.equal(await tx.auditLog.count({where:{userId:tag,action:'Unpaid treatment prices corrected'}}),1)
        assert.equal((await call(other,'PATCH','/other-treatments/:id/prices',{id:pendingRows[0].otherTreatmentId},correction)).statusCode,409)
        pendingRows = domain.otherPendingClients(await groupRows());assert.equal(pendingRows[0].amount,1850)
        assert.equal((await call(other,'POST','/other-treatments/:id/payment',{id:pendingRows[0].otherTreatmentId},{amountCentavos:10000,method:'Cash'})).statusCode,409)
        const full = await call(other,'POST','/other-treatments/:id/payment',{id:pendingRows[0].otherTreatmentId},{amountCentavos:185000,method:'Cash'})
        assert.equal(full.statusCode,200);assert.equal(full.body.payment.amountCentavos,185000)
        assert.equal(domain.otherPendingClients(await groupRows()).length,0)
        assert.equal(await tx.otherTreatmentPayment.count({where:{treatment:{visitId:groupId}}}),1)
        assert.equal((await call(other,'POST','/other-treatments/:id/payment',{id:groupRes.body.treatments[1].id},{amountCentavos:185000,method:'Cash'})).statusCode,409)
        assert.equal((await call(other,'PATCH','/other-treatments/:id/prices',{id:pendingRows[0].otherTreatmentId},correction)).statusCode,409)
        const projectedPaid = domain.otherPaymentClient({...full.body,patient:{id:tag,name:'Synthetic Patient'}})
        assert.equal(data.isSale(projectedPaid),true)
        // Collect can atomically correct prices and take one full payment.
        const mixedStaff=await call(other,'POST','/other-treatment-visits',{}, {requestId:randomUUID(),patientId:tag,branch:'Guimba',items:[
          {service:'Flu',stockLineId:tag+'-group-flu',stockQuantity:1,administeredBy:'Staff A',priceCentavos:160000},
          {service:'TT',stockLineId:tag+'-group-tt',stockQuantity:1,administeredBy:'Staff B',priceCentavos:30000}
        ]})
        assert.equal(mixedStaff.statusCode,400)
        const atomicId=randomUUID()
        const atomic = await call(other,'POST','/other-treatment-visits',{}, {requestId:atomicId,patientId:tag,branch:'Guimba',items:[
          {service:'Flu',stockLineId:tag+'-group-flu',stockQuantity:1,administeredBy:'Synthetic Staff',priceCentavos:160000},
          {service:'TT',stockLineId:tag+'-group-tt',stockQuantity:1,administeredBy:'Synthetic Staff',priceCentavos:30000}
        ]})
        assert.equal(atomic.statusCode,200)
        const atomicRows = () => tx.otherTreatment.findMany({where:{visitId:atomicId},include:{patient:{select:{id:true,name:true}},payment:true},orderBy:{reference:'asc'}})
        const original=await atomicRows(), atomicRef=original[0].id
        const expectedPrices=original.map(t=>({id:t.id,priceCentavos:t.priceCentavos}))
        const correctionItems=original.map(t=>({id:t.id,expectedPriceCentavos:t.priceCentavos,priceCentavos:t.service==='Flu'?155000:t.priceCentavos}))
        const body={amountCentavos:185000,method:'Cash',expectedPrices,priceCorrection:{reason:'Synthetic correction',items:correctionItems}}
        assert.equal((await call(other,'POST','/other-treatments/:id/payment',{id:atomicRef},{...body,priceCorrection:{...body.priceCorrection,reason:''}})).statusCode,400)
        assert.equal((await call(other,'POST','/other-treatments/:id/payment',{id:atomicRef},{...body,amountCentavos:1})).statusCode,409)
        assert.deepEqual((await atomicRows()).map(t=>t.priceCentavos),original.map(t=>t.priceCentavos))
        assert.equal((await call(other,'POST','/other-treatments/:id/payment',{id:atomicRef},{...body,expectedPrices:expectedPrices.map((x,i)=>i?x:{...x,priceCentavos:1})})).statusCode,409)
        const atomicPaid=await call(other,'POST','/other-treatments/:id/payment',{id:atomicRef},body)
        assert.equal(atomicPaid.statusCode,200);assert.equal(atomicPaid.body.payment.amountCentavos,185000)
        assert.equal(await tx.otherTreatmentPayment.count({where:{treatment:{visitId:atomicId}}}),1)
        assert.equal((await atomicRows()).find(t=>t.service==='Flu').priceCentavos,155000)
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'-group-flu'}})).stock,0)
        assert.equal((await call(other,'POST','/other-treatments/:id/payment',{id:atomicRef},body)).statusCode,409)
        assert.equal(await tx.auditLog.count({where:{userId:tag,action:'Unpaid treatment prices corrected'}}),2)
        const paidView=await call(other,'GET','/other-treatments/:id/prices',{id:atomicRef})
        assert.equal(paidView.statusCode,200);assert.equal(paidView.body.paid,true);assert.equal(paidView.body.items.length,2)


        // Two separate shifts share a date without combining their clock stamps.
        const employeeId=tag+'-employee'
        await tx.employee.create({data:{id:employeeId,name:'Synthetic Staff',branch:'Guimba',position:'Nurse',role:'Nurse',rate:850}})
        await tx.user.update({where:{id:tag},data:{employeeId}})
        const nightUser={...user,employeeId}
        await tx.attendance.create({data:{id:tag+'-attendance',userId:tag,date:today,branch:'Guimba',clockIn:'07:00',clockOut:''}})
        assert.equal((await call(ops,'POST','/attendance/night/in',{}, {},nightUser)).statusCode,409)
        await tx.attendance.update({where:{id:tag+'-attendance'},data:{clockIn:'',clockOut:''}})
        let nightIn=await call(ops,'POST','/attendance/night/in',{}, {},nightUser)
        assert.equal(nightIn.statusCode,200);assert(nightIn.body.nightClockIn)
        assert.equal((await call(ops,'POST','/attendance/night/in',{}, {},nightUser)).statusCode,409)
        assert.equal((await call(ops,'POST','/attendance/in',{}, {},nightUser)).statusCode,409)
        await tx.attendance.update({where:{id:tag+'-attendance'},data:{nightClockIn:'00:00'}})
        let nightOut=await call(ops,'POST','/attendance/night/out',{}, {},nightUser)
        assert.equal(nightOut.statusCode,200);assert(nightOut.body.nightClockOut)
        assert.equal((await call(ops,'POST','/attendance/night/out',{}, {},nightUser)).statusCode,409)
        const nightCorrected=await call(ops,'POST','/attendance/correct',{}, {date:today,field:'Night Time In',updated:'00:01',reason:'Test correction',userId:tag},nightUser)
        assert.equal(nightCorrected.statusCode,200)
        assert.equal(nightCorrected.body.attendance.nightClockIn,'00:01')
        console.log('Night attendance and correction checks: PASS')

        // Senior/PWD discount is calculated on the complete visit and saved with the payment.
        for (const [suffix,item] of [['-discount-flu','Flu'],['-discount-tt','Tetanus Toxoid']]) {
          await tx.inventoryLine.create({data:{id:tag+suffix,item,type:'Test',branch:'Guimba',batch:tag+suffix,expiry:'2099-12-31',stock:1,begin:1,date:today,shift:'MS',unit:'vials'}})
        }
        const discounted=await call(other,'POST','/other-treatment-visits',{}, {requestId:randomUUID(),patientId:tag,branch:'Guimba',items:[
          {service:'Flu',stockLineId:tag+'-discount-flu',stockQuantity:1,administeredBy:'Synthetic Staff',priceCentavos:160001},
          {service:'TT',stockLineId:tag+'-discount-tt',stockQuantity:1,administeredBy:'Synthetic Staff',priceCentavos:30001}
        ]})
        assert.equal(discounted.statusCode,200)
        const discountId=discounted.body.treatments[0].id
        assert.equal((await call(other,'POST','/other-treatments/:id/payment',{id:discountId},{amountCentavos:190002,method:'Cash',discountType:'Senior'})).statusCode,409)
        const discountPaid=await call(other,'POST','/other-treatments/:id/payment',{id:discountId},{amountCentavos:152002,method:'Cash',discountType:'Senior'})
        assert.equal(discountPaid.statusCode,200)
        assert.equal(discountPaid.body.payment.discountCentavos,38000)
        assert.equal(discountPaid.body.payment.discountType,'Senior')
        assert.equal(discountPaid.body.payment.amountCentavos,152002)
        const discountView=await call(other,'GET','/other-treatments/:id/prices',{id:discountId})
        assert.equal(discountView.body.payment.amountCentavos,152002)
        assert.equal(discountView.body.payment.discountCentavos,38000)
        assert.equal((await call(other,'POST','/other-treatments/:id/payment',{id:discountId},{amountCentavos:152002,method:'Cash',discountType:'Senior'})).statusCode,409)
        // Exercise the RER payment route with synthetic records inside the rollback transaction.
        await tx.encounter.create({data:{id:tag+'-rer',registry:tag+'-registry',patientId:tag,branch:'Guimba',date:today,rer:true,billing:'Walk-in',wound:{},history:{},tt:{},erig:{},progress:{}}})
        for (const [id,service,amount] of [['a','Anti-rabies vaccine',750],['b','ERIG (serum)',2600],['c','Tetanus Toxoid',300]]) await tx.payment.create({data:{id:tag+id,registry:tag+'-registry',encounterId:tag+'-rer',patient:'Synthetic',branch:'Guimba',date:today,service,classification:'Walk-in',amount,status:'Pending',txn:tag+'-txn'}})
        const source=fs.readFileSync(path.join('lib','routes','clinical.ts'),'utf8')
        const routeSource=source.slice(source.indexOf('const SERVICE_PRICES:'),source.indexOf("clinicalRouter.post('/referrals'"))
        let rerHandler
        const policy=load(path.join('lib','billingPolicy.ts'),{})
        const injected={z:require('zod').z,clinicalRouter:{post:(_p,_g,h)=>{rerHandler=h}},requirePage:()=>()=>{},prisma:db,servicingBranch:e=>e.branch,boosterServiceForBrand:policy.boosterServiceForBrand,isBoosterVaccineLine:policy.isBoosterVaccineLine,addsOtherOnlyServices:policy.addsOtherOnlyServices,clinicDate:()=>today,issueTxn:async()=>tag+'-txn2',nextPrefixedId:async()=>tag+'-new',audit:async()=>{},autoDay0Extras:async()=>({}),paymentClient:x=>x,blankErig:{}}
        const rerJs=ts.transpileModule(routeSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
        new Function(...Object.keys(injected),rerJs)(...Object.values(injected))
        const items=[['a','Anti-rabies vaccine',75000],['b','ERIG (serum)',260000],['c','Tetanus Toxoid',30000]].map(([id,service,price])=>({service,qty:1,unitPriceCentavos:price,pendingPaymentId:tag+id,expectedAmountCentavos:price}))
        const rr=router.createRes()
        await rerHandler({user,userAgent:'synthetic',body:{encounterId:tag+'-rer',intent:'collect',lines:items.map(x=>({service:x.service,qty:1})),priceAdjustment:{reason:'',discountType:'PWD',items}}},rr)
        assert.equal(rr.statusCode,200)
        assert.equal(rr.body.payments.reduce((n,x)=>n+x.amount,0),2920)
        assert.equal(rr.body.payments.reduce((n,x)=>n+x.discountCentavos,0),73000)
        assert(rr.body.payments.every(x=>x.discountType==='PWD'))
        assert.equal((await tx.payment.findMany({where:{encounterId:tag+'-rer',status:'Paid'}})).length,3)

        await tx.dose.create({data:{id:tag+'-dose',encounterId:tag+'-rer',day:'D0',date:today,dose:'1 vial IM',vaccinator:'Synthetic Nurse',branch:'Guimba'}})
        const signatureSource=source.slice(source.indexOf("clinicalRouter.post('/encounters/:id/doses/:day/signature'"),source.indexOf("clinicalRouter.patch('/encounters/:id/doses/:day'"))
        let signHandler
        const signDeps={clinicalRouter:{post:(_p,_g,h)=>{signHandler=h}},requireAny:()=>()=>{},prisma:db,z:require('zod').z,readSignature:load(path.join('lib','signatureInput.ts'),{}).readSignature,clinicDate:()=>today,doseClient:x=>x}
        const signJs=ts.transpileModule(signatureSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
        new Function(...Object.keys(signDeps),signJs)(...Object.values(signDeps))
        const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(1,16);png.writeUInt32BE(1,20)
        const image='data:image/png;base64,'+png.toString('base64');png[32]=1;const replacement='data:image/png;base64,'+png.toString('base64')
        async function sign(body,actor=user){const result=router.createRes();await signHandler({params:{id:tag+'-rer',day:'D0'},user:actor,userAgent:'synthetic',body},result);return result}
        assert.equal((await sign({image,method:'pen',expectedImage:null},{...user,allBranches:false,branchName:'Baloc'})).statusCode,403)
        assert.equal((await sign({image:'bad',method:'pen',expectedImage:null})).statusCode,400)
        assert.equal((await sign({image,method:'pen',expectedImage:null})).statusCode,200)
        assert.equal((await sign({image:replacement,method:'upload',expectedImage:null,reason:'correction'})).statusCode,409)
        assert.equal((await sign({image:replacement,method:'upload',expectedImage:image})).statusCode,400)
        const revised=await sign({image:replacement,method:'upload',expectedImage:image,reason:'corrected'})
        assert.equal(revised.statusCode,200);assert.equal(revised.body.signature,replacement)
        const history=await tx.signatureCorrection.findMany({where:{kind:'vaccinator',recordId:tag+'-dose'}})
        assert.equal(history.length,1);assert.equal(history[0].previousImage,image)
        console.log('Vaccinator signature, branch access, stale edit and correction history: PASS')

        console.log('Senior/PWD RER and Other Treatment totals, snapshots and duplicate checks: PASS')

        console.log('Atomic price correction and full collection: PASS')
        console.log('Pending visit, full payment, no duplicate and sales classification: PASS')
        console.log('Standalone treatment, sales record, stock, refund, branch and RER isolation: PASS')
        throw new Error('ROLLBACK_TEST')
      }, { timeout:30000 })
    } catch (e) { if (e.message !== 'ROLLBACK_TEST') throw e }
    assert.equal(await prisma.patient.count({where:{id:tag}}),0)
    console.log('Synthetic records rolled back: PASS')
  } finally { await prisma.$disconnect() }
}
main().catch(e => { console.error('Smoke test failed:',e.name,e.code || '', e.message); process.exitCode=1 })