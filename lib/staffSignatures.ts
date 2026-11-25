import type { Prisma } from '@prisma/client'
import { nursesByDuty } from './nurseDuty.js'

export async function resolveStaffSignature(tx: Prisma.TransactionClient, id: string, kind: 'Doctor' | 'Nurse', name: string, branch: string, expectedVersion: string) {
  await tx.$queryRaw`SELECT "id" FROM "StaffSignature" WHERE "id" = ${id} FOR SHARE`
  const signer=await tx.staffSignature.findUnique({where:{id}})
  if(!signer||!signer.active||signer.kind!==kind)throw new Error('The saved signature is no longer available. Reload and try again.')
  if(!expectedVersion||signer.updatedAt.toISOString()!==expectedVersion)throw new Error('The saved signature changed. Reload and try again.')
  if(kind==='Doctor'){
    if(signer.name!==name)throw new Error('The selected doctor does not match the saved signature.')
  }else{
    const employee=signer.employeeId?await tx.employee.findUnique({where:{id:signer.employeeId}}):null
    const atBranch=process.env.TEMPORARY_BRANCH_ENABLED==='true' ? (await nursesByDuty(tx)).some(n=>n.id===employee?.id&&n.dutyBranch===branch) : employee?.branch===branch
    if(!employee||employee.status!=='Active'||employee.role!=='Nurse'||!atBranch||employee.name!==name)throw new Error('The selected nurse does not match the active signature for this branch.')
  }
  return {image:signer.image,method:signer.method,id:signer.id}
}

export async function auditSavedSignatureUse(tx: Prisma.TransactionClient, actor: { id: string; name: string; role?: string }, signerId: string, record: string, branch: string, device = '') {
  const signer = await tx.staffSignature.findUnique({ where: { id: signerId }, select: { name: true, kind: true } })
  const now = new Date()
  const time = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) + ' · ' + now.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })
  await tx.auditLog.create({data:{userId:actor.id,userName:actor.role?actor.name+' ('+actor.role+')':actor.name,module:'Signature',action:'Saved staff signature used',record,branch,oldValue:'',newValue:signer ? `Signer: ${signer.name} (${signer.kind}) · ID: ${signerId}` : 'Saved signer '+signerId,time,device}})
}
