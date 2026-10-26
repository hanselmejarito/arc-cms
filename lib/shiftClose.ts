import type { Branch, InventoryLine, PrismaClient } from '@prisma/client'
import { addDays, clinicDate } from './clinical.js'
import { nextId } from './ids.js'

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export async function closeShiftOnce(tx: Tx, branchRow: Pick<Branch, 'name' | 'night'>, lines: InventoryLine[], signature: string) {
  const movements = await tx.movement.findMany({ where: { branch: branchRow.name } })
  const ledger = []
  const inventory = []
  for (const x of lines) {
    ledger.push(await tx.ledgerRow.create({
      data: {
        id: await nextId(tx.ledgerRow, 'LED-', 4),
        stockId: x.id,
        item: x.item,
        branch: branchRow.name,
        date: x.date,
        shift: x.shift,
        begin: x.begin,
        received: x.received,
        batch: x.received ? x.batch : '',
        used: x.used,
        stock: x.stock,
        remarks: movements.filter(m => m.item === x.item && m.date === x.date && m.ref.startsWith('less')).map(m => m.ref).join(', '),
        signature
      }
    }))
    const nextNight = x.shift === 'MS' && branchRow.night
    inventory.push(await tx.inventoryLine.update({
      where: { id: x.id },
      data: {
        begin: x.stock,
        received: 0,
        used: 0,
        shift: nextNight ? 'NS' : 'MS',
        date: nextNight ? x.date : addDays(x.date, 1)
      }
    }))
  }
  const closing = lines[0]?.shift || 'MS'
  return { ledger, inventory, closing, toNight: closing === 'MS' && branchRow.night }
}

export async function catchUpBranch(tx: Tx, branchName: string, signature = 'System') {
  const branchRow = await tx.branch.findUnique({ where: { name: branchName } })
  if (!branchRow) return 0
  const today = clinicDate()
  let closed = 0
  for (let i = 0; i < 62; i++) {
    const ls = await tx.inventoryLine.findMany({ where: { branch: branchName } })
    const stale = ls.filter(x => x.date < today)
    if (!stale.length) break
    await closeShiftOnce(tx, branchRow, stale, signature)
    closed++
  }
  return closed
}
