/**
 * Backup & Restore IPC handlers.
 * Channels:
 *   - backup:create  -> { filePath, sizeBytes }
 *   - backup:restore  -> { success: true } (replaces the live DB)
 *   - backup:list     -> BackupHistory[]
 *   - backup:delete   -> { success: true }
 *
 * Implementation:
 *   - Backup = copy the SQLite database file to a timestamped path under the backup_location.
 *   - Restore = close DB, copy the chosen backup file over the live DB file, reopen.
 *
 * Backups are SQLite-safe because WAL mode checkpoints before the copy.
 */

import { ipcMain, app, dialog, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getDb, closeDb, get, all, run, transaction } from '../database/connection';
import { getDbPath } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, wrap, type IpcResult } from '../utils/ipc';
import log from 'electron-log';

export interface BackupRecord {
  id: number;
  backup_date: string;
  file_path: string;
  file_size_bytes: number | null;
  backup_type: string;
  initiated_by: string | null;
  status: string;
  notes: string | null;
}

function getDefaultBackupDir(): string {
  // Use app.getPath('userData')/backups by default
  const base = app.getPath('userData');
  const dir = path.join(base, 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveBackupDir(): string {
  const db = getDb();
  const settings = get<{ backup_location: string }>(db, 'SELECT backup_location FROM settings WHERE id = 1');
  if (settings?.backup_location && fs.existsSync(settings.backup_location)) {
    return settings.backup_location;
  }
  return getDefaultBackupDir();
}

function checkpointWal(dbPath: string): void {
  // Force WAL checkpoint so all data is written into the main DB file before copy
  try {
    const db = getDb();
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    log.warn('[backup] WAL checkpoint failed:', err);
  }
}

export function registerBackupHandlers(): void {
  ipcMain.handle('backup:create', async (_evt, args: { token: string; note?: string }): Promise<IpcResult<{ filePath: string; sizeBytes: number; backupId: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('system.backup') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to create backups.');
      }

      const dbPath = getDbPath();
      checkpointWal(dbPath);

      const dir = resolveBackupDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `brick-kiln-erp-backup-${timestamp}.db`;
      const backupPath = path.join(dir, fileName);

      // Copy the DB file
      fs.copyFileSync(dbPath, backupPath);
      // Also copy WAL and SHM if they exist (for completeness)
      for (const ext of ['-wal', '-shm']) {
        if (fs.existsSync(dbPath + ext)) {
          fs.copyFileSync(dbPath + ext, backupPath + ext);
        }
      }
      const stats = fs.statSync(backupPath);
      const sizeBytes = stats.size;

      let backupId = 0;
      transaction(getDb(), () => {
        const result = run(
          getDb(),
          `INSERT INTO backup_history (backup_date, file_path, file_size_bytes, backup_type, initiated_by, status, notes)
           VALUES (datetime('now'), ?, ?, 'manual', ?, 'success', ?)`,
          backupPath, sizeBytes, session.userId, args.note ?? null
        );
        backupId = Number(result.lastInsertRowid);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'backup',
          module: 'system',
          description: `Created backup: ${fileName} (${(sizeBytes / 1024).toFixed(1)} KB)`,
        });
      });

      return { filePath: backupPath, sizeBytes, backupId };
    })();
  });

  ipcMain.handle('backup:restore', async (_evt, args: { token: string; backupId: number }): Promise<IpcResult<{ success: true; restartRequired: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('system.restore') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to restore backups.');
      }

      const db = getDb();
      const backup = get<{ id: number; file_path: string; status: string }>(db, 'SELECT * FROM backup_history WHERE id = ?', args.backupId);
      if (!backup) throw new Error('Backup record not found.');
      if (!fs.existsSync(backup.file_path)) throw new Error('Backup file no longer exists on disk.');

      // Confirm via dialog
      const choice = await dialog.showMessageBox(BrowserWindow.getFocusedWindow() ?? new BrowserWindow({ show: false }), {
        type: 'warning',
        buttons: ['Cancel', 'Restore'],
        title: 'Restore Database',
        message: 'Are you sure you want to restore the database from this backup?',
        detail: `Backup: ${path.basename(backup.file_path)}\n\nThis will REPLACE all current data. The application will restart after restore.\n\nThis action cannot be undone.`,
        defaultId: 0,
        cancelId: 0,
      });
      if (choice.response !== 1) {
        throw new Error('Restore cancelled by user.');
      }

      // Step 1: create a safety backup of current DB (pre_restore)
      const dbPath = getDbPath();
      checkpointWal(dbPath);
      const dir = resolveBackupDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const preRestorePath = path.join(dir, `brick-kiln-erp-prerestore-${timestamp}.db`);
      fs.copyFileSync(dbPath, preRestorePath);
      const preStats = fs.statSync(preRestorePath);
      transaction(db, () => {
        run(db, `INSERT INTO backup_history (backup_date, file_path, file_size_bytes, backup_type, initiated_by, status, notes) VALUES (datetime('now'), ?, ?, 'pre_restore', ?, 'success', 'Auto-backup before restore')`, preRestorePath, preStats.size, session.userId);
      });

      // Step 2: close DB connection
      closeDb();

      // Step 3: copy backup file over live DB file
      fs.copyFileSync(backup.file_path, dbPath);
      // Remove any stale WAL/SHM files (they'll be regenerated on next open)
      for (const ext of ['-wal', '-shm']) {
        if (fs.existsSync(dbPath + ext)) {
          fs.unlinkSync(dbPath + ext);
        }
      }

      // Step 4: audit (will be lost on restart since DB will be the restored one,
      // but the audit log inside the restored DB will already have its own records).
      // We re-open DB to log the restore event.
      const db2 = getDb(); // reopen
      run(db2, `INSERT INTO backup_history (backup_date, file_path, file_size_bytes, backup_type, initiated_by, status, notes) VALUES (datetime('now'), ?, ?, 'restore', ?, 'success', ?)`, backup.file_path, fs.statSync(backup.file_path).size, session.userId, `Restored from backup ID ${args.backupId}`);

      // Step 5: prompt restart
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 1500);

      return { success: true, restartRequired: true } as const;
    })();
  });

  ipcMain.handle('backup:list', async (_evt, args: { token: string; limit?: number }): Promise<IpcResult<BackupRecord[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('system.backup') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view backup history.');
      }
      const db = getDb();
      const limit = Math.min(args.limit ?? 50, 500);
      return all<BackupRecord>(db, 'SELECT * FROM backup_history ORDER BY backup_date DESC LIMIT ?', limit);
    })();
  });

  ipcMain.handle('backup:delete', async (_evt, args: { token: string; id: number; deleteFile?: boolean }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('system.backup') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to delete backups.');
      }
      const db = getDb();
      const backup = get<{ id: number; file_path: string }>(db, 'SELECT * FROM backup_history WHERE id = ?', args.id);
      if (!backup) throw new Error('Backup record not found.');

      transaction(db, () => {
        run(db, 'DELETE FROM backup_history WHERE id = ?', args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'delete',
          module: 'system',
          description: `Deleted backup record #${args.id}`,
        });
      });

      if (args.deleteFile && fs.existsSync(backup.file_path)) {
        try { fs.unlinkSync(backup.file_path); } catch (err) { log.warn('[backup] Could not delete file:', err); }
      }
      return { success: true } as const;
    })();
  });
}
