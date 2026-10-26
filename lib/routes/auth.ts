import { z } from 'zod'
import { prisma } from '../prisma.js'
import { ALL_BRANCH_ROLES } from '../clinical.js'
import { COOKIE, cookieOpts, hashToken, newToken, requireAuth, toUser, verifyPassword } from '../auth.js'
import { audit } from '../audit.js'
import { ApiRouter } from '../router.js'

export const authRouter = new ApiRouter()

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
    return res.status(401).json({ error: 'Email or password is incorrect' })
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
  const authed = toUser(user)
  await audit(req, {
    module: 'Auth',
    action: 'Signed in',
    record: user.email,
    branch: user.branchName || 'Guimba',
    actor: authed
  })
  res.cookie(COOKIE, token, cookieOpts(remember))
  res.json({ user: authed })
})

authRouter.post('/logout', requireAuth, async (req, res) => {
  const user = req.user!
  await audit(req, {
    module: 'Auth',
    action: 'Signed out',
    record: user.email,
    branch: user.branchName || 'Guimba'
  })
  if (req.sessionId) await prisma.session.delete({ where: { id: req.sessionId } }).catch(() => {})
  res.clearCookie(COOKIE, { path: '/' })
  res.json({ ok: true })
})

authRouter.get('/me', async (req, res) => {
  const token = req.cookies?.[COOKIE]
  if (!token) return res.json({ user: null })
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  })
  if (!session || session.expiresAt < new Date() || session.user.status !== 'Active') {
    return res.json({ user: null })
  }
  res.json({
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      branchName: session.user.branchName,
      employeeId: session.user.employeeId,
      allBranches: ALL_BRANCH_ROLES.includes(session.user.role)
    }
  })
})
