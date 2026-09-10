/**
 * Database initialization & migrations
 * Brick Kiln ERP - Electron main process
 *
 * Responsibilities:
 * 1. Run schema.sql on first install (creates all tables).
 * 2. Run seed.sql on first install (inserts default departments, roles, etc.).
 * 3. Ensure default admin user exists with proper bcrypt hash.
 * 4. Track schema version; run forward-only migrations.
 */

import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import log from 'electron-log';
import { getDb, execSql, get, run, transaction } from './connection';

const SCHEMA_VERSION = '1.0.0';

/**
 * Resolve a SQL file path.
 * - In production: the schema.sql is bundled in extraResources (root of app.asar.unpacked)
 *   but for simplicity we ship the SQL files inside the app resources.
 * - In development: read directly from electron/database/
 */
function resolveSqlFile(filename: string): string {
  const candidates = [
    // Development
    path.join(__dirname, '..', 'database', filename),
    path.join(process.cwd(), 'electron', 'database', filename),
    // Production (extraResources)
    path.join(process.resourcesPath, filename),
    path.join(process.resourcesPath, 'database', filename),
    // Fallback - app dir
    path.join(__dirname, 'database', filename),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Could not resolve SQL file: ${filename}. Tried: ${candidates.join(', ')}`);
}

/**
 * Read a SQL file content.
 */
function readSqlFile(filename: string): string {
  const filePath = resolveSqlFile(filename);
  log.info(`[db-init] Reading SQL file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Check whether the database has been initialized yet.
 */
function isInitialized(): boolean {
  const db = getDb();
  const table = get<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta'");
  if (!table) return false;

  const row = get<{ value: string }>(db, "SELECT value FROM app_meta WHERE key='schema_version'");
  return !!row;
}

/**
 * Run schema.sql (idempotent - uses IF NOT EXISTS).
 */
function runSchema(): void {
  const db = getDb();
  const schemaSql = readSqlFile('schema.sql');
  execSql(db, schemaSql);
  log.info('[db-init] Schema applied.');
}

/**
 * Run seed.sql (idempotent - uses INSERT OR IGNORE).
 */
function runSeed(): void {
  const db = getDb();
  const seedSql = readSqlFile('seed.sql');
  execSql(db, seedSql);
  log.info('[db-init] Seed data applied.');
}

/**
 * Ensure a default admin user exists.
 * Default credentials:
 *   username: admin
 *   password: admin123
 *   role: Super Admin
 *   must_change_password: 1 (forces password change on first login)
 */
export function ensureDefaultAdmin(): void {
  const db = getDb();
  const existing = get<{ id: string }>(db, "SELECT id FROM users WHERE username = 'admin'");
  if (existing) {
    log.info('[db-init] Default admin user already exists.');
    return;
  }

  const passwordHash = bcrypt.hashSync('admin123', 10);
  const userId = 'user-admin-001';
  run(
    db,
    `INSERT INTO users (id, username, password_hash, full_name, role_id, is_active, must_change_password, created_by)
     VALUES (?, ?, ?, ?, ?, 1, 1, NULL)`,
    userId,
    'admin',
    passwordHash,
    'System Administrator',
    'role-super-admin'
  );
  log.info('[db-init] Default admin user created (username: admin, password: admin123).');
  log.info('[db-init] !!! CHANGE THE DEFAULT PASSWORD IMMEDIATELY !!!');
}

/**
 * Update the app version in the database meta.
 */
function updateAppVersion(): void {
  const db = getDb();
  // Read from package.json - in production this is bundled; in dev we read from process.cwd()
  let appVersion = '1.0.0';
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.version) appVersion = pkg.version;
    }
  } catch (err) {
    log.warn('[db-init] Could not read package.json version, using default 1.0.0');
  }

  run(db, "INSERT INTO app_meta (key, value, updated_at) VALUES ('app_version', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')", appVersion);
  log.info(`[db-init] App version recorded: ${appVersion}`);
}

/**
 * Run any pending migrations (forward-only).
 * For v1.0.0 there are no migrations yet - the schema is fresh.
 * Future migrations should be added here as a sequence of idempotent SQL blocks
 * guarded by checks against the schema_version meta row.
 */
function runMigrations(): void {
  const db = getDb();
  const currentVersionRow = get<{ value: string }>(db, "SELECT value FROM app_meta WHERE key='schema_version'");
  const currentVersion = currentVersionRow?.value || '0.0.0';

  log.info(`[db-init] Current schema version: ${currentVersion}`);

  // Example for future migration:
  // if (semver.lt(currentVersion, '1.1.0')) {
  //   execSql(db, readSqlFile('migrations/v1.1.0.sql'));
  //   run(db, "UPDATE app_meta SET value = '1.1.0', updated_at = datetime('now') WHERE key = 'schema_version'");
  // }

  // Ensure schema_version is set to the latest
  run(db, "INSERT INTO app_meta (key, value, updated_at) VALUES ('schema_version', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')", SCHEMA_VERSION);
}

/**
 * Main entry point: initialize the database.
 * Call this once at app startup, before any IPC handlers that touch the DB.
 */
export function initDatabase(): void {
  log.info('[db-init] Initializing database...');
  const db = getDb();

  transaction(db, () => {
    runSchema();
    runMigrations();
    runSeed();
    ensureDefaultAdmin();
    updateAppVersion();
  });

  log.info('[db-init] Database initialization complete.');
}
