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
  const clinical = { BRANCH_CODES: { Guimba:'GUI' }, clinicDate: () => today, canPage: () => true,
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
        for (const item of ['Influvac','Tetanus Toxoid','Hepatitis B','ERIG (serum)']) {
          await tx.inventoryLine.create({ data: { id:tag+item, item, type:'Test', branch:'Guimba', batch:tag,
            expiry:'2099-12-31', stock:3, begin:3, date:today, shift:'MS', unit:'vials' } })
        }
        const deps = { '../router.js':router, '../auth.js':auth, '../prisma.js':{prisma:db}, '../clinical.js':clinical,
          '../otherTreatment.js':domain, '../shiftClose.js':{catchUpBranch:async()=>{}}, '../map.js':map,
          '../inventory.js':{ITEM_NAMES:['Influvac'],ADJUST_REASONS:['Correction'],itemMeta:()=>({})},
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
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'Influvac'}})).stock,3)
        assert.equal((await tx.otherTreatment.findUniqueOrThrow({where:{id:a.id}})).status,'Pending')
        res = await give(a,'Influvac'); assert.equal(res.statusCode,200)
        assert.equal(res.body.treatment.brand,'Synthetic Brand')
        assert.equal(res.body.treatment.stockExpiry,'2099-12-31')
        assert.equal(res.body.treatment.administeredQuantity,0.5)
        assert.equal(res.body.treatment.administeredUnit,'mL')
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'Influvac'}})).stock,2)
        assert.equal((await give(a,'Influvac')).statusCode,409)
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
        assert.equal((await give(c,'Influvac')).statusCode,409)
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'Influvac'}})).stock,2)
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
        console.log('Standalone treatment, sales record, stock, refund, branch and RER isolation: PASS')
        throw new Error('ROLLBACK_TEST')
      }, { timeout:30000 })
    } catch (e) { if (e.message !== 'ROLLBACK_TEST') throw e }
    assert.equal(await prisma.patient.count({where:{id:tag}}),0)
    console.log('Synthetic records rolled back: PASS')
  } finally { await prisma.$disconnect() }
}
main().catch(e => { console.error('Smoke test failed:',e.name,e.code || '', e.message); process.exitCode=1 })