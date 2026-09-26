/**
 * Google Drive Backup Service
 *
 * Handles uploading the SQLite database file to Google Drive for cloud backup.
 * Uses OAuth2 for authentication (user provides their own Google Cloud credentials).
 *
 * Flow:
 *   1. User creates a Google Cloud project + OAuth2 credentials (client ID + secret)
 *   2. User enters credentials in Settings → Cloud Sync
 *   3. App generates an authorization URL → user opens in browser → grants permission
 *   4. User pastes the redirect URL back → app extracts code → exchanges for refresh token
 *   5. Refresh token stored in settings (encrypted at rest by OS user data encryption)
 *   6. Backups use the refresh token (no re-auth needed)
 *
 * Auto-backup: runs every 24 hours if gdrive_auto_backup is enabled.
 */

import { google, oauth2_v2, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { getDb, get, run, all } from '../database/connection';
import { getDbPath } from '../database/connection';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

function getOAuth2Client(): OAuth2Client | null {
  const db = getDb();
  const settings = get<{
    gdrive_client_id: string | null;
    gdrive_client_secret: string | null;
    gdrive_refresh_token: string | null;
  }>(db, 'SELECT gdrive_client_id, gdrive_client_secret, gdrive_refresh_token FROM settings WHERE id = 1');

  if (!settings?.gdrive_client_id || !settings?.gdrive_client_secret) {
    return null;
  }

  const client = new OAuth2Client(
    settings.gdrive_client_id,
    settings.gdrive_client_secret,
    REDIRECT_URI
  );

  if (settings.gdrive_refresh_token) {
    client.setCredentials({ refresh_token: settings.gdrive_refresh_token });
  }

  return client;
}

/**
 * Generate the authorization URL for the user to visit in their browser.
 */
export function getAuthUrl(): { url: string; error?: string } {
  const db = getDb();
  const settings = get<{ gdrive_client_id: string | null; gdrive_client_secret: string | null }>(
    db,
    'SELECT gdrive_client_id, gdrive_client_secret FROM settings WHERE id = 1'
  );

  if (!settings?.gdrive_client_id || !settings?.gdrive_client_secret) {
    return { url: '', error: 'Google Drive client ID and secret are not configured. Enter them in the form below first.' };
  }

  const client = new OAuth2Client(
    settings.gdrive_client_id,
    settings.gdrive_client_secret,
    REDIRECT_URI
  );

  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  return { url };
}

/**
 * Exchange the authorization code for a refresh token.
 * Stores the token in settings.
 */
export async function exchangeCodeForToken(code: string): Promise<{ success: boolean; email?: string; error?: string }> {
  const db = getDb();
  const settings = get<{ gdrive_client_id: string | null; gdrive_client_secret: string | null }>(
    db,
    'SELECT gdrive_client_id, gdrive_client_secret FROM settings WHERE id = 1'
  );

  if (!settings?.gdrive_client_id || !settings?.gdrive_client_secret) {
    return { success: false, error: 'Client ID/secret not configured.' };
  }

  const client = new OAuth2Client(
    settings.gdrive_client_id,
    settings.gdrive_client_secret,
    REDIRECT_URI
  );

  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return { success: false, error: 'No refresh token received. Try revoking access and re-authorizing.' };
    }

    // Store refresh token
    run(db, "UPDATE settings SET gdrive_refresh_token = ?, updated_at = datetime('now') WHERE id = 1", tokens.refresh_token);

    // Get user email
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email || 'unknown';

    run(db, "UPDATE settings SET gdrive_email = ?, gdrive_enabled = 1, updated_at = datetime('now') WHERE id = 1", email);

    log.info(`[gdrive] Connected as ${email}`);
    return { success: true, email };
  } catch (err: any) {
    log.error('[gdrive] Token exchange failed:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Disconnect from Google Drive (clear tokens).
 */
export function disconnect(): void {
  const db = getDb();
  run(db, "UPDATE settings SET gdrive_refresh_token = NULL, gdrive_email = NULL, gdrive_enabled = 0, updated_at = datetime('now') WHERE id = 1");
  log.info('[gdrive] Disconnected');
}

/**
 * Upload the current SQLite database file to Google Drive.
 */
export async function uploadBackup(): Promise<{
  success: boolean;
  fileId?: string;
  fileLink?: string;
  fileName?: string;
  fileSize?: number;
  error?: string;
}> {
  const client = getOAuth2Client();
  if (!client) {
    return { success: false, error: 'Google Drive is not connected. Configure credentials and authorize first.' };
  }

  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    return { success: false, error: 'Database file not found at: ' + dbPath };
  }

  // Checkpoint WAL before copying
  try {
    const db = getDb();
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    log.warn('[gdrive] WAL checkpoint failed:', err);
  }

  const db = getDb();
  const settings = get<{ gdrive_folder_id: string | null; kiln_name: string }>(
    db,
    'SELECT gdrive_folder_id, kiln_name FROM settings WHERE id = 1'
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const kilnName = settings?.kiln_name || 'BrickKilnERP';
  const fileName = `${kilnName}-backup-${timestamp}.db`;
  const stats = fs.statSync(dbPath);
  const fileSize = stats.size;

  try {
    const drive = google.drive({ version: 'v3', auth: client });

    // Upload file
    const media = {
      mimeType: 'application/octet-stream',
      body: fs.createReadStream(dbPath),
    };

    const fileMetadata: any = {
      name: fileName,
    };

    if (settings?.gdrive_folder_id) {
      fileMetadata.parents = [settings.gdrive_folder_id];
    }

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink, size',
    });

    const fileId = response.data.id || '';
    const fileLink = response.data.webViewLink || '';

    // Record in cloud_backup_history
    run(
      db,
      `INSERT INTO cloud_backup_history (backup_date, provider, file_name, file_size_bytes, drive_file_id, drive_link, backup_type, status)
       VALUES (datetime('now'), 'gdrive', ?, ?, ?, ?, 'auto', 'success')`,
      fileName, fileSize, fileId, fileLink
    );

    // Update last backup time
    run(db, "UPDATE settings SET gdrive_last_backup = datetime('now'), updated_at = datetime('now') WHERE id = 1");

    log.info(`[gdrive] Backup uploaded: ${fileName} (${fileSize} bytes) → ${fileId}`);
    return { success: true, fileId, fileLink, fileName, fileSize };
  } catch (err: any) {
    log.error('[gdrive] Upload failed:', err.message);

    // Record failure
    run(
      db,
      `INSERT INTO cloud_backup_history (backup_date, provider, file_name, file_size_bytes, backup_type, status, error_message)
       VALUES (datetime('now'), 'gdrive', ?, ?, 'auto', 'failed', ?)`,
      fileName, fileSize, err.message
    );

    return { success: false, error: err.message };
  }
}

/**
 * List backups stored on Google Drive (from local history).
 */
export function listBackups(): Array<{
  id: number;
  backup_date: string;
  file_name: string;
  file_size_bytes: number | null;
  drive_file_id: string | null;
  drive_link: string | null;
  backup_type: string;
  status: string;
  error_message: string | null;
}> {
  const db = getDb();
  return all<any>(
    db,
    `SELECT id, backup_date, file_name, file_size_bytes, drive_file_id, drive_link, backup_type, status, error_message
     FROM cloud_backup_history
     WHERE provider = 'gdrive'
     ORDER BY backup_date DESC
     LIMIT 50`
  );
}

/**
 * Check if auto-backup should run (24h since last backup).
 */
export function shouldAutoBackup(): boolean {
  const db = getDb();
  const settings = get<{ gdrive_auto_backup: number; gdrive_enabled: number; gdrive_refresh_token: string | null; gdrive_last_backup: string | null }>(
    db,
    'SELECT gdrive_auto_backup, gdrive_enabled, gdrive_refresh_token, gdrive_last_backup FROM settings WHERE id = 1'
  );

  if (!settings?.gdrive_auto_backup || !settings?.gdrive_enabled || !settings?.gdrive_refresh_token) {
    return false;
  }

  if (!settings?.gdrive_last_backup) {
    return true; // Never backed up
  }

  const lastBackup = new Date(settings.gdrive_last_backup).getTime();
  const now = Date.now();
  const hoursSinceLastBackup = (now - lastBackup) / (1000 * 60 * 60);

  return hoursSinceLastBackup >= 24;
}

/**
 * Get connection status.
 */
export function getConnectionStatus(): {
  configured: boolean;
  connected: boolean;
  email: string | null;
  autoBackup: boolean;
  lastBackup: string | null;
} {
  const db = getDb();
  const settings = get<{
    gdrive_client_id: string | null;
    gdrive_enabled: number;
    gdrive_refresh_token: string | null;
    gdrive_email: string | null;
    gdrive_auto_backup: number;
    gdrive_last_backup: string | null;
  }>(db, 'SELECT gdrive_client_id, gdrive_enabled, gdrive_refresh_token, gdrive_email, gdrive_auto_backup, gdrive_last_backup FROM settings WHERE id = 1');

  return {
    configured: !!settings?.gdrive_client_id,
    connected: !!(settings?.gdrive_enabled && settings?.gdrive_refresh_token),
    email: settings?.gdrive_email || null,
    autoBackup: !!settings?.gdrive_auto_backup,
    lastBackup: settings?.gdrive_last_backup || null,
  };
}
