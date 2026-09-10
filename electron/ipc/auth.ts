/**
 * Auth IPC handlers.
 * Channels:
 *   - auth:login            -> { token, user } | error
 *   - auth:logout           -> void
 *   - auth:me               -> current session user
 *   - auth:change-password  -> change own password
 *   - auth:check-permission -> boolean
 *   - auth:has-any-permission -> boolean
 */

import { ipcMain, BrowserWindow } from 'electron';
import bcrypt from 'bcryptjs';
import { getDb, get, run, transaction } from '../database/connection';
import { createSession, revokeSession, getSession, hasPermission, hasAnyPermission, loadRolePermissions } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, err, wrap, type IpcResult } from '../utils/ipc';

interface LoginArgs {
  username: string;
  password: string;
}

interface LoginResponse {
  token: string;
  user: {
    id: string;
    username: string;
    fullName: string;
    roleId: string;
    roleName: string;
    departmentId?: string;
    mustChangePassword: boolean;
    permissions: string[];
  };
}

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:login', async (_evt, args: LoginArgs): Promise<IpcResult<LoginResponse>> => {
    return wrap(async () => {
      const { username, password } = args;
      if (!username || !password) {
        throw new Error('Username and password are required.');
      }

      const db = getDb();
      const user = get<{
        id: string;
        username: string;
        password_hash: string;
        full_name: string;
        role_id: string;
        department_id: string | null;
        is_active: number;
        must_change_password: number;
        failed_login_attempts: number;
        locked_until: string | null;
      }>(db, 'SELECT * FROM users WHERE username = ?', username);

      if (!user) {
        audit({ action: 'login', module: 'auth', description: `Failed login (unknown user): ${username}` });
        throw new Error('Invalid username or password.');
      }

      if (!user.is_active) {
        throw new Error('This account has been disabled. Please contact an administrator.');
      }

      // Check lock
      if (user.locked_until) {
        const lockedUntil = new Date(user.locked_until).getTime();
        if (Date.now() < lockedUntil) {
          const minutes = Math.ceil((lockedUntil - Date.now()) / 60000);
          throw new Error(`Account is temporarily locked. Try again in ${minutes} minute(s).`);
        }
      }

      // Verify password
      const passwordOk = bcrypt.compareSync(password, user.password_hash);
      if (!passwordOk) {
        const attempts = (user.failed_login_attempts || 0) + 1;
        const locked = attempts >= MAX_LOGIN_ATTEMPTS;
        run(
          db,
          `UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?`,
          attempts,
          locked ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000).toISOString() : null,
          user.id
        );
        audit({ action: 'login', module: 'auth', description: `Failed login attempt ${attempts} for ${username}` });
        if (locked) {
          throw new Error(`Too many failed attempts. Account locked for ${LOCK_MINUTES} minutes.`);
        }
        throw new Error('Invalid username or password.');
      }

      // Reset failed attempts
      run(
        db,
        `UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?`,
        user.id
      );

      // Load permissions
      const permissions = loadRolePermissions(user.role_id);

      // Create session
      const session = createSession({
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role_id: user.role_id,
        department_id: user.department_id || undefined,
      }, permissions);

      // Audit
      const role = get<{ name: string }>(db, 'SELECT name FROM roles WHERE id = ?', user.role_id);
      audit({
        userId: user.id,
        username: user.username,
        action: 'login',
        module: 'auth',
        description: `User ${user.username} logged in`,
      });

      return {
        token: session.token,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          roleId: user.role_id,
          roleName: role?.name ?? 'Unknown',
          departmentId: user.department_id || undefined,
          mustChangePassword: !!user.must_change_password,
          permissions,
        },
      } satisfies LoginResponse;
    })();
  });

  ipcMain.handle('auth:logout', async (_evt, args: { token: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (session) {
        audit({
          userId: session.userId,
          username: session.username,
          action: 'logout',
          module: 'auth',
          description: `User ${session.username} logged out`,
        });
        revokeSession(args.token);
      }
      return { success: true } as const;
    })();
  });

  ipcMain.handle('auth:me', async (_evt, args: { token: string }): Promise<IpcResult<LoginResponse['user'] | null>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) return null;
      const db = getDb();
      const role = get<{ name: string }>(db, 'SELECT name FROM roles WHERE id = ?', session.roleId);
      return {
        id: session.userId,
        username: session.username,
        fullName: session.fullName,
        roleId: session.roleId,
        roleName: role?.name ?? 'Unknown',
        departmentId: session.departmentId,
        mustChangePassword: false,
        permissions: session.permissions,
      };
    })();
  });

  ipcMain.handle('auth:change-password', async (_evt, args: { token: string; currentPassword: string; newPassword: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired. Please log in again.');

      if (!args.newPassword || args.newPassword.length < 6) {
        throw new Error('New password must be at least 6 characters long.');
      }

      const db = getDb();
      const user = get<{ password_hash: string }>(db, 'SELECT password_hash FROM users WHERE id = ?', session.userId);
      if (!user) throw new Error('User not found.');

      if (!bcrypt.compareSync(args.currentPassword, user.password_hash)) {
        throw new Error('Current password is incorrect.');
      }

      const newHash = bcrypt.hashSync(args.newPassword, 10);
      transaction(db, () => {
        run(db, 'UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime(\'now\') WHERE id = ?', newHash, session.userId);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'password_change',
          module: 'auth',
          description: `User ${session.username} changed their password`,
        });
      });

      return { success: true } as const;
    })();
  });

  ipcMain.handle('auth:check-permission', async (_evt, args: { token: string; permission: string }): Promise<IpcResult<boolean>> => {
    return wrap(async () => hasPermission(args.token, args.permission))();
  });

  ipcMain.handle('auth:has-any-permission', async (_evt, args: { token: string; permissions: string[] }): Promise<IpcResult<boolean>> => {
    return wrap(async () => hasAnyPermission(args.token, args.permissions))();
  });
}
