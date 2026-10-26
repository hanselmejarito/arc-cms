import type { PrismaClient } from '@prisma/client'
import { BRANCH_CODES, pad } from './clinical.js'

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

async function maxRegistrySeq(tx: Tx, branchName: string, year: string, code: string) {
  const prefix = `ARC${code}-${year}-`
  const rows = await tx.encounter.findMany({
    where: { branch: branchName, registry: { startsWith: prefix } },
    select: { registry: true }
  })
  let max = 0
  for (const r of rows) {
    const n = Number(String(r.registry).slice(prefix.length))
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

export async function issueRegistry(tx: Tx, branchName: string, date: string) {
  const code = BRANCH_CODES[branchName]
  if (!code) throw new Error('The official 3-letter code for ' + branchName + ' must be confirmed before issuing a registry number')
  const year = date.slice(2, 4)
  const key = `${branchName}:${year}`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
  const next = (await maxRegistrySeq(tx, branchName, year, code)) + 1
  await tx.registryCounter.upsert({
    where: { branchName_year: { branchName, year } },
    create: { branchName, year, lastSeq: next },
    update: { lastSeq: next }
  })
  return `ARC${code}-${year}-${pad(next, 4)}`
}

export async function issueTxn(tx: Tx, branchName: string, date: string) {
  const code = BRANCH_CODES[branchName]
  if (!code) throw new Error('The official 3-letter code for ' + branchName + ' must be confirmed before issuing a transaction number')
  const year = date.slice(2, 4)
  const prefix = `TXN${code}-${year}-`
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'txn:' + branchName + ':' + year}))`
  const rows = await tx.payment.findMany({
    where: { branch: branchName, txn: { startsWith: prefix } },
    select: { txn: true }
  })
  let max = 0
  for (const r of rows) {
    const n = Number(String(r.txn).slice(prefix.length))
    if (Number.isFinite(n) && n > max) max = n
  }
  return prefix + pad(max + 1, 4)
}

export async function peekRegistry(tx: Tx, branchName: string, date: string) {
  const code = BRANCH_CODES[branchName]
  if (!code) return ''
  const year = date.slice(2, 4)
  const next = (await maxRegistrySeq(tx, branchName, year, code)) + 1
  return `ARC${code}-${year}-${pad(next, 4)}`
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
