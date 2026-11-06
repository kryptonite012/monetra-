import type { Request } from 'express';
import { db, type Db } from '../../db/knex';
import { logger } from '../../lib/logger';

export interface AuditEntry {
  action: string;
  userId?: string | null;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  req?: Request;
}

/** Client network details used by audit and login-activity records. */
export function clientInfo(req?: Request): { ip: string | null; userAgent: string | null } {
  if (!req) return { ip: null, userAgent: null };
  const ua = req.get('user-agent');
  return { ip: req.ip ?? null, userAgent: ua ? ua.slice(0, 512) : null };
}

/**
 * Appends an entry to the immutable audit log. Audit failures are logged
 * but never break the user-facing operation that triggered them.
 */
export async function audit(entry: AuditEntry, conn: Db = db): Promise<void> {
  const { ip, userAgent } = clientInfo(entry.req);
  try {
    await conn('audit_logs').insert({
      user_id: entry.userId ?? entry.req?.user?.id ?? null,
      actor_id: entry.actorId ?? entry.req?.user?.id ?? entry.userId ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      ip,
      user_agent: userAgent,
      request_id: entry.req?.id ? String(entry.req.id) : null,
      metadata: JSON.stringify(entry.metadata ?? {}),
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'failed to write audit log');
  }
}
