import { createHash, randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import { prisma } from './prisma.js'
import { ALL_BRANCH_ROLES, canPage } from './clinical.js'
import type { Guard } from './router.js'

export const COOKIE = 'arc_session'
export { canPage }

export type AuthedUser = {
  id: string
  name: string
  email: string
  role: string
  branchName: string | null
  employeeId: string | null
  allBranches: boolean
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const newToken = () => randomBytes(32).toString('hex')
export const hashPassword = (password: string) => argon2.hash(password)
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password)

export function cookieOpts(remember: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    ...(remember ? { maxAge: 7 * 24 * 3600 * 1000 } : {})
  }
}

export function toUser(row: { id: string; name: string; email: string; role: string; branchName: string | null; employeeId: string | null }): AuthedUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    branchName: row.branchName,
    employeeId: row.employeeId,
    allBranches: ALL_BRANCH_ROLES.includes(row.role)
  }
}

export async function loadSession(token?: string) {
  if (!token) return null
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  })
  if (!session || session.expiresAt < new Date() || session.user.status !== 'Active') return null
  return { id: session.id, user: toUser(session.user) }
}

const mark = (guard: Guard) => Object.assign(() => {}, { _guard: guard })
export const requireAuth = mark({ auth: true })
export const requirePage = (page: string) => mark({ auth: true, page })
export const requireAny = (...pages: string[]) => mark({ auth: true, any: pages })

export function canAccessBranch(user: AuthedUser, branch: string) {
  if (user.allBranches) return true
  return user.branchName === branch
}

export function servicingBranch(e: { branch: string; transferredTo?: string | null }) {
  return e.transferredTo || e.branch
}
