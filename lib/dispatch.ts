import { NextRequest, NextResponse } from 'next/server'
import { COOKIE, canPage, cookieOpts, loadSession } from './auth.js'
import { createRes, matchPath, parseCookies, parseQuery, type ApiReq, type Route } from './router.js'
import { authRouter } from './routes/auth.js'
import { clinicalRouter } from './routes/clinical.js'
import { opsRouter } from './routes/ops.js'

const mounted: { prefix: string; routes: Route[] }[] = [
  { prefix: '/api/auth', routes: authRouter.routes },
  { prefix: '/api', routes: clinicalRouter.routes },
  { prefix: '/api', routes: opsRouter.routes }
]

export async function dispatch(request: NextRequest) {
  const url = new URL(request.url)
  const pathname = url.pathname
  if (request.method === 'GET' && pathname === '/api/health') {
    return NextResponse.json({ ok: true })
  }

  let hit: { route: Route; params: Record<string, string> } | null = null
  for (const { prefix, routes } of mounted) {
    for (const route of routes) {
      if (route.method !== request.method) continue
      const params = matchPath(prefix + (route.path.startsWith('/') ? route.path : '/' + route.path), pathname)
      if (params) {
        hit = { route, params }
        break
      }
    }
    if (hit) break
  }
  if (!hit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: Record<string, unknown> = {}
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.json().catch(() => ({}))
  }

  const cookies = parseCookies(request.headers.get('cookie'))
  const userAgent = request.headers.get('user-agent')?.slice(0, 180) || ''
  const session = await loadSession(cookies[COOKIE])
  const req: ApiReq = {
    body,
    query: parseQuery(url),
    params: hit.params,
    cookies,
    user: session?.user,
    sessionId: session?.id,
    userAgent,
    get: (name) => (name.toLowerCase() === 'user-agent' ? userAgent : '')
  }

  if (hit.route.guard.auth) {
    if (!req.user) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
    if (hit.route.guard.page && !canPage(req.user.role, hit.route.guard.page)) {
      return NextResponse.json({ error: 'This role cannot access this module' }, { status: 403 })
    }
    if (hit.route.guard.any && !hit.route.guard.any.some(p => canPage(req.user!.role, p))) {
      return NextResponse.json({ error: 'This role cannot access this module' }, { status: 403 })
    }
  }

  const res = createRes()
  try {
    await hit.route.handler(req, res)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 })
  }

  const out = NextResponse.json(res.body ?? {}, { status: res.statusCode || 200 })
  for (const c of res.cookies) {
    out.cookies.set(c.name, c.value, {
      httpOnly: c.httpOnly !== false,
      sameSite: c.sameSite || 'lax',
      secure: !!c.secure,
      path: c.path || '/',
      ...(c.maxAge ? { maxAge: Math.round(c.maxAge / 1000) } : {})
    })
  }
  for (const name of res.clear) out.cookies.set(name, '', { path: '/', maxAge: 0 })
  return out
}

export { cookieOpts }
