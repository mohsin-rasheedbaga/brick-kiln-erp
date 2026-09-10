/**
 * Audit log IPC handlers.
 * Channels:
 *   - audit:list  -> paginated audit log entries with filters
 *   - audit:stats -> basic counts by action / module
 */

import { ipcMain } from 'electron';
import { getDb, get, all } from '../database/connection';
import { getSession } from '../utils/session';
import { ok, wrap, type IpcResult } from '../utils/ipc';

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  user_id: string | null;
  username: string | null;
  action: string;
  module: string | null;
  entity_id: string | null;
  entity_type: string | null;
  description: string | null;
}

interface ListArgs {
  token: string;
  from?: string;
  to?: string;
  userId?: string;
  action?: string;
  module?: string;
  limit?: number;
  offset?: number;
}

export function registerAuditHandlers(): void {
  ipcMain.handle('audit:list', async (_evt, args: ListArgs): Promise<IpcResult<{ items: AuditLogEntry[]; total: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('system.audit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view audit logs.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.from) { where.push('timestamp >= ?'); params.push(args.from); }
      if (args.to)   { where.push('timestamp <= ?'); params.push(args.to); }
      if (args.userId) { where.push('user_id = ?'); params.push(args.userId); }
      if (args.action) { where.push('action = ?'); params.push(args.action); }
      if (args.module) { where.push('module = ?'); params.push(args.module); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 100, 1000);
      const offset = Math.max(args.offset ?? 0, 0);
      const countRow = get<{ c: number }>(db, `SELECT COUNT(*) as c FROM audit_log ${whereSql}`, ...params);
      const rows = all<any>(db, `SELECT * FROM audit_log ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      return {
        items: rows as AuditLogEntry[],
        total: countRow?.c ?? 0,
      };
    })();
  });

  ipcMain.handle('audit:stats', async (_evt, args: { token: string; days?: number }): Promise<IpcResult<{ byAction: Array<{ action: string; count: number }>; byModule: Array<{ module: string; count: number }>; total: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('system.audit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view audit logs.');
      }
      const db = getDb();
      const days = args.days ?? 30;
      const since = new Date(Date.now() - days * 86400 * 1000).toISOString();
      const byAction = all<{ action: string; count: number }>(db, `SELECT action, COUNT(*) as count FROM audit_log WHERE timestamp >= ? GROUP BY action ORDER BY count DESC`, since);
      const byModule = all<{ module: string; count: number }>(db, `SELECT COALESCE(module,'(none)') as module, COUNT(*) as count FROM audit_log WHERE timestamp >= ? GROUP BY module ORDER BY count DESC`, since);
      const totalRow = get<{ c: number }>(db, 'SELECT COUNT(*) as c FROM audit_log WHERE timestamp >= ?', since);
      return {
        byAction,
        byModule,
        total: totalRow?.c ?? 0,
      };
    })();
  });
}
