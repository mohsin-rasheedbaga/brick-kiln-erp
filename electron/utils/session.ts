/**
 * Session manager - tracks active user sessions in the renderer.
 *
 * The current session is held in-memory in the main process. The renderer
 * receives a session token on login which it stores in localStorage and
 * sends with every IPC call so the main process can verify it.
 *
 * For Phase 1 simplicity, the session is also persisted in the sessions
 * table so that a refresh of the renderer does not force re-login.
 */

import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { getDb, get, all, run } from '../database/connection';
import log from 'electron-log';

export interface Session {
  token: string;
  userId: string;
  username: string;
  fullName: string;
  roleId: string;
  roleName: string;
  departmentId?: string;
  permissions: string[];          // list of permission codes
  expiresAt: string;              // ISO timestamp
}

// In-memory cache of active sessions (token -> Session)
const activeSessions = new Map<string, Session>();

const SESSION_TTL_MINUTES = 8 * 60; // 8 hours default

/**
 * Generate a new session for a user.
 */
export function createSession(user: {
  id: string;
  username: string;
  full_name: string;
  role_id: string;
  department_id?: string;
}, permissions: string[]): Session {
  const token = uuidv4() + '.' + uuidv4();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();

  // Get role name first (so it's available when constructing the session object)
  const db = getDb();
  const role = get<{ name: string }>(db, 'SELECT name FROM roles WHERE id = ?', user.role_id);
  const roleName = role?.name ?? 'Unknown';

  const session: Session = {
    token,
    userId: user.id,
    username: user.username,
    fullName: user.full_name,
    roleId: user.role_id,
    roleName,
    departmentId: user.department_id,
    permissions,
    expiresAt,
  };

  // Persist to DB
  const tokenHash = bcrypt.hashSync(token, 10);
  run(
    db,
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
    uuidv4(),
    user.id,
    tokenHash,
    expiresAt
  );

  // Cache in memory
  activeSessions.set(token, session);
  return session;
}

/**
 * Get the session for a given token. Returns undefined if expired or revoked.
 */
export function getSession(token: string | undefined | null): Session | undefined {
  if (!token) return undefined;

  const session = activeSessions.get(token);
  if (!session) return undefined;

  // Check expiry
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    activeSessions.delete(token);
    return undefined;
  }

  return session;
}

/**
 * Revoke (logout) a session.
 */
export function revokeSession(token: string): void {
  const session = activeSessions.get(token);
  if (session) {
    const db = getDb();
    run(db, "UPDATE sessions SET revoked_at = datetime('now') WHERE token_hash = ?", token);
    activeSessions.delete(token);
    log.info(`[session] Revoked session for user ${session.username}`);
  }
}

/**
 * Check whether the session has the given permission.
 */
export function hasPermission(token: string, permissionCode: string): boolean {
  const session = getSession(token);
  if (!session) return false;
  // Super Admin bypass
  if (session.roleId === 'role-super-admin') return true;
  return session.permissions.includes(permissionCode);
}

/**
 * Check whether the session has ANY of the given permissions.
 */
export function hasAnyPermission(token: string, permissionCodes: string[]): boolean {
  const session = getSession(token);
  if (!session) return false;
  if (session.roleId === 'role-super-admin') return true;
  return permissionCodes.some((code) => session.permissions.includes(code));
}

/**
 * Load the permission codes for a role (used at login).
 */
export function loadRolePermissions(roleId: string): string[] {
  const db = getDb();
  const rows = all<{ code: string }>(
    db,
    `SELECT p.code
     FROM role_permissions rp
     JOIN permissions p ON rp.permission_id = p.id
     WHERE rp.role_id = ?`,
    roleId
  );
  return rows.map((r) => r.code);
}

/**
 * Load permissions for a user.
 * If user has custom_permissions set (JSON array), use those instead of role permissions.
 * Otherwise, fall back to role permissions.
 */
export function loadUserPermissions(userId: string, roleId: string): string[] {
  const db = getDb();
  const userRow = get<{ custom_permissions: string | null }>(
    db,
    'SELECT custom_permissions FROM users WHERE id = ?',
    userId
  );
  if (userRow?.custom_permissions) {
    try {
      const custom = JSON.parse(userRow.custom_permissions);
      if (Array.isArray(custom) && custom.length > 0) {
        return custom;
      }
    } catch (e) {
      // Fall through to role permissions
    }
  }
  return loadRolePermissions(roleId);
}
