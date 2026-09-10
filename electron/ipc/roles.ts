/**
 * Roles & permissions IPC handlers.
 * Channels:
 *   - roles:list               -> Role[]
 *   - roles:get                -> Role with permission codes
 *   - roles:create             -> new role
 *   - roles:update             -> update role name/description
 *   - roles:delete             -> delete role (only if no users assigned)
 *   - roles:list-permissions   -> all permissions (grouped by module)
 *   - roles:set-permissions    -> replace role's permissions
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, wrap, type IpcResult } from '../utils/ipc';

export interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  user_count?: number;        // optional: count of users with this role
  permission_codes?: string[];
}

export interface Permission {
  id: string;
  code: string;
  name: string;
  module: string;
  description: string | null;
}

export function registerRoleHandlers(): void {
  ipcMain.handle('roles:list', async (_evt, args: { token: string; includeInactive?: boolean }): Promise<IpcResult<Role[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');

      const db = getDb();
      const where = args.includeInactive ? '' : 'WHERE r.is_active = 1';
      const rows = all<any>(
        db,
        `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
         FROM roles r ${where} ORDER BY r.name ASC`
      );
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        is_system: !!row.is_system,
        is_active: !!row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        user_count: row.user_count ?? 0,
      }));
    })();
  });

  ipcMain.handle('roles:get', async (_evt, args: { token: string; id: string }): Promise<IpcResult<Role | null>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const row = get<any>(db, 'SELECT * FROM roles WHERE id = ?', args.id);
      if (!row) return null;
      const permRows = all<{ code: string }>(db,
        `SELECT p.code FROM role_permissions rp JOIN permissions p ON rp.permission_id = p.id WHERE rp.role_id = ?`, args.id);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        is_system: !!row.is_system,
        is_active: !!row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        permission_codes: permRows.map((p) => p.code),
      };
    })();
  });

  ipcMain.handle('roles:list-permissions', async (_evt, args: { token: string }): Promise<IpcResult<Permission[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      return all<Permission>(db, 'SELECT * FROM permissions ORDER BY module, name');
    })();
  });

  ipcMain.handle('roles:create', async (_evt, args: { token: string; name: string; description?: string }): Promise<IpcResult<Role>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('roles.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage roles.');
      }

      const name = args.name?.trim();
      if (!name) throw new Error('Role name is required.');
      if (name.length < 2) throw new Error('Role name must be at least 2 characters.');

      const db = getDb();
      const existing = get<{ id: string }>(db, 'SELECT id FROM roles WHERE name = ?', name);
      if (existing) throw new Error('A role with this name already exists.');

      const id = `role-${uuidv4()}`;
      transaction(db, () => {
        run(db, `INSERT INTO roles (id, name, description, is_system, is_active, created_at, updated_at) VALUES (?, ?, ?, 0, 1, datetime('now'), datetime('now'))`, id, name, args.description ?? null);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'roles',
          entityId: id,
          entityType: 'role',
          description: `Created role ${name}`,
        });
      });

      const row = get<any>(db, 'SELECT * FROM roles WHERE id = ?', id);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        is_system: !!row.is_system,
        is_active: !!row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        permission_codes: [],
      };
    })();
  });

  ipcMain.handle('roles:update', async (_evt, args: { token: string; id: string; name?: string; description?: string; isActive?: boolean }): Promise<IpcResult<Role>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('roles.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage roles.');
      }

      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM roles WHERE id = ?', args.id);
      if (!existing) throw new Error('Role not found.');

      const updates: string[] = [];
      const params: any[] = [];

      if (args.name !== undefined) {
        const v = args.name.trim();
        if (!v) throw new Error('Role name cannot be empty.');
        const dup = get<{ id: string }>(db, 'SELECT id FROM roles WHERE name = ? AND id != ?', v, args.id);
        if (dup) throw new Error('Another role already uses this name.');
        updates.push('name = ?'); params.push(v);
      }
      if (args.description !== undefined) { updates.push('description = ?'); params.push(args.description || null); }
      if (args.isActive !== undefined) { updates.push('is_active = ?'); params.push(args.isActive ? 1 : 0); }

      if (updates.length === 0) throw new Error('No fields to update.');
      updates.push("updated_at = datetime('now')");
      params.push(args.id);

      transaction(db, () => {
        run(db, `UPDATE roles SET ${updates.join(', ')} WHERE id = ?`, ...params);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'update',
          module: 'roles',
          entityId: args.id,
          entityType: 'role',
          description: `Updated role ${existing.name}`,
          oldValues: { name: existing.name, description: existing.description },
          newValues: args,
        });
      });

      const row = get<any>(db, 'SELECT * FROM roles WHERE id = ?', args.id);
      const permRows = all<{ code: string }>(db, `SELECT p.code FROM role_permissions rp JOIN permissions p ON rp.permission_id = p.id WHERE rp.role_id = ?`, args.id);
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        is_system: !!row.is_system,
        is_active: !!row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        permission_codes: permRows.map((p) => p.code),
      };
    })();
  });

  ipcMain.handle('roles:delete', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('roles.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage roles.');
      }

      const db = getDb();
      const existing = get<{ name: string; is_system: number }>(db, 'SELECT name, is_system FROM roles WHERE id = ?', args.id);
      if (!existing) throw new Error('Role not found.');
      if (existing.is_system) throw new Error('System roles cannot be deleted.');

      const userCount = get<{ c: number }>(db, 'SELECT COUNT(*) as c FROM users WHERE role_id = ?', args.id);
      if (userCount && userCount.c > 0) {
        throw new Error(`Cannot delete role: ${userCount.c} user(s) are still assigned to it. Reassign them first.`);
      }

      transaction(db, () => {
        run(db, 'DELETE FROM role_permissions WHERE role_id = ?', args.id);
        run(db, 'DELETE FROM roles WHERE id = ?', args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'delete',
          module: 'roles',
          entityId: args.id,
          entityType: 'role',
          description: `Deleted role ${existing.name}`,
        });
      });
      return { success: true } as const;
    })();
  });

  ipcMain.handle('roles:set-permissions', async (_evt, args: { token: string; roleId: string; permissionIds: string[] }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('roles.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage role permissions.');
      }

      const db = getDb();
      const role = get<{ id: string; name: string }>(db, 'SELECT id, name FROM roles WHERE id = ?', args.roleId);
      if (!role) throw new Error('Role not found.');

      transaction(db, () => {
        // Delete all existing role-permission links
        run(db, 'DELETE FROM role_permissions WHERE role_id = ?', args.roleId);

        // Insert new ones
        const stmt = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
        for (const permId of args.permissionIds) {
          stmt.run(args.roleId, permId);
        }

        audit({
          userId: session.userId,
          username: session.username,
          action: 'permission_change',
          module: 'roles',
          entityId: args.roleId,
          entityType: 'role',
          description: `Set ${args.permissionIds.length} permissions for role ${role.name}`,
          newValues: { permission_ids: args.permissionIds },
        });
      });
      return { success: true } as const;
    })();
  });
}
