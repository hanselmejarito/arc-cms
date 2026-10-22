import { createHash, randomBytes } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import argon2 from 'argon2'
import { prisma } from './prisma.js'
import { ALL_BRANCH_ROLES, canPage } from './clinical.js'

export const COOKIE = 'arc_session'

export type AuthedUser = {
  id: string
  name: string
  email: string
  role: string
  branchName: string | null
  employeeId: string | null
  allBranches: boolean
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser
      sessionId?: string
    }
  }
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
    maxAge: remember ? 7 * 24 * 3600 * 1000 : 12 * 3600 * 1000,
    path: '/'
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE]
  if (!token) return res.status(401).json({ error: 'Sign in required' })
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  })
  if (!session || session.expiresAt < new Date() || session.user.status !== 'Active') {
    return res.status(401).json({ error: 'Session expired. Sign in again.' })
  }
  req.sessionId = session.id
  req.user = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role: session.user.role,
    branchName: session.user.branchName,
    employeeId: session.user.employeeId,
    allBranches: ALL_BRANCH_ROLES.includes(session.user.role)
  }
  next()
}

export function requirePage(page: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' })
    if (!canPage(req.user.role, page)) return res.status(403).json({ error: 'Walang access ang role na ito sa module na ito' })
    next()
  }
}

export function requireAny(...pages: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in required' })
    if (!pages.some(p => canPage(req.user!.role, p))) {
      return res.status(403).json({ error: 'Walang access ang role na ito sa module na ito' })
    }
    next()
  }
}

export function canAccessBranch(user: AuthedUser, branch: string) {
  if (user.allBranches) return true
  return user.branchName === branch
}

export function servicingBranch(e: { branch: string; transferredTo?: string | null }) {
  return e.transferredTo || e.branch
}
