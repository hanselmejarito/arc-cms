import type { AuthedUser } from './auth.js'

export type Guard = { auth?: boolean; page?: string; any?: string[] }

export type ApiReq = {
  body: Record<string, unknown>
  query: Record<string, string>
  params: Record<string, string>
  cookies: Record<string, string>
  user?: AuthedUser
  sessionId?: string
  userAgent: string
  get: (name: string) => string
}

export type CookieSet = { name: string; value: string; maxAge?: number; httpOnly?: boolean; sameSite?: 'lax' | 'strict' | 'none'; secure?: boolean; path?: string }

export type ApiRes = {
  statusCode: number
  body: unknown
  cookies: CookieSet[]
  clear: string[]
  status: (n: number) => ApiRes
  json: (data: unknown) => ApiRes
  cookie: (name: string, value: string, opts?: CookieSet) => ApiRes
  clearCookie: (name: string) => ApiRes
}

export type Handler = (req: ApiReq, res: ApiRes) => unknown

export type Route = { method: string; path: string; guard: Guard; handler: Handler }

function asGuard(mw: unknown): Guard | null {
  if (mw && (typeof mw === 'object' || typeof mw === 'function') && '_guard' in mw) {
    return (mw as { _guard: Guard })._guard
  }
  return null
}

export function createRes(): ApiRes {
  const res: ApiRes = {
    statusCode: 200,
    body: undefined,
    cookies: [],
    clear: [],
    status(n) {
      res.statusCode = n
      return res
    },
    json(data) {
      res.body = data
      return res
    },
    cookie(name, value, opts) {
      res.cookies.push({ name, value, path: '/', ...opts })
      return res
    },
    clearCookie(name) {
      res.clear.push(name)
      return res
    }
  }
  return res
}

export class ApiRouter {
  routes: Route[] = []
  defaultAuth = false

  use(mw: unknown) {
    const g = asGuard(mw)
    if (g?.auth) this.defaultAuth = true
    return this
  }

  get(path: string, ...args: unknown[]) { return this.add('GET', path, args) }
  post(path: string, ...args: unknown[]) { return this.add('POST', path, args) }
  patch(path: string, ...args: unknown[]) { return this.add('PATCH', path, args) }
  delete(path: string, ...args: unknown[]) { return this.add('DELETE', path, args) }

  private add(method: string, path: string, args: unknown[]) {
    const handler = args.pop() as Handler
    let guard: Guard = { auth: this.defaultAuth }
    for (const mw of args) {
      const g = asGuard(mw)
      if (g) guard = { ...guard, ...g }
    }
    this.routes.push({ method, path, guard, handler })
    return this
  }
}

export function matchPath(pattern: string, pathname: string) {
  const pp = pattern.split('/').filter(Boolean)
  const ap = pathname.split('/').filter(Boolean)
  if (pp.length !== ap.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i])
    else if (pp[i] !== ap[i]) return null
  }
  return params
}

export function parseCookies(header: string | null) {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function parseQuery(url: URL) {
  const query: Record<string, string> = {}
  url.searchParams.forEach((v, k) => { query[k] = v })
  return query
}
