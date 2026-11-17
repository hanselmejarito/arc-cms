import type { Branch, Prisma } from '@prisma/client'

export async function branchNightAt(db: Pick<Prisma.TransactionClient,'branchSchedule'>, branch: Pick<Branch,'name'|'night'>, date: string): Promise<boolean> {
  if (process.env.TEMPORARY_BRANCH_ENABLED !== 'true') return branch.night
  const schedule=await db.branchSchedule.findFirst({where:{branchName:branch.name,effectiveFrom:{lte:date}},orderBy:{effectiveFrom:'desc'}})
  return schedule?.nightEnabled??branch.night
}
