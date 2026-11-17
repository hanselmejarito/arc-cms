import type { AuthedUser } from './auth.js'
import { prisma } from './prisma.js'

// Temporary staff may use a patient only when that patient belongs to, or has
// an encounter or treatment at, the branch of the currently open duty.
export async function temporaryPatientAllowed(user: AuthedUser, patientId: string): Promise<boolean> {
  if (!user.strictBranchScope) return true
  if (!user.branchName) return false
  const branch = user.branchName
  const [patient, encounter, treatment] = await Promise.all([
    prisma.patient.findFirst({ where: { id: patientId, branch }, select: { id: true } }),
    prisma.encounter.findFirst({ where: { patientId, OR: [{ branch }, { transferredTo: branch }] }, select: { id: true } }),
    prisma.otherTreatment.findFirst({ where: { patientId, branch }, select: { id: true } })
  ])
  return !!(patient || encounter || treatment)
}
