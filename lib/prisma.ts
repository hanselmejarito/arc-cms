import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    // Avoid logging query arguments containing patient data or signatures.
    log: []
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
