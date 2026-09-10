/**
 * Updates IPC handlers (auto-update).
 * Channels:
 *   - update:check        -> { available: boolean, version?: string, releaseNotes?: string }
 *   - update:download     -> { started: true }
 *   - update:install      -> triggers quit-and-install
 *   - update:get-info     -> { currentVersion, autoUpdaterEnabled }
 *
 * The actual update flow is driven by electron-updater in main.ts.
 */

import { ipcMain, app } from 'electron';
import { autoUpdater } from 'electron-updater';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, wrap, type IpcResult } from '../utils/ipc';
import { getDb, get, run } from '../database/connection';
import log from 'electron-log';

export function registerUpdateHandlers(): void {
  ipcMain.handle('update:get-info', async (_evt, args: { token: string }): Promise<IpcResult<{ currentVersion: string; autoUpdateEnabled: boolean; lastChecked: string | null; channel: string }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const settings = get<{ auto_update_enabled: number; last_update_check: string | null; update_channel: string }>(db, 'SELECT auto_update_enabled, last_update_check, update_channel FROM settings WHERE id = 1');
      return {
        currentVersion: app.getVersion(),
        autoUpdateEnabled: !!settings?.auto_update_enabled,
        lastChecked: settings?.last_update_check ?? null,
        channel: settings?.update_channel ?? 'latest',
      };
    })();
  });

  ipcMain.handle('update:check', async (_evt, args: { token: string }): Promise<IpcResult<{ available: boolean; version?: string; releaseNotes?: string; releaseDate?: string }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('system.update') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to check for updates.');
      }

      // Record the check time
      run(getDb(), "UPDATE settings SET last_update_check = datetime('now') WHERE id = 1");
      audit({
        userId: session.userId,
        username: session.username,
        action: 'update_check',
        module: 'system',
        description: 'Checked for updates',
      });

      const result = await autoUpdater.checkForUpdates();
      if (result && result.updateInfo) {
        const isUpdateAvailable = result.updateInfo.version !== app.getVersion();
        return {
          available: isUpdateAvailable,
          version: result.updateInfo.version,
          releaseNotes: typeof result.updateInfo.releaseNotes === 'string'
            ? result.updateInfo.releaseNotes
            : JSON.stringify(result.updateInfo.releaseNotes),
          releaseDate: result.updateInfo.releaseDate,
        };
      }
      return { available: false };
    })();
  });

  ipcMain.handle('update:download', async (_evt, args: { token: string }): Promise<IpcResult<{ started: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('system.update') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to download updates.');
      }
      log.info('[updates] Starting download...');
      await autoUpdater.downloadUpdate();
      audit({
        userId: session.userId,
        username: session.username,
        action: 'update_download',
        module: 'system',
        description: 'Started downloading update',
      });
      return { started: true } as const;
    })();
  });

  ipcMain.handle('update:install', async (_evt, args: { token: string }): Promise<IpcResult<{ started: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('system.update') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to install updates.');
      }
      log.info('[updates] Installing update and restarting...');
      audit({
        userId: session.userId,
        username: session.username,
        action: 'update_install',
        module: 'system',
        description: 'Installing update and restarting application',
      });
      // Slight delay so audit log flushes
      setTimeout(() => {
        autoUpdater.quitAndInstall(true, true);
      }, 800);
      return { started: true } as const;
    })();
  });
}
