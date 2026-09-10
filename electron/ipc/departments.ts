/**
 * Department IPC handlers.
 * Channels:
 *   - departments:list        -> Department[]
 *   - departments:get          -> Department
 *   - departments:create       -> Department
 *   - departments:update       -> Department
 *   - departments:set-active   -> { success: true }
 *   - departments:delete       -> { success: true }
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, wrap, type IpcResult } from '../utils/ipc';

export interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface CreateDepartmentArgs {
  token: string;
  name: string;
  code: string;
  description?: string;
  sortOrder?: number;
}

interface UpdateDepartmentArgs {
  token: string;
  id: string;
  name?: string;
  code?: string;
  description?: string;
  sortOrder?: number;
}

function rowToDept(row: any): Department {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    is_system: !!row.is_system,
    is_active: !!row.is_active,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function registerDepartmentHandlers(): void {
  ipcMain.handle('departments:list', async (_evt, args: { token: string; includeInactive?: boolean }): Promise<IpcResult<Department[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');

      const db = getDb();
      const includeInactive = args.includeInactive ?? false;
      const sql = includeInactive
        ? 'SELECT * FROM departments ORDER BY sort_order, name'
        : 'SELECT * FROM departments WHERE is_active = 1 ORDER BY sort_order, name';
      const rows = all<any>(db, sql);
      return rows.map(rowToDept);
    })();
  });

  ipcMain.handle('departments:get', async (_evt, args: { token: string; id: string }): Promise<IpcResult<Department | null>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const row = get<any>(db, 'SELECT * FROM departments WHERE id = ?', args.id);
      return row ? rowToDept(row) : null;
    })();
  });

  ipcMain.handle('departments:create', async (_evt, args: CreateDepartmentArgs): Promise<IpcResult<Department>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');

      // Permission check
      if (!session.permissions.includes('departments.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage departments.');
      }

      // Validation
      const name = args.name?.trim();
      const code = args.code?.trim().toUpperCase();
      if (!name) throw new Error('Department name is required.');
      if (!code) throw new Error('Department code is required.');
      if (code.length > 8) throw new Error('Department code must be at most 8 characters.');

      const db = getDb();

      // Check duplicates
      const existingName = get<{ id: string }>(db, 'SELECT id FROM departments WHERE name = ?', name);
      if (existingName) throw new Error('A department with this name already exists.');
      const existingCode = get<{ id: string }>(db, 'SELECT id FROM departments WHERE code = ?', code);
      if (existingCode) throw new Error('A department with this code already exists.');

      const id = `dept-${uuidv4()}`;
      transaction(db, () => {
        run(
          db,
          `INSERT INTO departments (id, name, code, description, is_system, is_active, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 1, ?, datetime('now'), datetime('now'))`,
          id, name, code, args.description ?? null, args.sortOrder ?? 100
        );
        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'departments',
          entityId: id,
          entityType: 'department',
          description: `Created department ${name} (${code})`,
          newValues: { name, code, description: args.description },
        });
      });

      const row = get<any>(db, 'SELECT * FROM departments WHERE id = ?', id);
      return rowToDept(row!);
    })();
  });

  ipcMain.handle('departments:update', async (_evt, args: UpdateDepartmentArgs): Promise<IpcResult<Department>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('departments.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage departments.');
      }

      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM departments WHERE id = ?', args.id);
      if (!existing) throw new Error('Department not found.');

      const newName = args.name?.trim() ?? existing.name;
      const newCode = args.code?.trim().toUpperCase() ?? existing.code;
      const newDesc = args.description !== undefined ? args.description : existing.description;
      const newSort = args.sortOrder ?? existing.sort_order;

      if (!newName) throw new Error('Department name cannot be empty.');
      if (!newCode) throw new Error('Department code cannot be empty.');

      // Check duplicates (excluding self)
      const dup = get<{ id: string }>(db, 'SELECT id FROM departments WHERE (name = ? OR code = ?) AND id != ?', newName, newCode, args.id);
      if (dup) throw new Error('Another department already uses this name or code.');

      transaction(db, () => {
        run(
          db,
          `UPDATE departments SET name = ?, code = ?, description = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?`,
          newName, newCode, newDesc, newSort, args.id
        );
        audit({
          userId: session.userId,
          username: session.username,
          action: 'update',
          module: 'departments',
          entityId: args.id,
          entityType: 'department',
          description: `Updated department ${newName}`,
          oldValues: rowToDept(existing),
          newValues: { name: newName, code: newCode, description: newDesc, sortOrder: newSort },
        });
      });

      const row = get<any>(db, 'SELECT * FROM departments WHERE id = ?', args.id);
      return rowToDept(row!);
    })();
  });

  ipcMain.handle('departments:set-active', async (_evt, args: { token: string; id: string; active: boolean }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('departments.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage departments.');
      }

      const db = getDb();
      const existing = get<{ name: string; is_system: number }>(db, 'SELECT name, is_system FROM departments WHERE id = ?', args.id);
      if (!existing) throw new Error('Department not found.');

      transaction(db, () => {
        run(db, 'UPDATE departments SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', args.active ? 1 : 0, args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: args.active ? 'enable' : 'disable',
          module: 'departments',
          entityId: args.id,
          entityType: 'department',
          description: `${args.active ? 'Activated' : 'Deactivated'} department ${existing.name}`,
        });
      });
      return { success: true } as const;
    })();
  });

  ipcMain.handle('departments:delete', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('departments.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage departments.');
      }

      const db = getDb();
      const existing = get<{ name: string; is_system: number }>(db, 'SELECT name, is_system FROM departments WHERE id = ?', args.id);
      if (!existing) throw new Error('Department not found.');
      if (existing.is_system) throw new Error('System departments cannot be deleted. Disable them instead.');

      // Check for dependent records
      const workerCount = get<{ c: number }>(db, 'SELECT COUNT(*) as c FROM workers WHERE department_id = ?', args.id);
      if (workerCount && workerCount.c > 0) {
        throw new Error(`Cannot delete department: ${workerCount.c} worker(s) are still assigned to it. Reassign them first.`);
      }

      transaction(db, () => {
        run(db, 'DELETE FROM departments WHERE id = ?', args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'delete',
          module: 'departments',
          entityId: args.id,
          entityType: 'department',
          description: `Deleted department ${existing.name}`,
        });
      });
      return { success: true } as const;
    })();
  });
}
