/**
 * Settings IPC handlers.
 * Channels:
 *   - settings:get     -> Settings object
 *   - settings:update  -> updated Settings
 */

import { ipcMain } from 'electron';
import { getDb, get, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, wrap, type IpcResult } from '../utils/ipc';

export interface Settings {
  kiln_name: string;
  address: string;
  phone: string;
  email: string | null;
  currency: string;
  currency_symbol: string;
  date_format: string;
  timezone: string;
  logo_path: string | null;
  allow_negative_stock: boolean;
  allow_overpayment: boolean;
  auto_logout_minutes: number;
  auto_backup_enabled: boolean;
  auto_backup_interval_hours: number;
  backup_location: string | null;
  auto_update_enabled: boolean;
  update_channel: string;
  last_update_check: string | null;
  app_version: string;
  schema_version: string;
}

function rowToSettings(row: any): Settings {
  return {
    kiln_name: row.kiln_name,
    address: row.address,
    phone: row.phone,
    email: row.email,
    currency: row.currency,
    currency_symbol: row.currency_symbol,
    date_format: row.date_format,
    timezone: row.timezone,
    logo_path: row.logo_path,
    allow_negative_stock: !!row.allow_negative_stock,
    allow_overpayment: !!row.allow_overpayment,
    auto_logout_minutes: row.auto_logout_minutes,
    auto_backup_enabled: !!row.auto_backup_enabled,
    auto_backup_interval_hours: row.auto_backup_interval_hours,
    backup_location: row.backup_location,
    auto_update_enabled: !!row.auto_update_enabled,
    update_channel: row.update_channel,
    last_update_check: row.last_update_check,
    app_version: row.app_version ?? '1.0.0',
    schema_version: row.schema_version ?? '1.0.0',
  };
}

const SETTINGS_COLUMNS = [
  'kiln_name', 'address', 'phone', 'email', 'currency', 'currency_symbol',
  'date_format', 'timezone', 'logo_path', 'allow_negative_stock', 'allow_overpayment',
  'auto_logout_minutes', 'auto_backup_enabled', 'auto_backup_interval_hours',
  'backup_location', 'auto_update_enabled', 'update_channel',
] as const;

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', async (_evt, args: { token: string }): Promise<IpcResult<Settings>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');

      const db = getDb();
      const row = get<any>(db, `SELECT s.*, m1.value AS app_version, m2.value AS schema_version
                                 FROM settings s
                                 LEFT JOIN app_meta m1 ON m1.key = 'app_version'
                                 LEFT JOIN app_meta m2 ON m2.key = 'schema_version'
                                 WHERE s.id = 1`);
      if (!row) throw new Error('Settings not initialized.');
      return rowToSettings(row);
    })();
  });

  ipcMain.handle('settings:update', async (_evt, args: { token: string; changes: Partial<Settings> }): Promise<IpcResult<Settings>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage settings.');
      }

      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM settings WHERE id = 1');
      if (!existing) throw new Error('Settings not initialized.');

      const updates: string[] = [];
      const params: any[] = [];
      const changedFields: Array<{ field: string; oldVal: any; newVal: any }> = [];

      for (const col of SETTINGS_COLUMNS) {
        if (col in args.changes) {
          const newVal = (args.changes as any)[col];
          const oldVal = existing[col];
          // Convert booleans to 0/1 for SQLite
          const storeVal = typeof newVal === 'boolean' ? (newVal ? 1 : 0) : newVal;
          updates.push(`${col} = ?`);
          params.push(storeVal);
          if (oldVal !== storeVal) {
            changedFields.push({ field: col, oldVal, newVal: storeVal });
          }
        }
      }

      if (updates.length === 0) {
        return rowToSettings(existing);
      }

      updates.push("updated_at = datetime('now')");
      params.push(1); // settings.id = 1

      transaction(db, () => {
        run(db, `UPDATE settings SET ${updates.join(', ')} WHERE id = ?`, ...params);
        for (const cf of changedFields) {
          run(
            db,
            `INSERT INTO settings_history (changed_at, changed_by, field_name, old_value, new_value)
             VALUES (datetime('now'), ?, ?, ?, ?)`,
            session.userId, cf.field, String(cf.oldVal), String(cf.newVal)
          );
        }
        audit({
          userId: session.userId,
          username: session.username,
          action: 'settings_change',
          module: 'settings',
          description: `Updated ${changedFields.length} setting(s): ${changedFields.map(f => f.field).join(', ')}`,
          oldValues: changedFields.reduce((acc, f) => ({ ...acc, [f.field]: f.oldVal }), {}),
          newValues: changedFields.reduce((acc, f) => ({ ...acc, [f.field]: f.newVal }), {}),
        });
      });

      const row = get<any>(db, `SELECT s.*, m1.value AS app_version, m2.value AS schema_version
                                FROM settings s
                                LEFT JOIN app_meta m1 ON m1.key = 'app_version'
                                LEFT JOIN app_meta m2 ON m2.key = 'schema_version'
                                WHERE s.id = 1`);
      return rowToSettings(row!);
    })();
  });
}
