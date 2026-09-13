/**
 * Cloud Sync IPC handlers.
 *
 * Channels:
 *   - cloud:status             -> overall status (Supabase + Google Drive)
 *   - cloud:supabase-configure  -> set Supabase URL + key + enabled
 *   - cloud:supabase-test       -> test connection
 *   - cloud:supabase-sync       -> run full sync (push + pull)
 *   - cloud:supabase-sync-status -> get per-table sync state
 *   - cloud:gdrive-set-config   -> set client_id, secret, folder_id, auto_backup
 *   - cloud:gdrive-auth-url     -> get OAuth authorization URL
 *   - cloud:gdrive-exchange-code -> exchange auth code for refresh token
 *   - cloud:gdrive-disconnect    -> disconnect
 *   - cloud:gdrive-status        -> get connection status
 *   - cloud:gdrive-backup        -> manual backup upload
 *   - cloud:gdrive-list-backups  -> list backup history
 */

import { ipcMain, shell } from 'electron';
import { getDb, get, run } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';
import * as supabaseService from '../services/supabase';
import * as gdriveService from '../services/gdrive';

export function registerCloudSyncHandlers(): void {
  // Overall status
  ipcMain.handle('cloud:status', async (_evt, args: { token: string }): Promise<IpcResult<{
    supabase: { enabled: boolean; url: string | null; lastSync: string | null };
    gdrive: { configured: boolean; connected: boolean; email: string | null; autoBackup: boolean; lastBackup: string | null };
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');

      const db = getDb();
      const settings = get<{
        supabase_enabled: number;
        supabase_url: string | null;
      }>(db, 'SELECT supabase_enabled, supabase_url FROM settings WHERE id = 1');

      const lastSyncRow = get<{ last_sync_at: string }>(db, 'SELECT MAX(last_sync_at) AS last_sync_at FROM cloud_sync_state');

      const gdriveStatus = gdriveService.getConnectionStatus();

      return {
        supabase: {
          enabled: !!settings?.supabase_enabled,
          url: settings?.supabase_url || null,
          lastSync: lastSyncRow?.last_sync_at || null,
        },
        gdrive: {
          configured: gdriveStatus.configured,
          connected: gdriveStatus.connected,
          email: gdriveStatus.email,
          autoBackup: gdriveStatus.autoBackup,
          lastBackup: gdriveStatus.lastBackup,
        },
      };
    })();
  });

  // === Supabase ===

  ipcMain.handle('cloud:supabase-configure', async (_evt, args: {
    token: string;
    enabled: boolean;
    url?: string;
    anonKey?: string;
  }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage cloud settings.');
      }

      const db = getDb();
      const updates: string[] = [];
      const params: any[] = [];

      updates.push('supabase_enabled = ?'); params.push(args.enabled ? 1 : 0);
      if (args.url !== undefined) { updates.push('supabase_url = ?'); params.push(args.url || null); }
      if (args.anonKey !== undefined) { updates.push('supabase_anon_key = ?'); params.push(args.anonKey || null); }

      updates.push("updated_at = datetime('now')");
      params.push(1);

      transaction_update(db, updates, params);

      // Reset the cached client so it picks up new credentials
      supabaseService.resetClient();

      audit({
        userId: session.userId,
        username: session.username,
        action: 'settings_change',
        module: 'cloud',
        description: `Updated Supabase settings: enabled=${args.enabled}`,
      });

      return { success: true } as const;
    })();
  });

  ipcMain.handle('cloud:supabase-test', async (_evt, args: { token: string }): Promise<IpcResult<{ success: boolean; message: string }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const result = await supabaseService.testConnection();
      return result;
    })();
  });

  ipcMain.handle('cloud:supabase-sync', async (_evt, args: { token: string }): Promise<IpcResult<{
    success: boolean;
    total_pushed: number;
    total_pulled: number;
    errors: string[];
    results: any[];
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('system.backup') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to sync data.');
      }

      const result = await supabaseService.syncAll();

      audit({
        userId: session.userId,
        username: session.username,
        action: 'sync',
        module: 'cloud',
        description: `Supabase sync: pushed ${result.total_pushed}, pulled ${result.total_pulled}, errors: ${result.errors.length}`,
      });

      return result;
    })();
  });

  ipcMain.handle('cloud:supabase-sync-status', async (_evt, args: { token: string }): Promise<IpcResult<any[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      return supabaseService.getSyncStatus();
    })();
  });

  // === Google Drive ===

  ipcMain.handle('cloud:gdrive-set-config', async (_evt, args: {
    token: string;
    clientId?: string;
    clientSecret?: string;
    folderId?: string;
    autoBackup?: boolean;
  }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage cloud settings.');
      }

      const db = getDb();
      const updates: string[] = [];
      const params: any[] = [];

      if (args.clientId !== undefined) { updates.push('gdrive_client_id = ?'); params.push(args.clientId || null); }
      if (args.clientSecret !== undefined) { updates.push('gdrive_client_secret = ?'); params.push(args.clientSecret || null); }
      if (args.folderId !== undefined) { updates.push('gdrive_folder_id = ?'); params.push(args.folderId || null); }
      if (args.autoBackup !== undefined) { updates.push('gdrive_auto_backup = ?'); params.push(args.autoBackup ? 1 : 0); }

      if (updates.length === 0) return { success: true } as const;

      updates.push("updated_at = datetime('now')");
      params.push(1);

      transaction_update(db, updates, params);

      audit({
        userId: session.userId,
        username: session.username,
        action: 'settings_change',
        module: 'cloud',
        description: 'Updated Google Drive settings',
      });

      return { success: true } as const;
    })();
  });

  ipcMain.handle('cloud:gdrive-auth-url', async (_evt, args: { token: string }): Promise<IpcResult<{ url: string; error?: string }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const result = gdriveService.getAuthUrl();
      return result;
    })();
  });

  ipcMain.handle('cloud:gdrive-exchange-code', async (_evt, args: { token: string; code: string }): Promise<IpcResult<{ success: boolean; email?: string; error?: string }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const result = await gdriveService.exchangeCodeForToken(args.code);

      if (result.success) {
        audit({
          userId: session.userId,
          username: session.username,
          action: 'connect',
          module: 'cloud',
          description: `Connected Google Drive as ${result.email}`,
        });
      }

      return result;
    })();
  });

  ipcMain.handle('cloud:gdrive-disconnect', async (_evt, args: { token: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      gdriveService.disconnect();
      audit({
        userId: session.userId,
        username: session.username,
        action: 'disconnect',
        module: 'cloud',
        description: 'Disconnected Google Drive',
      });
      return { success: true } as const;
    })();
  });

  ipcMain.handle('cloud:gdrive-status', async (_evt, args: { token: string }): Promise<IpcResult<any>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      return gdriveService.getConnectionStatus();
    })();
  });

  ipcMain.handle('cloud:gdrive-backup', async (_evt, args: { token: string }): Promise<IpcResult<{
    success: boolean;
    fileId?: string;
    fileLink?: string;
    fileName?: string;
    fileSize?: number;
    error?: string;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('system.backup') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to create backups.');
      }

      const result = await gdriveService.uploadBackup();

      if (result.success) {
        audit({
          userId: session.userId,
          username: session.username,
          action: 'backup',
          module: 'cloud',
          description: `Google Drive backup uploaded: ${result.fileName} (${result.fileSize} bytes)`,
        });
      }

      return result;
    })();
  });

  ipcMain.handle('cloud:gdrive-list-backups', async (_evt, args: { token: string }): Promise<IpcResult<any[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      return gdriveService.listBackups();
    })();
  });

  // Open Google Drive link in browser
  ipcMain.handle('cloud:open-link', async (_evt, args: { token: string; url: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (args.url && (args.url.startsWith('http://') || args.url.startsWith('https://'))) {
        await shell.openExternal(args.url);
      }
      return { success: true } as const;
    })();
  });
}

// Helper to avoid importing transaction separately
function transaction_update(db: any, updates: string[], params: any[]): void {
  run(db, `UPDATE settings SET ${updates.join(', ')} WHERE id = ?`, ...params);
}
