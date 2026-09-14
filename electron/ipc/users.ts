/**
 * Users IPC handlers.
 * Channels:
 *   - users:list            -> paginated users
 *   - users:get             -> single user (without password)
 *   - users:create          -> create user with hashed password
 *   - users:update          -> update user (without password)
 *   - users:set-active      -> enable/disable user
 *   - users:reset-password  -> reset user password (admin only)
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, wrap, type IpcResult } from '../utils/ipc';

export interface User {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role_id: string;
  role_name?: string;
  department_id: string | null;
  department_name?: string;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    role_id: row.role_id,
    role_name: row.role_name,
    department_id: row.department_id,
    department_name: row.department_name,
    is_active: !!row.is_active,
    must_change_password: !!row.must_change_password,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const USER_SELECT = `
  SELECT u.*, r.name AS role_name, d.name AS department_name
  FROM users u
  LEFT JOIN roles r ON u.role_id = r.id
  LEFT JOIN departments d ON u.department_id = d.id
`;

export function registerUserHandlers(): void {
  ipcMain.handle('users:list', async (_evt, args: { token: string; search?: string; includeInactive?: boolean }): Promise<IpcResult<User[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('users.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage users.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.search) {
        where.push('(u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)');
        const q = `%${args.search}%`;
        params.push(q, q, q);
      }
      if (!args.includeInactive) where.push('u.is_active = 1');
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = all<any>(db, `${USER_SELECT} ${whereSql} ORDER BY u.username ASC`, ...params);
      return rows.map(rowToUser);
    })();
  });

  ipcMain.handle('users:get', async (_evt, args: { token: string; id: string }): Promise<IpcResult<User | null>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('users.manage') && session.userId !== args.id && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view this user.');
      }
      const db = getDb();
      const row = get<any>(db, `${USER_SELECT} WHERE u.id = ?`, args.id);
      return row ? rowToUser(row) : null;
    })();
  });

  ipcMain.handle('users:create', async (_evt, args: {
    token: string;
    username: string;
    password: string;
    full_name: string;
    email?: string;
    phone?: string;
    role_id: string;
    department_id?: string;
    must_change_password?: boolean;
    custom_permissions?: string[];  // JSON array of permission codes; overrides role permissions if set
  }): Promise<IpcResult<User>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('users.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to create users.');
      }

      const username = args.username?.trim();
      if (!username) throw new Error('Username is required.');
      if (username.length < 3) throw new Error('Username must be at least 3 characters.');

      if (!args.password || args.password.length < 6) {
        throw new Error('Password must be at least 6 characters.');
      }
      if (!args.full_name?.trim()) throw new Error('Full name is required.');
      if (!args.role_id) throw new Error('Role is required.');

      const db = getDb();
      const existing = get<{ id: string }>(db, 'SELECT id FROM users WHERE username = ?', username);
      if (existing) throw new Error('Username is already taken.');

      const role = get<{ id: string }>(db, 'SELECT id FROM roles WHERE id = ?', args.role_id);
      if (!role) throw new Error('Selected role does not exist.');

      if (args.department_id) {
        const dept = get<{ id: string }>(db, 'SELECT id FROM departments WHERE id = ?', args.department_id);
        if (!dept) throw new Error('Selected department does not exist.');
      }

      const id = uuidv4();
      const passwordHash = bcrypt.hashSync(args.password, 10);

      transaction(db, () => {
        const customPerms = args.custom_permissions && args.custom_permissions.length > 0
          ? JSON.stringify(args.custom_permissions) : null;
        run(
          db,
          `INSERT INTO users (id, username, password_hash, full_name, email, phone, role_id, department_id,
                             is_active, must_change_password, custom_permissions, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, datetime('now'), datetime('now'))`,
          id, username, passwordHash, args.full_name.trim(), args.email ?? null, args.phone ?? null,
          args.role_id, args.department_id ?? null, args.must_change_password ? 1 : 0, customPerms, session.userId
        );
        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'users',
          entityId: id,
          entityType: 'user',
          description: `Created user ${username} with role ${args.role_id}`,
          newValues: { username, full_name: args.full_name, role_id: args.role_id },
        });
      });

      const row = get<any>(db, `${USER_SELECT} WHERE u.id = ?`, id);
      return rowToUser(row!);
    })();
  });

  ipcMain.handle('users:update', async (_evt, args: {
    token: string;
    id: string;
    full_name?: string;
    email?: string;
    phone?: string;
    role_id?: string;
    department_id?: string;
    must_change_password?: boolean;
    custom_permissions?: string[];  // set to [] to clear (use role defaults), or pass codes to override
  }): Promise<IpcResult<User>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const isSelf = session.userId === args.id;
      if (!session.permissions.includes('users.manage') && !isSelf && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to edit users.');
      }
      // Self can only edit own profile fields, not role
      if (isSelf && args.role_id && args.role_id !== session.roleId) {
        throw new Error('You cannot change your own role.');
      }

      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM users WHERE id = ?', args.id);
      if (!existing) throw new Error('User not found.');

      const updates: string[] = [];
      const params: any[] = [];

      if (args.full_name !== undefined) {
        const v = args.full_name.trim();
        if (!v) throw new Error('Full name cannot be empty.');
        updates.push('full_name = ?'); params.push(v);
      }
      if (args.email !== undefined) { updates.push('email = ?'); params.push(args.email || null); }
      if (args.phone !== undefined) { updates.push('phone = ?'); params.push(args.phone || null); }
      if (args.role_id !== undefined) {
        const role = get<{ id: string }>(db, 'SELECT id FROM roles WHERE id = ?', args.role_id);
        if (!role) throw new Error('Selected role does not exist.');
        updates.push('role_id = ?'); params.push(args.role_id);
      }
      if (args.department_id !== undefined) {
        if (args.department_id) {
          const dept = get<{ id: string }>(db, 'SELECT id FROM departments WHERE id = ?', args.department_id);
          if (!dept) throw new Error('Selected department does not exist.');
        }
        updates.push('department_id = ?'); params.push(args.department_id || null);
      }
      if (args.must_change_password !== undefined) {
        updates.push('must_change_password = ?'); params.push(args.must_change_password ? 1 : 0);
      }
      if (args.custom_permissions !== undefined) {
        const customPerms = args.custom_permissions.length > 0
          ? JSON.stringify(args.custom_permissions) : null;
        updates.push('custom_permissions = ?'); params.push(customPerms);
      }

      if (updates.length === 0) throw new Error('No fields to update.');
      updates.push("updated_at = datetime('now')");
      params.push(args.id);

      transaction(db, () => {
        run(db, `UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...params);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'update',
          module: 'users',
          entityId: args.id,
          entityType: 'user',
          description: `Updated user ${existing.username}`,
          oldValues: { full_name: existing.full_name, role_id: existing.role_id, department_id: existing.department_id },
          newValues: args,
        });
      });

      const row = get<any>(db, `${USER_SELECT} WHERE u.id = ?`, args.id);
      return rowToUser(row!);
    })();
  });

  ipcMain.handle('users:set-active', async (_evt, args: { token: string; id: string; active: boolean }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('users.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage users.');
      }
      if (session.userId === args.id && !args.active) {
        throw new Error('You cannot disable your own account.');
      }

      const db = getDb();
      const existing = get<{ username: string }>(db, 'SELECT username FROM users WHERE id = ?', args.id);
      if (!existing) throw new Error('User not found.');

      transaction(db, () => {
        run(db, "UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?", args.active ? 1 : 0, args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: args.active ? 'enable' : 'disable',
          module: 'users',
          entityId: args.id,
          entityType: 'user',
          description: `${args.active ? 'Enabled' : 'Disabled'} user ${existing.username}`,
        });
      });
      return { success: true } as const;
    })();
  });

  ipcMain.handle('users:reset-password', async (_evt, args: { token: string; id: string; newPassword: string; mustChange?: boolean }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('users.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to reset passwords.');
      }
      if (!args.newPassword || args.newPassword.length < 6) {
        throw new Error('Password must be at least 6 characters.');
      }

      const db = getDb();
      const existing = get<{ username: string }>(db, 'SELECT username FROM users WHERE id = ?', args.id);
      if (!existing) throw new Error('User not found.');

      const passwordHash = bcrypt.hashSync(args.newPassword, 10);
      transaction(db, () => {
        run(db, "UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = datetime('now') WHERE id = ?",
          passwordHash, args.mustChange !== false ? 1 : 0, args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'password_reset',
          module: 'users',
          entityId: args.id,
          entityType: 'user',
          description: `Reset password for user ${existing.username}`,
        });
      });
      return { success: true } as const;
    })();
  });

  // Delete user — only if not self and not the default admin
  ipcMain.handle('users:delete', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('users.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to delete users.');
      }
      if (session.userId === args.id) {
        throw new Error('You cannot delete your own account.');
      }

      const db = getDb();
      const existing = get<{ username: string; role_id: string }>(db, 'SELECT username, role_id FROM users WHERE id = ?', args.id);
      if (!existing) throw new Error('User not found.');

      // Prevent deleting the default admin
      if (existing.username === 'admin') {
        throw new Error('The default admin account cannot be deleted. Disable it instead.');
      }

      transaction(db, () => {
        // Clean up: revoke sessions, delete audit log references (keep audit records but null out user_id)
        run(db, 'UPDATE sessions SET revoked_at = datetime(\'now\') WHERE user_id = ?', args.id);
        run(db, 'UPDATE audit_log SET user_id = NULL WHERE user_id = ?', args.id);
        // Delete the user
        run(db, 'DELETE FROM users WHERE id = ?', args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'delete',
          module: 'users',
          entityId: args.id,
          entityType: 'user',
          description: `Deleted user ${existing.username}`,
        });
      });
      return { success: true } as const;
    })();
  });
}
