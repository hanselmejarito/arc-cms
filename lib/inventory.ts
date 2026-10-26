import type { InventoryLine, PrismaClient } from '@prisma/client'
import { clinicDate } from './clinical.js'
import { catchUpBranch } from './shiftClose.js'

export const ITEM_MASTER = [
  { item: 'ChiroRab', type: 'Anti-rabies vaccine · PCEC', unit: 'vials', usesPerVial: 10, threshold: 30 },
  { item: 'VaxiRab N', type: 'Anti-rabies vaccine · PCEC', unit: 'vials', usesPerVial: 10, threshold: 30 },
  { item: 'Bioshoot', type: 'Anti-rabies vaccine', unit: 'vials', usesPerVial: 5, threshold: 30 },
  { item: 'Speeda', type: 'Anti-rabies vaccine · PVRV', unit: 'vials', usesPerVial: 5, threshold: 30 },
  { item: 'Abhayrab', type: 'Anti-rabies vaccine · PVRV', unit: 'vials', usesPerVial: 5, threshold: 30 },
  { item: 'ERIG (serum)', type: 'Rabies immunoglobulin (ERIG)', unit: 'vials', usesPerVial: 0, threshold: 5 },
  { item: 'Tetanus Toxoid', type: 'Tetanus vaccine', unit: 'vials', usesPerVial: 0, threshold: 20 },
  { item: 'Influvac', type: 'Flu vaccine', unit: 'vials', usesPerVial: 0, threshold: 4 },
  { item: 'Pneumococcal', type: 'Pneumococcal vaccine', unit: 'vials', usesPerVial: 0, threshold: 3 }
] as const

export const ITEM_NAMES = ITEM_MASTER.map(m => m.item)
export const ADJUST_REASONS = ['Damaged', 'Expired', 'Missing', 'Correction', 'Transfer to other branch', 'Other'] as const
export const DOSE_USES: [string, number][] = [
  ['0.1 mL × 2 sites ID', 2],
  ['1 vial IM', 5],
  ['0.1 mL × 1 site ID', 1]
]

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export function itemMeta(item: string) {
  return ITEM_MASTER.find(m => m.item === item)
}

export function doseUses(dose: string, vaccine: string) {
  if (dose.includes('IM')) return vaccine === 'PCEC' ? 10 : 5
  return (DOSE_USES.find(d => d[0] === dose) || ['', 1])[1]
}

export function consumeLine(line: InventoryLine | null, uses = 1): { error: string } | { line: InventoryLine; vials: number; rest: number; uses: number } {
  if (!line) return { error: 'No usable stock' }
  if (line.expiry < clinicDate() || line.stock <= 0) return { error: 'No usable ' + line.item + ' stock at ' + line.branch }
  const capacity = line.usesPerVial || 0
  const total = capacity ? (line.uses || 0) + uses : 1
  const vials = capacity ? Math.floor(total / capacity) : 1
  const rest = capacity ? total % capacity : 0
  if (vials > line.stock) return { error: 'Insufficient ' + line.item + ' stock at ' + line.branch }
  return { line, vials, rest, uses }
}

export async function fifoLine(tx: Tx, item: string, branch: string, batch?: string) {
  const rows = await tx.inventoryLine.findMany({
    where: { item, branch, stock: { gt: 0 }, expiry: { gte: clinicDate() }, ...(batch ? { batch } : {}) }
  })
  return rows.sort((a, b) => a.expiry.localeCompare(b.expiry))[0] || null
}

export async function applyConsume(tx: Tx, item: string, branch: string, uses = 1, batch?: string) {
  await catchUpBranch(tx, branch)
  const line = await fifoLine(tx, item, branch, batch)
  if (!line) return { error: batch ? 'No usable ' + item + ' batch ' + batch + ' at ' + branch : 'No usable ' + item + ' stock at ' + branch } as const
  const result = consumeLine(line, uses)
  if ('error' in result) return result
  const updated = await tx.inventoryLine.update({
    where: { id: line.id },
    data: { uses: result.rest, used: line.used + result.vials, stock: line.stock - result.vials }
  })
  return { line: updated, vials: result.vials, rest: result.rest, uses }
}

export async function applyRestore(tx: Tx, item: string, branch: string, batch: string, uses = 1) {
  const line = await tx.inventoryLine.findFirst({ where: { item, branch, batch } })
  if (!line) return { error: 'Cannot reverse stock · batch ' + batch + ' not found at ' + branch } as const
  const capacity = line.usesPerVial || 0
  if (!capacity) {
    const updated = await tx.inventoryLine.update({
      where: { id: line.id },
      data: { stock: line.stock + uses, used: Math.max(0, line.used - uses) }
    })
    return { line: updated, vials: uses, uses }
  }
  let acc = line.uses || 0
  let stock = line.stock
  let used = line.used
  let left = uses
  while (left > 0) {
    if (acc >= left) {
      acc -= left
      left = 0
    } else {
      left -= acc
      acc = 0
      stock += 1
      used = Math.max(0, used - 1)
      acc = capacity
    }
  }
  const updated = await tx.inventoryLine.update({
    where: { id: line.id },
    data: { uses: acc, stock, used }
  })
  return { line: updated, vials: updated.stock - line.stock, uses }
}
