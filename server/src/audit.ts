import type { Request } from 'express'
import { prisma } from './prisma.js'
import { clinicDate } from './clinical.js'

export async function audit(req: Request, input: {
  module: string
  action: string
  record?: string
  oldValue?: string
  newValue?: string
  branch?: string
}) {
  const user = req.user
  const time = new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
  await prisma.auditLog.create({
    data: {
      userId: user?.id,
      userName: user ? `${user.name} (${user.role})` : 'System',
      module: input.module,
      action: input.action,
      record: input.record || '—',
      oldValue: input.oldValue || '—',
      newValue: input.newValue || 'Saved',
      time: `${clinicDate()} · ${time}`,
      branch: input.branch || user?.branchName || 'Guimba',
      device: req.get('user-agent')?.slice(0, 180) || ''
    }
  })
}

export function publicAudit(row: {
  id: string
  userName: string
  module: string
  action: string
  record: string
  oldValue: string
  newValue: string
  time: string
  branch: string
  device: string
}) {
  return {
    id: row.id,
    user: row.userName,
    module: row.module,
    action: row.action,
    record: row.record,
    old: row.oldValue,
    new: row.newValue,
    time: row.time,
    branch: row.branch,
    device: row.device
  }
}
