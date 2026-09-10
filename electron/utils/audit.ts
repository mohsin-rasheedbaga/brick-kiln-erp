/**
 * Audit logger - records all significant actions to the audit_log table.
 */

import { getDb, run } from '../database/connection';
import log from 'electron-log';

export interface AuditEntry {
  userId?: string;
  username?: string;
  action: string;
  module?: string;
  entityId?: string;
  entityType?: string;
  description?: string;
  oldValues?: any;
  newValues?: any;
  ipAddress?: string;
  userAgent?: string;
}

export function audit(entry: AuditEntry): void {
  try {
    const db = getDb();
    run(
      db,
      `INSERT INTO audit_log
        (timestamp, user_id, username, action, module, entity_id, entity_type,
         description, old_values, new_values, ip_address, user_agent)
       VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.userId ?? null,
      entry.username ?? null,
      entry.action,
      entry.module ?? null,
      entry.entityId ?? null,
      entry.entityType ?? null,
      entry.description ?? null,
      entry.oldValues ? JSON.stringify(entry.oldValues) : null,
      entry.newValues ? JSON.stringify(entry.newValues) : null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null
    );
  } catch (err) {
    // Audit logging must never crash the main flow
    log.error('[audit] Failed to record audit entry:', err);
  }
}
