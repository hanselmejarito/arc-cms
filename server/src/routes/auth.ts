import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../prisma.js'
import { COOKIE, cookieOpts, hashToken, newToken, requireAuth, verifyPassword } from '../auth.js'

export const authRouter = Router()

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email or username is required'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().optional()
})

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid login' })
  const email = parsed.data.email.trim().toLowerCase()
  const user = await prisma.user.findFirst({
    where: { OR: [{ email }, { email: parsed.data.email.trim() }], status: 'Active' }
  })
  if (!user || !(await verifyPassword(user.passwordHash, parsed.data.password))) {
    return res.status(401).json({ error: 'Mali ang email o password' })
  }
  const token = newToken()
  const remember = !!parsed.data.remember
  const maxAge = remember ? 7 * 24 * 3600 * 1000 : 12 * 3600 * 1000
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + maxAge),
      userAgent: req.get('user-agent')?.slice(0, 180) || ''
    }
  })
  res.cookie(COOKIE, token, cookieOpts(remember))
  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      branchName: user.branchName,
      employeeId: user.employeeId,
      allBranches: user.role === 'Admin'
    }
  })
})

authRouter.post('/logout', requireAuth, async (req, res) => {
  if (req.sessionId) await prisma.session.delete({ where: { id: req.sessionId } }).catch(() => {})
  res.clearCookie(COOKIE, { path: '/' })
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})
