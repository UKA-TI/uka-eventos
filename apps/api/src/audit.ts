import type { Prisma } from './generated/prisma/client.js';
import { prisma } from './database.js';

export interface AuditEntry {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  eventId?: string;
  details?: Prisma.InputJsonValue;
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({ data: entry });
}
