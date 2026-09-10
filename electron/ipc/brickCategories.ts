/**
 * Brick Categories IPC handlers.
 * Channels:
 *   - brick-categories:list        -> BrickCategory[]
 *   - brick-categories:create      -> BrickCategory
 *   - brick-categories:update      -> BrickCategory
 *   - brick-categories:set-active  -> { success: true }
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, wrap, type IpcResult } from '../utils/ipc';

export interface BrickCategory {
  id: string;
  name: string;
  code: string;
  description: string | null;
  default_selling_rate: number;
  is_active: boolean;
  sort_order: number;
  current_stock?: number;          // optional: from stock table
}

function rowToCat(row: any): BrickCategory {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    default_selling_rate: row.default_selling_rate,
    is_active: !!row.is_active,
    sort_order: row.sort_order,
    current_stock: row.current_stock,
  };
}

export function registerBrickCategoryHandlers(): void {
  ipcMain.handle('brick-categories:list', async (_evt, args: { token: string; includeInactive?: boolean; includeStock?: boolean }): Promise<IpcResult<BrickCategory[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const where = args.includeInactive ? '' : 'WHERE c.is_active = 1';
      const stockJoin = args.includeStock ? 'LEFT JOIN stock s ON s.category_id = c.id' : '';
      const stockCol  = args.includeStock ? ', s.quantity AS current_stock' : '';
      const rows = all<any>(db, `SELECT c.*${stockCol} FROM brick_categories c ${stockJoin} ${where} ORDER BY c.sort_order, c.name`);
      return rows.map(rowToCat);
    })();
  });

  ipcMain.handle('brick-categories:create', async (_evt, args: {
    token: string; name: string; code: string; description?: string;
    defaultSellingRate?: number; sortOrder?: number;
  }): Promise<IpcResult<BrickCategory>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage brick categories.');
      }
      const name = args.name?.trim();
      const code = args.code?.trim().toUpperCase();
      if (!name) throw new Error('Category name is required.');
      if (!code) throw new Error('Category code is required.');
      const rate = Number(args.defaultSellingRate ?? 0);
      if (isNaN(rate) || rate < 0) throw new Error('Default selling rate must be a non-negative number.');

      const db = getDb();
      const dup = get<{ id: string }>(db, 'SELECT id FROM brick_categories WHERE name = ? OR code = ?', name, code);
      if (dup) throw new Error('A category with this name or code already exists.');

      const id = `cat-${uuidv4()}`;
      transaction(db, () => {
        run(db, `INSERT INTO brick_categories (id, name, code, description, default_selling_rate, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`,
          id, name, code, args.description ?? null, rate, args.sortOrder ?? 100);
        audit({ userId: session.userId, username: session.username, action: 'create', module: 'brick_categories', entityId: id, entityType: 'brick_category', description: `Created brick category ${name}` });
      });
      const row = get<any>(db, 'SELECT * FROM brick_categories WHERE id = ?', id);
      return rowToCat(row!);
    })();
  });

  ipcMain.handle('brick-categories:update', async (_evt, args: {
    token: string; id: string; name?: string; code?: string; description?: string;
    defaultSellingRate?: number; sortOrder?: number;
  }): Promise<IpcResult<BrickCategory>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage brick categories.');
      }
      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM brick_categories WHERE id = ?', args.id);
      if (!existing) throw new Error('Category not found.');

      const updates: string[] = [];
      const params: any[] = [];
      if (args.name !== undefined) { updates.push('name = ?'); params.push(args.name.trim()); }
      if (args.code !== undefined) { updates.push('code = ?'); params.push(args.code.trim().toUpperCase()); }
      if (args.description !== undefined) { updates.push('description = ?'); params.push(args.description || null); }
      if (args.defaultSellingRate !== undefined) {
        const v = Number(args.defaultSellingRate);
        if (isNaN(v) || v < 0) throw new Error('Selling rate must be a non-negative number.');
        updates.push('default_selling_rate = ?'); params.push(v);
      }
      if (args.sortOrder !== undefined) { updates.push('sort_order = ?'); params.push(args.sortOrder); }
      if (updates.length === 0) throw new Error('No fields to update.');
      updates.push("updated_at = datetime('now')");
      params.push(args.id);

      transaction(db, () => {
        run(db, `UPDATE brick_categories SET ${updates.join(', ')} WHERE id = ?`, ...params);
        audit({ userId: session.userId, username: session.username, action: 'update', module: 'brick_categories', entityId: args.id, entityType: 'brick_category', description: `Updated brick category ${existing.name}` });
      });
      const row = get<any>(db, 'SELECT * FROM brick_categories WHERE id = ?', args.id);
      return rowToCat(row!);
    })();
  });

  ipcMain.handle('brick-categories:set-active', async (_evt, args: { token: string; id: string; active: boolean }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage brick categories.');
      }
      const db = getDb();
      transaction(db, () => {
        run(db, "UPDATE brick_categories SET is_active = ?, updated_at = datetime('now') WHERE id = ?", args.active ? 1 : 0, args.id);
        audit({ userId: session.userId, username: session.username, action: args.active ? 'enable' : 'disable', module: 'brick_categories', entityId: args.id, entityType: 'brick_category', description: `${args.active ? 'Activated' : 'Deactivated'} brick category` });
      });
      return { success: true } as const;
    })();
  });
}
