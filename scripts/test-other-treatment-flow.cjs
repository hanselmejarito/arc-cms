// Local-only integration smoke test. All synthetic records are rolled back.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { PrismaClient } = require('@prisma/client')
// Start legacy-path assertions with the feature off; gated scenarios enable it explicitly.
process.env.TEMPORARY_BRANCH_ENABLED='false'

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
        const nurseDuty=load(path.join('lib','nurseDuty.ts'),{'./clinical.js':clinical,'./dutyAccess.js':load(path.join('lib','dutyAccess.ts'),{})})
        const branchSchedules=load(path.join('lib','branchSchedules.ts'),{})
        const deps = { '../router.js':router, '../auth.js':auth, '../prisma.js':{prisma:db}, '../clinical.js':clinical, '../nurseDuty.js':nurseDuty, '../branchSchedules.js':branchSchedules, '../attendanceCorrection.js':load(path.join('lib','attendanceCorrection.ts'),{}), '../../src/payrollEligibility.js':load(path.join('src','payrollEligibility.js'),{}), '../signatureInput.js':load(path.join('lib','signatureInput.ts'),{}),
          '../otherTreatment.js':domain, '../temporaryPatientAccess.js':{temporaryPatientAllowed:async()=>true}, '../shiftClose.js':{catchUpBranch:async()=>{}}, '../map.js':map,
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
        const futureDate=new Date(Date.now()+3*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})
        const scheduleBody={effectiveFrom:futureDate,morningStart:'08:00',morningEnd:'17:00',nurseStart:'07:00',nurseEnd:'16:00',nightEnabled:true,nightStart:'16:00',nightEnd:'23:00'}
        assert.equal((await call(ops,'POST','/branches/:name/schedules',{name:'Guimba'},{...scheduleBody,effectiveFrom:today})).statusCode,400)
        assert.equal((await call(ops,'POST','/branches/:name/schedules',{name:'Guimba'},{...scheduleBody,morningEnd:'07:00'})).statusCode,400)
        assert.equal((await call(ops,'POST','/branches/:name/schedules',{name:'Guimba'},scheduleBody)).statusCode,200)
        assert.equal((await call(ops,'POST','/branches/:name/schedules',{name:'Guimba'},scheduleBody)).statusCode,409)
        assert((await call(ops,'GET','/branches/:name/schedules',{name:'Guimba'})).body.some(x=>x.effectiveFrom===futureDate))
        const nextDate=new Date(Date.now()+4*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})
        const originalBranch=await tx.branch.findUniqueOrThrow({where:{name:'Guimba'}})
        const combined={contact:'Synthetic contact',night:true,schedule:{...scheduleBody,effectiveFrom:nextDate}}
        assert.equal((await call(ops,'PATCH','/branches/:name',{name:'Guimba'},combined)).statusCode,200)
        assert.equal((await tx.branch.findUniqueOrThrow({where:{name:'Guimba'}})).contact,'Synthetic contact')
        const duplicate={...combined,contact:'Must roll back'}
        assert.equal((await call(ops,'PATCH','/branches/:name',{name:'Guimba'},duplicate)).statusCode,409)
        assert.equal((await tx.branch.findUniqueOrThrow({where:{name:'Guimba'}})).contact,'Synthetic contact')
        assert.equal((await call(ops,'PATCH','/branches/:name',{name:'Guimba'},{...combined,contact:'Invalid',schedule:{...combined.schedule,effectiveFrom:today}})).statusCode,400)
        assert.equal((await tx.branch.findUniqueOrThrow({where:{name:'Guimba'}})).contact,'Synthetic contact')
        await tx.branch.update({where:{name:'Guimba'},data:{contact:originalBranch.contact,night:originalBranch.night}})
        console.log('Branch details and schedule save atomically: PASS')
        console.log('Branch schedule version storage and validation: PASS')
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
        const data = load(path.join('src','data.js'), { '../lib/shiftPreview': load(path.join('lib','shiftPreview.ts'), {}), './timeFormat': load(path.join('src','timeFormat.js'), {}) })
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
        const imageBytes=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(imageBytes);imageBytes.write('IHDR',12);imageBytes.writeUInt32BE(1,16);imageBytes.writeUInt32BE(1,20)
        const savedImage='data:image/png;base64,'+imageBytes.toString('base64');imageBytes[32]=2;const newerImage='data:image/png;base64,'+imageBytes.toString('base64')
        const signaturePayload={kind:'Nurse',employeeId,image:savedImage,method:'upload'}
        assert.equal((await call(ops,'POST','/staff-signatures',{},signaturePayload,{...user,role:'Nurse'})).statusCode,403)
        const managedNurse=await call(ops,'POST','/staff-signatures',{},signaturePayload)
        assert.equal(managedNurse.statusCode,200)
        const savedSignerId=managedNurse.body.id
        assert.equal((await call(ops,'POST','/staff-signatures',{},signaturePayload)).statusCode,409)
        const matchingNurse=await call(ops,'GET','/staff-signatures',{}, {},{...user,role:'Nurse',allBranches:false,branchName:'Guimba'})
        const otherBranchNurse=await call(ops,'GET','/staff-signatures',{}, {},{...user,role:'Nurse',allBranches:false,branchName:'Baloc'})
        assert(matchingNurse.body.some(x=>x.id===savedSignerId));assert(!otherBranchNurse.body.some(x=>x.id===savedSignerId))
        const managedDoctor=await call(ops,'POST','/staff-signatures',{}, {kind:'Doctor',name:'Synthetic Doctor',image:savedImage,method:'upload'})
        assert.equal(managedDoctor.statusCode,200)
        const staffTools=load(path.join('lib','staffSignatures.ts'),{'./nurseDuty.js':nurseDuty}),staffResolver=staffTools.resolveStaffSignature
        assert.equal((await staffResolver(tx,savedSignerId,'Nurse','Synthetic Staff','Guimba',managedNurse.body.updatedAt)).image,savedImage)
        await assert.rejects(()=>staffResolver(tx,savedSignerId,'Nurse','Synthetic Staff','Baloc',managedNurse.body.updatedAt))
        await assert.rejects(()=>staffResolver(tx,managedDoctor.body.id,'Doctor','Wrong Doctor','Guimba',managedDoctor.body.updatedAt))
        assert.equal((await staffResolver(tx,managedDoctor.body.id,'Doctor','Synthetic Doctor','Guimba',managedDoctor.body.updatedAt)).image,savedImage)
        console.log('Saved-signature admin permissions, signer identity and branch restriction: PASS')
        const payrollBody={employeeId,periodId:'synthetic-period',days:0,late:0,undertime:0,night:0,obCount:2,reason:'Verified OB count'}
        assert.equal((await call(ops,'POST','/payroll/inputs',{},payrollBody,{...user,role:'Nurse'})).statusCode,403)
        assert.equal((await call(ops,'POST','/payroll/inputs',{},payrollBody)).statusCode,200)
        let obInput=await tx.payrollInput.findUniqueOrThrow({where:{employeeId_periodId:{employeeId,periodId:'synthetic-period'}}})
        assert.equal(obInput.obCount,2);assert.equal(obInput.obHomeBranch,'Guimba')
        assert.equal((await call(ops,'POST','/payroll/inputs',{}, {...payrollBody,obCount:1.5})).statusCode,400)
        await tx.employee.update({where:{id:employeeId},data:{branch:'Paniqui'}})
        assert.equal((await call(ops,'POST','/payroll/inputs',{}, {...payrollBody,obCount:1})).statusCode,200)
        obInput=await tx.payrollInput.findUniqueOrThrow({where:{employeeId_periodId:{employeeId,periodId:'synthetic-period'}}})
        assert.equal(obInput.obCount,1);assert.equal(obInput.obHomeBranch,'Guimba')
        await tx.employee.update({where:{id:employeeId},data:{branch:'Guimba'}})
        console.log('OB count, admin restriction and home-branch snapshot: PASS')
        await tx.user.update({where:{id:tag},data:{employeeId}})
        const nightUser={...user,employeeId}
        await tx.attendance.create({data:{id:tag+'-attendance',userId:tag,date:today,branch:'Guimba',clockIn:'07:00',clockOut:''}})
        assert.equal((await call(ops,'POST','/attendance/night/in',{}, {},nightUser)).statusCode,409)
        await tx.attendance.update({where:{id:tag+'-attendance'},data:{clockIn:'',clockOut:''}})
        let nightIn=await call(ops,'POST','/attendance/night/in',{}, {},nightUser)
        assert.equal(nightIn.statusCode,200);assert(nightIn.body.nightClockIn);assert.equal(nightIn.body.nightBranch,'Guimba')
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
        const limitedNurse={...nightUser,role:'Nurse',allBranches:false,branchName:'Guimba'}
        await tx.attendance.update({where:{id:tag+'-attendance'},data:{clockIn:'',clockOut:'',nightClockIn:'',nightClockOut:'',nightBranch:null}})
        assert.equal((await call(ops,'POST','/attendance/in',{}, {branch:'Paniqui'},limitedNurse)).statusCode,403)
        process.env.TEMPORARY_BRANCH_ENABLED='true'
        try {
          const futureOff=new Date(Date.now()+5*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'})
          const scheduledOff={...scheduleBody,effectiveFrom:futureOff,nightEnabled:false,nightStart:null,nightEnd:null}
          assert.equal((await call(ops,'PATCH','/branches/:name',{name:'Guimba'},{night:false,schedule:scheduledOff},nightUser)).statusCode,200)
          assert.equal((await tx.branch.findUniqueOrThrow({where:{name:'Guimba'}})).night,true)
          const savedBranch=await tx.branch.findUniqueOrThrow({where:{name:'Guimba'}})
          assert.equal(await branchSchedules.branchNightAt(tx,savedBranch,today),true)
          assert.equal(await branchSchedules.branchNightAt(tx,savedBranch,futureOff),false)
          const previousDate=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10)
          await tx.attendance.create({data:{id:tag+'-stale-duty',userId:tag,date:previousDate,branch:'Guimba',clockIn:'07:00'}})
          assert.equal((await call(ops,'POST','/attendance/in',{}, {branch:'Paniqui'},limitedNurse)).statusCode,409)
          await tx.attendance.update({where:{id:tag+'-stale-duty'},data:{clockOut:'16:00'}})
          const morning=await call(ops,'POST','/attendance/in',{}, {branch:'Paniqui'},limitedNurse)
          assert.equal(morning.statusCode,200);assert.equal(morning.body.branch,'Paniqui');assert.equal(morning.body.homeBranchAtMorning,'Guimba')
          assert.equal((await nurseDuty.nursesByDuty(tx)).find(n=>n.id===employeeId).dutyBranch,'Paniqui')
          assert.equal((await staffResolver(tx,savedSignerId,'Nurse','Synthetic Staff','Paniqui',managedNurse.body.updatedAt)).image,savedImage)
          await assert.rejects(()=>staffResolver(tx,savedSignerId,'Nurse','Synthetic Staff','Guimba',managedNurse.body.updatedAt))
          const dutyDoses=load(path.join('lib','doses.ts'),{'./auth.js':{servicingBranch:e=>e.branch},'./clinical.js':clinical,'./ids.js':{},'./inventory.js':{},'./staffSignatures.js':staffTools,'./nurseDuty.js':nurseDuty})
          assert.equal((await dutyDoses.resolveVaccinator(tx,'Paniqui','Synthetic Staff')).id,employeeId)
          const assignedSignatures=await call(ops,'GET','/staff-signatures',{}, {},{...limitedNurse,branchName:'Paniqui',temporaryDuty:true})
          assert(assignedSignatures.body.some(x=>x.id===savedSignerId&&x.branch==='Paniqui'))
          await tx.attendance.update({where:{id:tag+'-attendance'},data:{clockOut:'07:00'}})
          const invalidNight=await call(ops,'POST','/attendance/night/in',{}, {branch:'Paniqui'},limitedNurse)
          assert.equal(invalidNight.statusCode,403)
          const night=await call(ops,'POST','/attendance/night/in',{}, {branch:'Guimba'},limitedNurse)
          assert.equal(night.statusCode,200);assert.equal(night.body.branch,'Paniqui');assert.equal(night.body.nightBranch,'Guimba');assert.equal(night.body.homeBranchAtNight,'Guimba')
          const correction={userId:tag,date:today,shift:'morning',branch:'Baloc',expectedBranch:'Paniqui',reason:'Test correction'}
          assert.equal((await call(ops,'POST','/attendance/correct-branch',{},correction,limitedNurse)).statusCode,403)
          assert.equal((await call(ops,'POST','/attendance/correct-branch',{}, {...correction,reason:''},nightUser)).statusCode,400)
          assert.equal((await call(ops,'POST','/attendance/correct-branch',{},correction,nightUser)).statusCode,200)
          const changed=await tx.attendance.findUniqueOrThrow({where:{id:tag+'-attendance'}})
          assert.equal(changed.branch,'Baloc');assert.equal(changed.nightBranch,'Guimba')
          assert.equal((await call(ops,'POST','/attendance/correct-branch',{},correction,nightUser)).statusCode,409)
          assert.equal(await tx.auditLog.count({where:{userId:tag,record:today+' · Morning branch',newValue:{contains:'Test correction'}}}),1)
          await tx.attendance.update({where:{id:tag+'-attendance'},data:{nightClockIn:'00:00'}})
          assert.equal((await call(ops,'POST','/attendance/night/out',{}, {},limitedNurse)).statusCode,200)
        } finally { process.env.TEMPORARY_BRANCH_ENABLED='false' }
        console.log('Gated morning and night branch selection: PASS')

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
        // PhilHealth follow-up payments are linked to one scheduled dose and cannot be reused.
        await tx.patient.update({where:{id:tag},data:{philhealth:true}})
        const phId=tag+'-ph'
        await tx.encounter.create({data:{id:phId,registry:tag+'-ph-registry',patientId:tag,branch:'Guimba',date:today,rer:true,billing:'PhilHealth',category:'III',pepEligible:true,regimen:'IM',vaccine:'PVRV',brand:'Bioshoot',wound:{},history:{},tt:{},erig:{},progress:{}}})
        for(const day of ['D0','D3','D7']) await tx.dose.create({data:{id:phId+'-'+day,encounterId:phId,day,date:today,dose:'1 vial IM',vaccinator:'Synthetic Staff',branch:'Guimba'}})
        const phSource=source.slice(source.indexOf('const doseSchema ='),source.indexOf("clinicalRouter.post('/encounters/:id/doses/:day/signature'"))
        const phHandlers={}
        const realClinical=load(path.join('lib','clinical.ts'),{})
        // Exercise a new Talavera admission with real ID issuance; all writes roll back.
        const registryTools=load(path.join('lib','registry.ts'),{'./clinical.js':realClinical})
        const patientSource=source.slice(source.indexOf('const patientSchema ='),source.indexOf("clinicalRouter.get('/patients/match'"))
        const admissionSource=source.slice(source.indexOf('const admitSchema ='),source.indexOf('function openBillLines('))
        let admissionHandler
        const admissionDeps={z:require('zod').z,clinicalRouter:{post:(_p,_g,h)=>{admissionHandler=h}},requirePage:()=>()=>{},prisma:db,optionalPhoto:()=>undefined,hasPatientAddress:undefined,samePerson:realClinical.samePerson,temporaryPatientAllowed:async()=>true,inScopeEncounter:()=>true,canAccessBranch:()=>true,servicingBranch:e=>e.branch,statusOf:realClinical.statusOf,ageFrom:realClinical.ageFrom,fullName:realClinical.fullName,nextPrefixedId:registryTools.nextPrefixedId,issueRegistry:registryTools.issueRegistry,issueTxn:registryTools.issueTxn,blankHistory:realClinical.blankHistory,blankTt:realClinical.blankTt,blankErig:realClinical.blankErig,blankProgress:realClinical.blankProgress,audit:async()=>{},patientClient:x=>x,encounterClient:x=>x,paymentClient:x=>x}
        delete admissionDeps.hasPatientAddress
        const admissionJs=ts.transpileModule(patientSource+admissionSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
        new Function(...Object.keys(admissionDeps),admissionJs)(...Object.values(admissionDeps))
        const admissionResult=router.createRes()
        await admissionHandler({user,body:{mode:'New patient',visit:{branch:'Talavera',date:today,billing:'Walk-in'},patient:{first:'Synthetic',last:tag,birthday:'1990-01-01',sex:'Male',contact:'00000000000',address:'Synthetic address',municipality:'Talavera',branch:'Talavera'}}},admissionResult)
        assert.equal(admissionResult.statusCode,200)
        assert.equal(admissionResult.body.encounter.day14Workflow,'optional')
        assert.equal(admissionResult.body.payment.status,'Pending')
        console.log('Synthetic Talavera new admission and registry issuance: PASS')
        // PrEP must become a paid Walk-in without changing membership or past treatment.
        await tx.patient.update({where:{id:tag},data:{philhealth:true}})
        const prepId=tag+'-prep'
        await tx.encounter.create({data:{id:prepId,registry:prepId+'-registry',patientId:tag,branch:'Guimba',date:today,rer:false,billing:'PhilHealth',wound:{},history:{},tt:{},erig:{},progress:{}}})
        await tx.payment.create({data:{id:prepId+'-bill',encounterId:prepId,registry:prepId+'-registry',patient:'Synthetic',branch:'Guimba',date:today,service:'Anti-rabies vaccine',classification:'PhilHealth',amount:0,status:'Not billed',txn:prepId+'-txn'}})
        const prepPolicy=load(path.join('lib','billingPolicy.ts'),{})
        let rerPatch
        const prepDeps={clinicalRouter:{patch:(_p,_g,h)=>{rerPatch=h}},requirePage:()=>()=>{},prisma:db,inScopeEncounter:()=>true,HIGH_RISK_SITES:realClinical.HIGH_RISK_SITES,boosterServiceForBrand:prepPolicy.boosterServiceForBrand,isBoosterVaccineLine:prepPolicy.isBoosterVaccineLine,PHILHEALTH_CATEGORY_III_PACKAGE:load(path.join('lib','philhealthPackage.ts'),{}).PHILHEALTH_CATEGORY_III_PACKAGE,blankErig:realClinical.blankErig,blankTt:realClinical.blankTt,servicingBranch:e=>e.branch,issueTxn:registryTools.issueTxn,nextPrefixedId:registryTools.nextPrefixedId,audit:async()=>{},encounterClient:x=>x,paymentClient:x=>x,inventoryClient:x=>x,movementClient:x=>x,clinicDate:()=>today,readSignature:()=>null}
        const prepSource=source.slice(source.indexOf('function openBillLines('),source.indexOf('const realDate ='))
        const prepJs=ts.transpileModule(prepSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
        new Function(...Object.keys(prepDeps),prepJs)(...Object.values(prepDeps))
        const prepResult=router.createRes()
        await rerPatch({params:{id:prepId},user,userAgent:'synthetic',body:{preExp:true,booster:false,rer:true,vaccine:'PVRV',brand:'Bioshoot',regimen:'ID'}},prepResult)
        assert.equal(prepResult.statusCode,200)
        assert.equal(prepResult.body.billing,'Walk-in')
        assert.equal((await tx.patient.findUniqueOrThrow({where:{id:tag}})).philhealth,true)
        const prepBill=await tx.payment.findMany({where:{encounterId:prepId}})
        assert.equal(prepBill.length,1);assert.equal(prepBill[0].classification,'Walk-in');assert.equal(prepBill[0].status,'Pending');assert.equal(prepBill[0].amount,750)
        const oldPrep=tag+'-old-prep'
        await tx.encounter.create({data:{id:oldPrep,registry:oldPrep+'-registry',patientId:tag,branch:'Guimba',date:today,rer:true,preExp:true,billing:'PhilHealth',wound:{},history:{},tt:{},erig:{},progress:{}}})
        await tx.dose.create({data:{id:oldPrep+'-D0',encounterId:oldPrep,day:'D0',date:today,dose:'0.1 mL × 2 sites ID',vaccinator:'Synthetic Staff',branch:'Guimba'}})
        const oldPrepResult=router.createRes()
        await rerPatch({params:{id:oldPrep},user,userAgent:'synthetic',body:{preExp:true,rer:true}},oldPrepResult)
        assert.equal(oldPrepResult.statusCode,409)
        assert.equal((await tx.encounter.findUniqueOrThrow({where:{id:oldPrep}})).billing,'PhilHealth')
        console.log('PrEP Walk-in billing, preserved membership and historical-dose guard: PASS')
        // Animal reports do not rewrite past doses; legacy cases need a recorded clinical review.
        const observationId=tag+'-observation-case'
        await tx.encounter.create({data:{id:observationId,registry:tag+'-observation-registry',patientId:tag,branch:'Guimba',date:today,biteDate:today,rer:true,billing:'Walk-in',category:'III',pepEligible:true,regimen:'ID',animalStatus:'Alive',wound:{},history:{},tt:{},erig:{},progress:{}}})
        for(const day of ['D0','D3','D7']) await tx.dose.create({data:{id:observationId+'-'+day,encounterId:observationId,day,date:today,dose:'0.1 mL × 2 sites ID',animalStatus:'Alive',vaccinator:'Synthetic Staff',branch:'Guimba'}})
        const observationRoutes={}
        const observationDeps={z:require('zod').z,clinicalRouter:{get:(p,_g,h)=>{observationRoutes['GET '+p]=h},post:(p,_g,h)=>{observationRoutes['POST '+p]=h}},requirePage:()=>()=>{},prisma:db,clinicDate:()=>today,clinicTime:()=> '12:00',inScopeEncounter:(u,e)=>u.allBranches||u.branchName===e.branch,servicingBranch:e=>e.branch,audit:async()=>{},caseInfo:realClinical.caseInfo,encounterClient:e=>e}
        const observationSource=source.slice(source.indexOf('const realDate ='),source.indexOf('const doseSchema ='))
        const observationJs=ts.transpileModule(observationSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
        new Function(...Object.keys(observationDeps),observationJs)(...Object.values(observationDeps))
        async function observationCall(method,routePath,body={},actor=user){const result=router.createRes();await observationRoutes[method+' '+routePath]({params:{id:observationId},body,user:actor,get:()=> 'synthetic'},result);return result}
        const reportPath='/encounters/:id/animal-observations', reviewPath='/encounters/:id/day14-workflow-review'
        assert.equal((await observationCall('POST',reportPath,{status:'Dead',observedDate:null,reportedDate:today,remarks:'Reported by owner'})).statusCode,200)
        assert.equal((await observationCall('POST',reportPath,{status:'Dead',observedDate:'invalid',reportedDate:today})).statusCode,400)
        assert.equal((await observationCall('GET',reportPath,{}, {...user,allBranches:false,branchName:'Baloc'})).statusCode,403)
        assert.equal((await observationCall('GET',reportPath)).body.length,1)
        assert.equal((await tx.dose.findUniqueOrThrow({where:{id:observationId+'-D7'}})).animalStatus,'Alive')
        assert.equal((await tx.encounter.findUniqueOrThrow({where:{id:observationId}})).day14Workflow,'legacy')
        assert.equal((await observationCall('POST',reviewPath,{clinician:'',reason:'Reviewed'})).statusCode,400)
        assert.equal((await observationCall('POST',reviewPath,{clinician:'Synthetic Clinician',reason:'Reviewed'})).statusCode,200)
        assert.equal((await tx.encounter.findUniqueOrThrow({where:{id:observationId}})).day14Workflow,'optional')
        assert.equal((await observationCall('POST',reviewPath,{clinician:'Synthetic Clinician',reason:'Reviewed'})).statusCode,409)
        assert.equal(await tx.auditLog.count({where:{record:tag+'-observation-registry',action:'Day 14 workflow clinically reviewed'}}),1)
        console.log('Animal status history, access and clinical review: PASS')
        const phPolicy=load(path.join('lib','philhealthPackage.ts'),{})
        const noteSource=source.slice(source.indexOf("clinicalRouter.post('/notes'"),source.indexOf('const SERVICE_PRICES:'))
        let noteHandler
        const noteDeps={clinicalRouter:{post:(_p,_g,h)=>{noteHandler=h}},requirePage:()=>()=>{},prisma:db,inScopeEncounter:()=>true,readSignature:load(path.join('lib','signatureInput.ts'),{}).readSignature,resolveStaffSignature:staffResolver,auditSavedSignatureUse:staffTools.auditSavedSignatureUse,servicingBranch:e=>e.branch,clinicDate:()=>today,nextPrefixedId:async()=>tag+'-saved-note',audit:async()=>{},noteClient:x=>x}
        const noteJs=ts.transpileModule(noteSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
        new Function(...Object.keys(noteDeps),noteJs)(...Object.values(noteDeps))
        const noteResult=router.createRes()
        await noteHandler({params:{},body:{patientId:tag,encounterId:phId,staff:'Synthetic Doctor',savedSignatureId:managedDoctor.body.id,savedSignatureVersion:managedDoctor.body.updatedAt},user,userAgent:'synthetic'},noteResult)
        assert.equal(noteResult.statusCode,200);assert.equal(noteResult.body.signature,savedImage);assert.equal(noteResult.body.recordedBy,tag)
        const changedDoctor=await call(ops,'POST','/staff-signatures',{}, {id:managedDoctor.body.id,kind:'Doctor',name:'Synthetic Doctor',image:newerImage,method:'upload',active:false,expectedUpdatedAt:managedDoctor.body.updatedAt,reason:'Test revocation'})
        assert.equal(changedDoctor.statusCode,200)
        assert.equal((await tx.progressNote.findUniqueOrThrow({where:{id:tag+'-saved-note'}})).signature,savedImage)
        await assert.rejects(()=>staffResolver(tx,managedDoctor.body.id,'Doctor','Synthetic Doctor','Guimba',changedDoctor.body.updatedAt))
        console.log('Saved doctor signature snapshot, audit identity and revocation: PASS')
        const autoId=tag+'-auto-day0'
        const autoEnc=await tx.encounter.create({data:{id:autoId,registry:tag+'-auto-registry',patientId:tag,branch:'Guimba',date:today,rer:true,billing:'Walk-in',category:'III',pepEligible:true,regimen:'IM',vaccine:'PVRV',brand:'Bioshoot',wound:{},history:{},tt:{},erig:{},progress:{}}})
        const autoDeps={'./auth.js':{servicingBranch:e=>e.branch},'./clinical.js':realClinical,'./ids.js':{nextId:async()=>tag+'-auto-movement'},'./inventory.js':{applyConsume:async()=>({line:{batch:'synthetic',shift:'MS'},vials:1}),doseUses:()=>1},'./staffSignatures.js':staffTools,'./nurseDuty.js':nurseDuty}
        const autoDoses=load(path.join('lib','doses.ts'),autoDeps)
        const autoResult=await autoDoses.tryAutoDay0(tx,autoEnc,[{encounterId:autoId,status:'Paid',amount:750}],'Synthetic Staff','Synthetic Staff',savedSignerId,tag,managedNurse.body.updatedAt)
        assert.equal(autoResult.created.signature,savedImage);assert.equal(autoResult.created.recordedBy,tag)
        console.log('Explicit Day 0 uses the selected nurse signature: PASS')
        await tx.payment.create({data:{id:tag+'-ph-placeholder',encounterId:phId,registry:tag+'-ph-registry',patient:'Synthetic',branch:'Guimba',date:today,service:'Anti-rabies vaccine',classification:'PhilHealth',amount:0,status:'Not billed',txn:tag+'-ph-package'}})
        const billSource=source.slice(source.indexOf('function openBillLines('),source.indexOf("clinicalRouter.patch('/encounters/:id'"))
        const billJs=ts.transpileModule(billSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
        let billSequence=0
        const billDeps={PHILHEALTH_CATEGORY_III_PACKAGE:phPolicy.PHILHEALTH_CATEGORY_III_PACKAGE,boosterServiceForBrand:()=>null,isBoosterVaccineLine:()=>false,prisma:db,issueTxn:async()=>tag+'-ph-package',nextPrefixedId:async()=>tag+'-ph-package-'+(++billSequence)}
        const syncBill=new Function(...Object.keys(billDeps),billJs+';return syncOpenBill')(...Object.values(billDeps))
        const phEncounter=await tx.encounter.findUniqueOrThrow({where:{id:phId}})
        let packageRows=await syncBill(tx,{...phEncounter,rer:false},phEncounter,'Synthetic')
        assert.equal(packageRows.length,4);assert.equal(packageRows.reduce((sum,p)=>sum+(p.claimValueCentavos||0),0),585000)
        assert(packageRows.every(p=>p.amount===0&&p.status==='Not billed'))
        const idsBefore=packageRows.map(p=>p.id).sort()
        packageRows=await syncBill(tx,phEncounter,phEncounter,'Synthetic')
        assert.deepEqual(packageRows.map(p=>p.id).sort(),idsBefore)
        console.log('PhilHealth package snapshot, zero patient charge and existing bill preservation: PASS')
        let phPaymentNo=0
        const followupTools=load(path.join('lib','followupCharge.ts'),{'./billingPolicy.js':prepPolicy,'./philhealthPackage.js':phPolicy,'./registry.js':registryTools})
        const phDeps={z:require('zod').z,clinicalRouter:{post:(p,_g,h)=>{phHandlers[p]=h}},requirePage:()=>()=>{},prisma:db,inScopeEncounter:()=>true,servicingBranch:e=>e.branch,NURSE_ROLE:'Nurse',caseInfo:realClinical.caseInfo,protocolOf:realClinical.protocolOf,isPhilhealthCashFollowUp:phPolicy.isPhilhealthCashFollowUp,boosterServiceForBrand:prepPolicy.boosterServiceForBrand,isBoosterVaccineLine:prepPolicy.isBoosterVaccineLine,ensureFollowupCharge:followupTools.ensureFollowupCharge,clinicDate:()=>today,clinicTime:()=> '12:00',issueTxn:async()=>tag+'-ph-txn-'+(++phPaymentNo),nextPrefixedId:async()=>tag+'-ph-pay-'+phPaymentNo,audit:async()=>{},paymentClient:x=>x,doseClient:x=>x,inventoryClient:x=>x,movementClient:x=>x,visitNeedsPay:realClinical.visitNeedsPay,visitPaid:realClinical.visitPaid,readSignature:()=>null,resolveStaffSignature:staffResolver,auditSavedSignatureUse:staffTools.auditSavedSignatureUse,createDoseInTx:async(tx,enc,input)=>({created:await tx.dose.create({data:{id:enc.id+'-'+input.day,encounterId:enc.id,day:input.day,date:input.date,dose:input.dose,vaccinator:input.vaccinator,branch:'Guimba',signature:input.signature||null,signatureMethod:input.signatureMethod||null,recordedBy:input.recordedBy||null}}),consumed:{line:{}},movement:{}})}
        const phJs=ts.transpileModule(phSource,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
        phDeps.resolveVaccinator=async(db,branch,name)=>db.employee.findFirst({where:{name,branch,role:'Nurse',status:'Active'}})
        new Function(...Object.keys(phDeps),phJs)(...Object.values(phDeps))
        async function phCall(path,body,id=phId,actor=user){const r=router.createRes();await phHandlers[path]({params:{id},user:actor,userAgent:'synthetic',body},r);return r}
        const doseBody=day=>({day,date:today,time:'09:00',dose:'1 vial IM',side:'L',animalStatus:'Alive',vaccinator:'Synthetic Staff'})
        const prepDose={...doseBody('D0'),dose:'0.1 mL × 2 sites ID',animalStatus:''}
        assert.equal((await phCall('/encounters/:id/doses',prepDose,prepId)).statusCode,200)
        await tx.payment.updateMany({where:{encounterId:prepId,status:'Pending'},data:{status:'Paid'}})
        assert.equal((await phCall('/encounters/:id/doses',{...prepDose,day:'D7'},prepId)).statusCode,200)
        assert.equal(await tx.payment.count({where:{encounterId:prepId,followUpDay:'D7',status:'Pending'}}),1)
        console.log('PrEP treatment-first, payment and follow-up billing: PASS')
        for (const order of ['payment-first', 'treatment-first']) {
          const id=tag+'-walkin-'+order
          await tx.encounter.create({data:{id,registry:id+'-registry',patientId:tag,branch:'Guimba',date:today,rer:true,billing:'Walk-in',category:'II',pepEligible:true,regimen:'ID',vaccine:'PVRV',brand:'Bioshoot',wound:{},history:{},tt:{},erig:{},progress:{}}})
          await tx.dose.create({data:{id:id+'-D0',encounterId:id,day:'D0',date:today,dose:'0.1 mL × 2 sites ID',animalStatus:'Alive',vaccinator:'Synthetic Staff',branch:'Guimba'}})
          await tx.payment.create({data:{id:id+'-initial',encounterId:id,registry:id+'-registry',patient:'Synthetic',branch:'Guimba',date:today,service:'Anti-rabies vaccine',classification:'Walk-in',amount:750,status:'Pending',txn:id+'-initial-txn',followUpDay:'D0'}})
          if(order==='payment-first') assert.equal((await phCall('/encounters/:id/followup-payment',{day:'D3',priceCentavos:75000},id)).statusCode,200)
          const given=await phCall('/encounters/:id/doses',doseBody('D3'),id)
          assert.equal(given.statusCode,200)
          assert.equal(given.body.followUpPayment.status,order==='payment-first'?'Paid':'Pending')
          if(order==='treatment-first') assert.equal((await phCall('/encounters/:id/followup-payment',{day:'D3',priceCentavos:75000},id)).statusCode,200)
          assert.equal(await tx.payment.count({where:{encounterId:id,followUpDay:'D3'}}),1)
          assert.equal(await tx.payment.count({where:{encounterId:id,followUpDay:'D0',status:'Pending'}}),1)
          assert.equal((await phCall('/encounters/:id/followup-payment',{day:'D3',priceCentavos:75000},id)).statusCode,409)
        }
        console.log('Walk-in follow-up payment-first and treatment-first: PASS')
        await tx.payment.create({data:{id:tag+'-legacy-arv',encounterId:phId,registry:tag+'-ph-registry',patient:'Synthetic',branch:'Guimba',date:today,service:'Anti-rabies vaccine',classification:'Walk-in',amount:750,status:'Paid',txn:tag+'-legacy-txn'}})
        assert.equal((await phCall('/encounters/:id/followup-payment',{day:'D14',priceCentavos:75000})).statusCode,409)
        await tx.payment.delete({where:{id:tag+'-legacy-arv'}})
        assert.equal((await phCall('/encounters/:id/followup-payment',{day:'D14',priceCentavos:75000})).statusCode,200)
        assert.equal((await phCall('/encounters/:id/followup-payment',{day:'D14',priceCentavos:75000})).statusCode,409)
        const signedDose=await phCall('/encounters/:id/doses',{...doseBody('D14'),savedSignatureId:savedSignerId,savedSignatureVersion:managedNurse.body.updatedAt})
        assert.equal(signedDose.statusCode,200);assert.equal(signedDose.body.signature,savedImage);assert.equal(signedDose.body.recordedBy,tag)
        const given28=await phCall('/encounters/:id/doses',doseBody('D28'))
        assert.equal(given28.statusCode,200);assert.equal(given28.body.followUpPayment.status,'Pending')
        assert.equal((await phCall('/encounters/:id/followup-payment',{day:'D28',priceCentavos:80000})).statusCode,400)
        assert.equal((await phCall('/encounters/:id/followup-payment',{day:'D28',priceCentavos:80000,reason:'approved price'})).statusCode,200)
        assert.equal((await phCall('/encounters/:id/doses',doseBody('D28'))).statusCode,409)
        assert.equal(await tx.payment.count({where:{encounterId:phId,followUpDay:{not:null},status:'Paid'}}),2)
        for(const suffix of ['optional-d14','optional-skip']) {
          const id=tag+'-'+suffix
          await tx.encounter.create({data:{id,registry:id+'-registry',patientId:tag,branch:'Guimba',date:today,biteDate:today,rer:true,billing:'PhilHealth',category:'III',pepEligible:true,regimen:'ID',day14Workflow:'optional',vaccine:'PVRV',brand:'Bioshoot',wound:{},history:{},tt:{},erig:{},progress:{}}})
          for(const day of ['D0','D3','D7']) await tx.dose.create({data:{id:id+'-'+day,encounterId:id,day,date:today,dose:'0.1 mL × 2 sites ID',animalStatus:'Alive',vaccinator:'Synthetic Staff',branch:'Guimba'}})
          const day=suffix==='optional-d14'?'D14':'D28'
          const first=await phCall('/encounters/:id/doses',{...doseBody(day),animalStatus:''},id)
          assert.equal(first.statusCode,200);assert.equal(first.body.followUpPayment.status,'Pending')
          assert.equal((await phCall('/encounters/:id/followup-payment',{day,priceCentavos:75000},id)).statusCode,200)
          assert.equal((await phCall('/encounters/:id/doses',doseBody(day),id)).statusCode,409)
          assert.equal(await tx.dose.count({where:{encounterId:id,day:'D14'}}),day==='D14'?1:0)
        }
        console.log('Optional Day 14 and direct Day 21/28 payment and recording: PASS')
        for(const resolution of ['unpaid','paid']) {
          const id=tag+'-legacy-'+resolution, oldId=id+'-old-payment'
          await tx.encounter.create({data:{id,registry:id+'-registry',patientId:tag,branch:'Guimba',date:today,rer:true,billing:'Walk-in',category:'II',pepEligible:true,regimen:'ID',vaccine:'PVRV',brand:'Bioshoot',wound:{},history:{},tt:{},erig:{},progress:{}}})
          for(const day of ['D0','D3']) await tx.dose.create({data:{id:id+'-'+day,encounterId:id,day,date:today,dose:'0.1 mL × 2 sites ID',animalStatus:'Alive',vaccinator:'Synthetic Staff',branch:'Guimba'}})
          await tx.payment.create({data:{id:oldId,encounterId:id,registry:id+'-registry',patient:'Synthetic',branch:'Guimba',date:today,service:'Anti-rabies vaccine',classification:'Walk-in',amount:750,status:'Paid',txn:id+'-old-txn'}})
          const given=await phCall('/encounters/:id/doses',doseBody('D7'),id)
          assert.equal(given.statusCode,200);assert.equal(given.body.billingNeedsReview,true);assert.equal(given.body.followUpPayment.status,'Review')
          assert.equal((await phCall('/encounters/:id/followup-payment',{day:'D7',priceCentavos:75000},id)).statusCode,409)
          const decision={day:'D7',resolution,paymentId:resolution==='paid'?oldId:undefined,reason:'Synthetic audit'}
          assert.equal((await phCall('/encounters/:id/followup-review',decision,id,{...user,role:'Nurse'})).statusCode,403)
          const reviewed=await phCall('/encounters/:id/followup-review',decision,id)
          assert.equal(reviewed.statusCode,200)
          assert.equal(reviewed.body.payment.status,resolution==='paid'?'Paid':'Pending')
          if(resolution==='unpaid') assert.equal((await phCall('/encounters/:id/followup-payment',{day:'D7',priceCentavos:75000},id)).statusCode,200)
          assert.equal(await tx.payment.count({where:{encounterId:id,followUpDay:'D7'}}),1)
          assert.equal(await tx.auditLog.count({where:{record:id+'-registry · D7',action:'Follow-up billing reviewed'}}),1)
        }
        console.log('Unlinked legacy payments require audited Admin review: PASS')
        const staffBefore=await tx.staffSignature.findUniqueOrThrow({where:{id:savedSignerId}})
        const replacedNurse=await call(ops,'POST','/staff-signatures',{}, {...signaturePayload,id:savedSignerId,image:newerImage,expectedUpdatedAt:staffBefore.updatedAt.toISOString(),reason:'Test replacement'})
        assert.equal(replacedNurse.statusCode,200)
        assert.equal((await tx.dose.findUniqueOrThrow({where:{id:phId+'-D14'}})).signature,savedImage)
        await assert.rejects(()=>staffResolver(tx,savedSignerId,'Nurse','Synthetic Staff','Guimba',staffBefore.updatedAt.toISOString()))
        assert.equal((await staffResolver(tx,savedSignerId,'Nurse','Synthetic Staff','Guimba',replacedNurse.body.updatedAt)).image,newerImage)
        const selfActor={...user,role:'Nurse',employeeId,allBranches:false,branchName:'Guimba'}
        assert.equal((await call(ops,'GET','/my-signature',{}, {},user)).statusCode,403)
        assert.equal((await call(ops,'GET','/my-signature',{}, {},{...selfActor,employeeId:null})).statusCode,403)
        const selfView=await call(ops,'GET','/my-signature',{}, {},selfActor)
        assert.equal(selfView.body.signature.image,newerImage)
        assert.equal((await call(ops,'POST','/my-signature',{}, {image:savedImage,method:'upload',employeeId:'another-person'},selfActor)).statusCode,400)
        assert.equal((await call(ops,'POST','/my-signature',{}, {image:savedImage,method:'upload',expectedUpdatedAt:staffBefore.updatedAt.toISOString(),reason:'Outdated'},selfActor)).statusCode,409)
        const selfReplace=await call(ops,'POST','/my-signature',{}, {image:savedImage,method:'upload',expectedUpdatedAt:selfView.body.signature.updatedAt,reason:'New signature'},selfActor)
        assert.equal(selfReplace.statusCode,200)
        assert.equal((await tx.dose.findUniqueOrThrow({where:{id:phId+'-D14'}})).signature,savedImage)
        assert.equal(await tx.auditLog.count({where:{userId:tag,action:'Own signature updated',record:'Synthetic Staff'}}),1)
        await tx.staffSignature.update({where:{id:savedSignerId},data:{active:false}})
        assert.equal((await call(ops,'POST','/my-signature',{}, {image:newerImage,method:'upload',expectedUpdatedAt:selfReplace.body.signature.updatedAt,reason:'Test'},selfActor)).statusCode,409)
        const newNurseId=tag+'-self-nurse'
        await tx.employee.create({data:{id:newNurseId,name:'Synthetic Self Nurse',branch:'Baloc',position:'Nurse',role:'Nurse',rate:850}})
        const newActor={...selfActor,employeeId:newNurseId}
        assert.equal((await call(ops,'GET','/my-signature',{}, {},newActor)).body.signature,null)
        assert.equal((await call(ops,'POST','/my-signature',{}, {image:savedImage,method:'upload'},newActor)).statusCode,200)
        assert.equal((await tx.staffSignature.findFirst({where:{employeeId:newNurseId}})).name,'Synthetic Self Nurse')
        console.log('Nurse self-service ownership, audit, version, revocation and record snapshot: PASS')
        console.log('Saved nurse signature snapshot survives later replacement: PASS')
        console.log('PhilHealth follow-up: separate cash payment for each dose, duplicate and editable-price checks: PASS')
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
main().catch(e => { console.error('Smoke test failed:',e.name,e.code || '', e.message); if(e.name==='AssertionError') console.error(e.stack); process.exitCode=1 })
