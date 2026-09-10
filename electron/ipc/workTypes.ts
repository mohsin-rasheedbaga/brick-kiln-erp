/**
 * Work Types IPC handlers.
 * Channels:
 *   - work-types:list        -> WorkType[]
 *   - work-types:create      -> WorkType
 *   - work-types:update      -> WorkType
 *   - work-types:set-active  -> { success: true }
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, wrap, type IpcResult } from '../utils/ipc';

export interface WorkType {
  id: string;
  name: string;
  code: string;
  department_id: string | null;
  default_rate_per_1000: number;
  description: string | null;
  is_active: boolean;
}

function rowToWt(row: any): WorkType {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    department_id: row.department_id,
    default_rate_per_1000: row.default_rate_per_1000,
    description: row.description,
    is_active: !!row.is_active,
  };
}

export function registerWorkTypeHandlers(): void {
  ipcMain.handle('work-types:list', async (_evt, args: { token: string; includeInactive?: boolean }): Promise<IpcResult<WorkType[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const sql = args.includeInactive
        ? 'SELECT * FROM work_types ORDER BY name'
        : 'SELECT * FROM work_types WHERE is_active = 1 ORDER BY name';
      return all<any>(db, sql).map(rowToWt);
    })();
  });

  ipcMain.handle('work-types:create', async (_evt, args: {
    token: string; name: string; code: string; departmentId?: string;
    defaultRatePer1000?: number; description?: string;
  }): Promise<IpcResult<WorkType>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage work types.');
      }
      const name = args.name?.trim();
      const code = args.code?.trim().toUpperCase();
      if (!name) throw new Error('Work type name is required.');
      if (!code) throw new Error('Work type code is required.');
      const rate = Number(args.defaultRatePer1000 ?? 0);
      if (isNaN(rate) || rate < 0) throw new Error('Default rate must be a non-negative number.');

      const db = getDb();
      const dup = get<{ id: string }>(db, 'SELECT id FROM work_types WHERE name = ? OR code = ?', name, code);
      if (dup) throw new Error('A work type with this name or code already exists.');

      const id = `wt-${uuidv4()}`;
      transaction(db, () => {
        run(db, `INSERT INTO work_types (id, name, code, department_id, default_rate_per_1000, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`, id, name, code, args.departmentId ?? null, rate, args.description ?? null);
        audit({ userId: session.userId, username: session.username, action: 'create', module: 'work_types', entityId: id, entityType: 'work_type', description: `Created work type ${name}` });
      });
      const row = get<any>(db, 'SELECT * FROM work_types WHERE id = ?', id);
      return rowToWt(row!);
    })();
  });

  ipcMain.handle('work-types:update', async (_evt, args: {
    token: string; id: string; name?: string; code?: string; departmentId?: string;
    defaultRatePer1000?: number; description?: string;
  }): Promise<IpcResult<WorkType>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage work types.');
      }
      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM work_types WHERE id = ?', args.id);
      if (!existing) throw new Error('Work type not found.');

      const updates: string[] = [];
      const params: any[] = [];
      if (args.name !== undefined) { updates.push('name = ?'); params.push(args.name.trim()); }
      if (args.code !== undefined) { updates.push('code = ?'); params.push(args.code.trim().toUpperCase()); }
      if (args.departmentId !== undefined) { updates.push('department_id = ?'); params.push(args.departmentId || null); }
      if (args.defaultRatePer1000 !== undefined) {
        const v = Number(args.defaultRatePer1000);
        if (isNaN(v) || v < 0) throw new Error('Rate must be a non-negative number.');
        updates.push('default_rate_per_1000 = ?'); params.push(v);
      }
      if (args.description !== undefined) { updates.push('description = ?'); params.push(args.description || null); }
      if (updates.length === 0) throw new Error('No fields to update.');
      updates.push("updated_at = datetime('now')");
      params.push(args.id);

      transaction(db, () => {
        run(db, `UPDATE work_types SET ${updates.join(', ')} WHERE id = ?`, ...params);
        audit({ userId: session.userId, username: session.username, action: 'update', module: 'work_types', entityId: args.id, entityType: 'work_type', description: `Updated work type ${existing.name}` });
      });
      const row = get<any>(db, 'SELECT * FROM work_types WHERE id = ?', args.id);
      return rowToWt(row!);
    })();
  });

  ipcMain.handle('work-types:set-active', async (_evt, args: { token: string; id: string; active: boolean }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage work types.');
      }
      const db = getDb();
      transaction(db, () => {
        run(db, "UPDATE work_types SET is_active = ?, updated_at = datetime('now') WHERE id = ?", args.active ? 1 : 0, args.id);
        audit({ userId: session.userId, username: session.username, action: args.active ? 'enable' : 'disable', module: 'work_types', entityId: args.id, entityType: 'work_type', description: `${args.active ? 'Activated' : 'Deactivated'} work type` });
      });
      return { success: true } as const;
    })();
  });
}
