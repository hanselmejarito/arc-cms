import { pad } from './clinical.js'

type Finder = { findMany: (args: { select: { id: true } }) => Promise<{ id: string }[]> }

export async function nextId(delegate: Finder, prefix: string, width = 4) {
  const rows = await delegate.findMany({ select: { id: true } })
  let max = 0
  for (const r of rows) {
    if (!String(r.id).startsWith(prefix)) continue
    const n = Number(String(r.id).slice(prefix.length).replace(/\D/g, ''))
    if (Number.isFinite(n) && n > max) max = n
  }
  return prefix + pad(max + 1, width)
}
