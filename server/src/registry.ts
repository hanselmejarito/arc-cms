import type { PrismaClient } from '@prisma/client'
import { BRANCH_CODES, pad } from './clinical.js'

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export async function issueRegistry(tx: Tx, branchName: string, date: string) {
  const code = BRANCH_CODES[branchName]
  if (!code) throw new Error('The official 3-letter code for ' + branchName + ' must be confirmed before issuing a registry number')
  const year = date.slice(2, 4)
  const key = `${branchName}:${year}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
  const row = await tx.registryCounter.upsert({
    where: { branchName_year: { branchName, year } },
    create: { branchName, year, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } }
  })
  return `ARC${code}-${year}-${pad(row.lastSeq, 4)}`
}

export async function peekRegistry(tx: Tx, branchName: string, date: string) {
  const code = BRANCH_CODES[branchName]
  if (!code) return ''
  const year = date.slice(2, 4)
  const row = await tx.registryCounter.findUnique({ where: { branchName_year: { branchName, year } } })
  return `ARC${code}-${year}-${pad((row?.lastSeq || 0) + 1, 4)}`
}

const TABLES = {
  Patient: '"Patient"',
  Encounter: '"Encounter"',
  Payment: '"Payment"',
  ProgressNote: '"ProgressNote"',
  Referral: '"Referral"',
  Dose: '"Dose"'
} as const

export async function nextPrefixedId(tx: Tx, table: keyof typeof TABLES, prefix: string, width = 4) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'idseq:' + table}))`
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM ${TABLES[table]} WHERE id LIKE $1`,
    prefix + '%'
  )
  let max = 0
  for (const r of rows) {
    const tail = String(r.id).slice(prefix.length)
    const n = Number(tail.replace(/\D/g, ''))
    if (Number.isFinite(n) && n > max) max = n
  }
  return prefix + pad(max + 1, width)
}
