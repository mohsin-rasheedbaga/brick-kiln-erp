/**
 * Kilns IPC handlers.
 * Channels:
 *   - kilns:list        -> Kiln[]
 *   - kilns:get         -> Kiln
 *   - kilns:create      -> Kiln
 *   - kilns:update      -> Kiln
 *   - kilns:set-status  -> { success: true }
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, wrap, type IpcResult } from '../utils/ipc';

export interface Kiln {
  id: string;
  name: string;
  code: string;
  capacity: number | null;
  status: string;
  notes: string | null;
  is_active: boolean;
}

const VALID_STATUSES = ['empty', 'loading', 'loaded', 'firing', 'ready', 'unloading', 'completed'];

function rowToKiln(row: any): Kiln {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    capacity: row.capacity,
    status: row.status,
    notes: row.notes,
    is_active: !!row.is_active,
  };
}

export function registerKilnHandlers(): void {
  ipcMain.handle('kilns:list', async (_evt, args: { token: string; includeInactive?: boolean }): Promise<IpcResult<Kiln[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const sql = args.includeInactive ? 'SELECT * FROM kilns ORDER BY name' : 'SELECT * FROM kilns WHERE is_active = 1 ORDER BY name';
      return all<any>(db, sql).map(rowToKiln);
    })();
  });

  ipcMain.handle('kilns:get', async (_evt, args: { token: string; id: string }): Promise<IpcResult<Kiln | null>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const row = get<any>(db, 'SELECT * FROM kilns WHERE id = ?', args.id);
      return row ? rowToKiln(row) : null;
    })();
  });

  ipcMain.handle('kilns:create', async (_evt, args: {
    token: string; name: string; code: string; capacity?: number; notes?: string;
  }): Promise<IpcResult<Kiln>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('kilns.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage kilns.');
      }
      const name = args.name?.trim();
      const code = args.code?.trim().toUpperCase();
      if (!name) throw new Error('Kiln name is required.');
      if (!code) throw new Error('Kiln code is required.');
      const capacity = args.capacity !== undefined ? Number(args.capacity) : null;
      if (capacity !== null && (!Number.isInteger(capacity) || capacity <= 0)) {
        throw new Error('Capacity must be a positive integer.');
      }

      const db = getDb();
      const dup = get<{ id: string }>(db, 'SELECT id FROM kilns WHERE name = ? OR code = ?', name, code);
      if (dup) throw new Error('A kiln with this name or code already exists.');

      const id = `kiln-${uuidv4()}`;
      transaction(db, () => {
        run(db, `INSERT INTO kilns (id, name, code, capacity, status, notes, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 'empty', ?, 1, datetime('now'), datetime('now'))`,
          id, name, code, capacity, args.notes ?? null);
        audit({ userId: session.userId, username: session.username, action: 'create', module: 'kilns', entityId: id, entityType: 'kiln', description: `Created kiln ${name}` });
      });
      const row = get<any>(db, 'SELECT * FROM kilns WHERE id = ?', id);
      return rowToKiln(row!);
    })();
  });

  ipcMain.handle('kilns:update', async (_evt, args: {
    token: string; id: string; name?: string; code?: string; capacity?: number; notes?: string;
  }): Promise<IpcResult<Kiln>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('kilns.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage kilns.');
      }
      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM kilns WHERE id = ?', args.id);
      if (!existing) throw new Error('Kiln not found.');

      const updates: string[] = [];
      const params: any[] = [];
      if (args.name !== undefined) { updates.push('name = ?'); params.push(args.name.trim()); }
      if (args.code !== undefined) { updates.push('code = ?'); params.push(args.code.trim().toUpperCase()); }
      if (args.capacity !== undefined) {
        const v = args.capacity !== null ? Number(args.capacity) : null;
        if (v !== null && (!Number.isInteger(v) || v <= 0)) throw new Error('Capacity must be a positive integer.');
        updates.push('capacity = ?'); params.push(v);
      }
      if (args.notes !== undefined) { updates.push('notes = ?'); params.push(args.notes || null); }
      if (updates.length === 0) throw new Error('No fields to update.');
      updates.push("updated_at = datetime('now')");
      params.push(args.id);

      transaction(db, () => {
        run(db, `UPDATE kilns SET ${updates.join(', ')} WHERE id = ?`, ...params);
        audit({ userId: session.userId, username: session.username, action: 'update', module: 'kilns', entityId: args.id, entityType: 'kiln', description: `Updated kiln ${existing.name}` });
      });
      const row = get<any>(db, 'SELECT * FROM kilns WHERE id = ?', args.id);
      return rowToKiln(row!);
    })();
  });

  ipcMain.handle('kilns:set-status', async (_evt, args: { token: string; id: string; status: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('kilns.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage kilns.');
      }
      if (!VALID_STATUSES.includes(args.status)) throw new Error('Invalid kiln status.');
      const db = getDb();
      const existing = get<{ name: string }>(db, 'SELECT name FROM kilns WHERE id = ?', args.id);
      if (!existing) throw new Error('Kiln not found.');

      transaction(db, () => {
        run(db, "UPDATE kilns SET status = ?, updated_at = datetime('now') WHERE id = ?", args.status, args.id);
        audit({ userId: session.userId, username: session.username, action: 'status_change', module: 'kilns', entityId: args.id, entityType: 'kiln', description: `Set kiln ${existing.name} status to ${args.status}` });
      });
      return { success: true } as const;
    })();
  });
}
