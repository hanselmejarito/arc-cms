import type { Prisma } from '@prisma/client'
import { clinicDate } from './clinical.js'
import { dutyAccessBranch } from './dutyAccess.js'

// Resolve a nurse's current clinical branch from open attendance, not merely
// from their home branch. Conflicting open duties are intentionally excluded.
export async function nursesByDuty(db: Pick<Prisma.TransactionClient, 'employee' | 'attendance'>) {
  const nurses=await db.employee.findMany({where:{role:'Nurse',status:'Active'},include:{users:{where:{status:'Active'},select:{id:true}}},orderBy:{name:'asc'}})
  const ids=nurses.flatMap(n=>n.users.map(u=>u.id))
  const rows=ids.length?await db.attendance.findMany({where:{userId:{in:ids},OR:[{clockIn:{not:''},clockOut:''},{nightClockIn:{not:''},nightClockOut:''}]}}):[]
  return nurses.map(n=>{
    const userIds=new Set(n.users.map(u=>u.id))
    const open=rows.filter(r=>userIds.has(r.userId)&&((!!r.clockIn&&!r.clockOut)||(!!r.nightClockIn&&!r.nightClockOut)))
    const branches=open.map(r=>dutyAccessBranch(n.branch,r))
    const unique=new Set(branches)
    const dutyBranch=open.some(r=>r.date!==clinicDate())||branches.some(b=>!b)||unique.size>1?null:(branches[0]||n.branch)
    return { ...n, dutyBranch }
  })
}
