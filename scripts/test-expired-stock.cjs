// Local-only integration smoke test. All synthetic records are rolled back.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { PrismaClient } = require('@prisma/client')
// Start legacy-path assertions with the feature off; gated scenarios enable it explicitly.
process.loadEnvFile('.env'); process.env.TEMPORARY_BRANCH_ENABLED='false'

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
        const deps = { '../registry.js':{issueRefundReference:async()=> 'RFDGUI-26-'+randomUUID()}, '../router.js':router, '../auth.js':auth, '../prisma.js':{prisma:db}, '../clinical.js':clinical, '../nurseDuty.js':nurseDuty, '../branchSchedules.js':branchSchedules, '../attendanceCorrection.js':load(path.join('lib','attendanceCorrection.ts'),{}), '../../src/payrollEligibility.js':load(path.join('src','payrollEligibility.js'),{}), '../signatureInput.js':load(path.join('lib','signatureInput.ts'),{}),
          '../otherTreatment.js':domain, '../temporaryPatientAccess.js':{temporaryPatientAllowed:async()=>true}, '../shiftClose.js':{catchUpBranch:async()=>{}}, '../map.js':map,
          '../inventory.js':{ITEM_NAMES:['Flu'],ADJUST_REASONS:['Correction','Expired'],itemMeta:()=>({})},
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
        await tx.inventoryLine.create({data:{id:tag+'-stock',item:'Flu',type:'Test',branch:'Guimba',batch:tag,expiry:'2001-01-01',stock:3,begin:3,date:today,shift:'MS',unit:'vials'}})
        const payload={item:'Flu',branch:'Guimba',date:today,shift:'MS',quantity:2,line:tag+'-stock',reason:'Expired',direction:'Increase',remark:'Disposed by authorized handler'}
        let result=await call(ops,'POST','/inventory/adjust',{}, {...payload,line:''})
        assert.equal(result.statusCode,400,'missing batch rejected')
        await tx.inventoryLine.create({data:{id:tag+'-future',item:'Flu',type:'Test',branch:'Guimba',batch:tag+'-future',expiry:'2099-01-01',stock:3,begin:3,date:today,shift:'MS',unit:'vials'}})
        result=await call(ops,'POST','/inventory/adjust',{}, {...payload,line:tag+'-future'})
        assert.equal(result.statusCode,400,'unexpired batch rejected')
        result=await call(ops,'POST','/inventory/adjust',{},payload)
        assert.equal(result.statusCode,200,JSON.stringify(result.body))
        assert.equal((await tx.inventoryLine.findUniqueOrThrow({where:{id:tag+'-stock'}})).stock,1,'expired stock must decrease')
        assert.equal(result.body.movements[0].qty,-2)
        result=await call(ops,'POST','/inventory/adjust',{},payload)
        assert.equal(result.statusCode,409,'insufficient stock rejected')
        console.log('Expired stock adjustment checks passed (rolled back)')
        throw new Error('SYNTHETIC_ROLLBACK')
      }, {timeout:30000})
    } catch(e) { if(e.message!=='SYNTHETIC_ROLLBACK')throw e }
  } finally { await prisma.$disconnect() }
}
main().catch(e=>{console.error(e);process.exitCode=1})
