import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { issueRefundReference } from '../lib/registry'
process.loadEnvFile('.env')
for(const key of ['DATABASE_URL','DIRECT_URL']) {
 const value=process.env[key]
 if(!value||!['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname)) throw new Error('Local database required')
}
const db=new PrismaClient()
try {
 await db.$transaction(async tx=>{
  const a=await issueRefundReference(tx,'Talugtug','2099-01-01')
  await tx.refund.create({data:{id:'synthetic-'+randomUUID(),reference:a,patient:'Synthetic',payment:'synthetic',branch:'Talugtug',amount:1,requested:'2099-01-01',status:'Pending'}})
  const b=await issueRefundReference(tx,'Talugtug','2099-01-01')
  assert.match(a,/^RFDTLG-99-\d{4,}$/)
  assert.equal(Number(b.split('-').at(-1)),Number(a.split('-').at(-1))+1)
  throw new Error('ROLLBACK_SYNTHETIC')
 })
} catch(e) {if(!(e instanceof Error)||e.message!=='ROLLBACK_SYNTHETIC')throw e}
finally {await db.$disconnect()}
console.log('Refund reference sequence test passed (rolled back)')
