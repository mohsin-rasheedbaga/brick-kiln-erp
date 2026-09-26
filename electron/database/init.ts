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
import { app } from 'electron';
import { getDb, execSql, get, all, run, transaction } from './connection';

const SCHEMA_VERSION = '2.9.4';

/**
 * Resolve a SQL file path.
 *
 * In development:
 *   - SQL files live at <project-root>/electron/database/
 *   - __dirname points to dist-electron/, so we go up one level + database/
 *
 * In production (packaged app):
 *   - SQL files are bundled via electron-builder "extraResources" config:
 *       extraResources: [
 *         { "from": "electron/database/schema.sql", "to": "schema.sql" },
 *         { "from": "electron/database/seed.sql",    "to": "seed.sql"    }
 *       ]
 *   - This places them at: <process.resourcesPath>/schema.sql
 *                         and <process.resourcesPath>/seed.sql
 *   - app.isPackaged is true, so process.resourcesPath is the install dir's resources/
 */
function resolveSqlFile(filename: string): string {
  const candidates: string[] = [];

  // Production paths (highest priority for packaged app)
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, filename));
    candidates.push(path.join(process.resourcesPath, 'database', filename));
  }

  // Development paths (when running from source via `npm run dev`)
  candidates.push(path.join(__dirname, '..', 'database', filename));
  candidates.push(path.join(process.cwd(), 'electron', 'database', filename));

  // Fallbacks
  candidates.push(path.join(__dirname, 'database', filename));
  candidates.push(path.join(__dirname, filename));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  const packaged = app ? app.isPackaged : false;
  throw new Error(
    `Could not resolve SQL file: ${filename}. ` +
    `App packaged: ${packaged}. ` +
    `process.resourcesPath: ${process.resourcesPath || '(undefined)'}. ` +
    `__dirname: ${__dirname}. ` +
    `Tried paths:\n  - ${candidates.join('\n  - ')}`
  );
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

  // Migration v1.5.0: add payroll_cycle + daily_wage columns to workers table
  // (existing databases won't have these columns since schema.sql only runs on fresh DBs)
  try {
    const cols = all<{ name: string }>(db, "PRAGMA table_info(workers)");
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has('payroll_cycle')) {
      log.info('[db-init] Migration v1.5.0: adding workers.payroll_cycle column');
      db.exec("ALTER TABLE workers ADD COLUMN payroll_cycle TEXT NOT NULL DEFAULT 'weekly' CHECK (payroll_cycle IN ('weekly','monthly','daily'))");
    }
    if (!colNames.has('daily_wage')) {
      log.info('[db-init] Migration v1.5.0: adding workers.daily_wage column');
      db.exec("ALTER TABLE workers ADD COLUMN daily_wage REAL NOT NULL DEFAULT 0");
    }
  } catch (err) {
    log.warn('[db-init] Migration v1.5.0 (workers columns) error:', err);
  }

  // Migration v1.6.0: add cloud sync columns to settings table
  try {
    const cols = all<{ name: string }>(db, "PRAGMA table_info(settings)");
    const colNames = new Set(cols.map((c) => c.name));
    const newCols = [
      ['supabase_enabled', 'INTEGER NOT NULL DEFAULT 0'],
      ['supabase_url', 'TEXT'],
      ['supabase_anon_key', 'TEXT'],
      ['gdrive_enabled', 'INTEGER NOT NULL DEFAULT 0'],
      ['gdrive_client_id', 'TEXT'],
      ['gdrive_client_secret', 'TEXT'],
      ['gdrive_refresh_token', 'TEXT'],
      ['gdrive_email', 'TEXT'],
      ['gdrive_folder_id', 'TEXT'],
      ['gdrive_auto_backup', 'INTEGER NOT NULL DEFAULT 1'],
      ['gdrive_last_backup', 'TEXT'],
    ];
    for (const [colName, colDef] of newCols) {
      if (!colNames.has(colName)) {
        log.info(`[db-init] Migration v1.6.0: adding settings.${colName} column`);
        db.exec(`ALTER TABLE settings ADD COLUMN ${colName} ${colDef}`);
      }
    }
  } catch (err) {
    log.warn('[db-init] Migration v1.6.0 (settings columns) error:', err);
  }

  // Migration v1.7.0: add custom_permissions column to users table
  try {
    const cols = all<{ name: string }>(db, "PRAGMA table_info(users)");
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has('custom_permissions')) {
      log.info('[db-init] Migration v1.7.0: adding users.custom_permissions column');
      db.exec('ALTER TABLE users ADD COLUMN custom_permissions TEXT');
    }
  } catch (err) {
    log.warn('[db-init] Migration v1.7.0 (users.custom_permissions) error:', err);
  }

  // Migration v1.8.0: add employment_type, monthly_salary, allowed_leaves to workers table
  try {
    const cols = all<{ name: string }>(db, "PRAGMA table_info(workers)");
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has('employment_type')) {
      log.info('[db-init] Migration v1.8.0: adding workers.employment_type column');
      db.exec("ALTER TABLE workers ADD COLUMN employment_type TEXT NOT NULL DEFAULT 'piece_rate' CHECK (employment_type IN ('piece_rate','salary'))");
    }
    if (!colNames.has('monthly_salary')) {
      log.info('[db-init] Migration v1.8.0: adding workers.monthly_salary column');
      db.exec('ALTER TABLE workers ADD COLUMN monthly_salary REAL NOT NULL DEFAULT 0');
    }
    if (!colNames.has('allowed_leaves')) {
      log.info('[db-init] Migration v1.8.0: adding workers.allowed_leaves column');
      db.exec('ALTER TABLE workers ADD COLUMN allowed_leaves INTEGER NOT NULL DEFAULT 4');
    }
  } catch (err) {
    log.warn('[db-init] Migration v1.8.0 (workers salary columns) error:', err);
  }

  // Migration v1.9.5: Remove production.view and sales.view from accountant role
  // Accountant should NOT see Production or Sales pages — only financial modules.
  try {
    log.info('[db-init] Migration v1.9.5: cleaning accountant role permissions');
    run(db, `DELETE FROM role_permissions WHERE role_id = 'role-accountant' AND permission_id IN (
      SELECT id FROM permissions WHERE code IN ('production.view','sales.view','sales.create','sales.edit','sales.void','customers.view')
    )`);
  } catch (err) {
    log.warn('[db-init] Migration v1.9.5 (accountant permissions) error:', err);
  }

  // Migration v2.3.0: add min_selling_rate + max_selling_rate to brick_categories
  try {
    const cols = all<{ name: string }>(db, "PRAGMA table_info(brick_categories)");
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has('min_selling_rate')) {
      log.info('[db-init] Migration v2.3.0: adding brick_categories.min_selling_rate column');
      db.exec('ALTER TABLE brick_categories ADD COLUMN min_selling_rate REAL NOT NULL DEFAULT 0');
    }
    if (!colNames.has('max_selling_rate')) {
      log.info('[db-init] Migration v2.3.0: adding brick_categories.max_selling_rate column');
      db.exec('ALTER TABLE brick_categories ADD COLUMN max_selling_rate REAL NOT NULL DEFAULT 0');
    }
  } catch (err) {
    log.warn('[db-init] Migration v2.3.0 (brick_categories columns) error:', err);
  }

  // Migration v2.8.1: Consolidate departments per user request.
  // The user has 3 production teams in real life:
  //   1. Raw Brick Making (کچی اینٹ بنانے والے)
  //   2. Transport + Loading (بھٹے تک لانے والے + بھٹے میں جوڑنے والے) — ONE team
  //   3. Baked Brick Unloading (پکی اینٹ نکالنے والے)
  // Old "Kiln Loading" was a separate department — it is now merged into "Transport".
  // Old "Kiln Firing", "Grading", "Management" departments are deactivated (data preserved).
  try {
    log.info('[db-init] Migration v2.8.1: consolidating departments');

    // Step 1: Make sure the canonical "Transport to Kiln" department exists with merged description.
    // (Some installs may have it as 'Raw Brick Transportation' — update the name.)
    run(db, `UPDATE departments SET
              name = 'Transport to Kiln (بھٹے تک لانے والے)',
              description = 'Transport of raw bricks to kiln AND loading/placement into kiln — same team'
             WHERE id = 'dept-transport'`);

    // Step 2: Merge dept-kiln-loading INTO dept-transport.
    // Re-point ALL foreign-key references from dept-kiln-loading -> dept-transport.
    const oldLoadingExists = get<{ id: string }>(db, "SELECT id FROM departments WHERE id = 'dept-kiln-loading'");
    if (oldLoadingExists) {
      log.info('[db-init] Migration v2.8.1: merging dept-kiln-loading -> dept-transport');
      // Workers
      run(db, "UPDATE workers SET department_id = 'dept-transport' WHERE department_id = 'dept-kiln-loading'");
      // Production entries
      run(db, "UPDATE production_entries SET department_id = 'dept-transport' WHERE department_id = 'dept-kiln-loading'");
      // Users
      run(db, "UPDATE users SET department_id = 'dept-transport' WHERE department_id = 'dept-kiln-loading'");
      // Expenses
      run(db, "UPDATE expenses SET department_id = 'dept-transport' WHERE department_id = 'dept-kiln-loading'");
      // Department rates
      run(db, "UPDATE department_rates SET department_id = 'dept-transport' WHERE department_id = 'dept-kiln-loading'");
      // Work types pointing to old department
      run(db, "UPDATE work_types SET department_id = 'dept-transport' WHERE department_id = 'dept-kiln-loading'");
      // Finally delete the old department row
      run(db, "DELETE FROM departments WHERE id = 'dept-kiln-loading'");
    }

    // Step 3: Make sure dept-unloading exists with correct name.
    // (Older installs may have it as 'Baked Brick Unloading' or 'dept-kiln-unloading'.)
    const oldUnloadingExists = get<{ id: string }>(db, "SELECT id FROM departments WHERE id = 'dept-kiln-unloading'");
    if (oldUnloadingExists) {
      log.info('[db-init] Migration v2.8.1: migrating dept-kiln-unloading -> dept-unloading');
      run(db, "UPDATE workers SET department_id = 'dept-unloading' WHERE department_id = 'dept-kiln-unloading'");
      run(db, "UPDATE production_entries SET department_id = 'dept-unloading' WHERE department_id = 'dept-kiln-unloading'");
      run(db, "UPDATE users SET department_id = 'dept-unloading' WHERE department_id = 'dept-kiln-unloading'");
      run(db, "UPDATE expenses SET department_id = 'dept-unloading' WHERE department_id = 'dept-kiln-unloading'");
      run(db, "UPDATE department_rates SET department_id = 'dept-unloading' WHERE department_id = 'dept-kiln-unloading'");
      run(db, "UPDATE work_types SET department_id = 'dept-unloading' WHERE department_id = 'dept-kiln-unloading'");
      run(db, "DELETE FROM departments WHERE id = 'dept-kiln-unloading'");
    }
    // Ensure canonical unloading row exists with proper name
    run(db, `INSERT OR IGNORE INTO departments (id, name, code, description, is_system, is_active, sort_order)
              VALUES ('dept-unloading', 'Baked Brick Unloading (پکی اینٹ نکالنے والے)', 'UNLD',
                      'Unloading baked bricks from kiln', 1, 1, 3)`);
    run(db, `UPDATE departments SET
              name = 'Baked Brick Unloading (پکی اینٹ نکالنے والے)',
              description = 'Unloading baked bricks from kiln'
             WHERE id = 'dept-unloading'`);

    // Step 4: Canonical names for remaining production depts
    run(db, `UPDATE departments SET
              name = 'Raw Brick Making (کچی اینٹ بنانے والے)',
              description = 'Production of raw bricks from clay'
             WHERE id = 'dept-raw-brick'`);

    // Step 5: Deactivate obsolete departments that should no longer appear in dropdowns.
    // We DON'T delete them (data preserved) — we just mark them inactive.
    // The frontend already filters inactive departments from create/edit dropdowns by default.
    const obsoleteDepts = [
      'dept-kiln-firing',   // Kiln firing is usually done by the same person doing the loading/unloading
      'dept-grading',        // Grading is done by unloading team
      'dept-management',     // Not used in the simplified structure
    ];
    for (const deptId of obsoleteDepts) {
      const exists = get<{ id: string }>(db, 'SELECT id FROM departments WHERE id = ?', deptId);
      if (exists) {
        // Re-point any users/workers/production/expenses to dept-management → none, or keep as-is but inactive
        run(db, "UPDATE departments SET is_active = 0 WHERE id = ?", deptId);
        log.info(`[db-init] Migration v2.8.1: deactivated obsolete department ${deptId}`);
      }
    }

    // Step 6: Also ensure 'dept-sales' and 'dept-accounts' have Urdu labels
    run(db, `UPDATE departments SET
              name = 'Sales (سیلز)',
              description = 'Sales & customer relations — salaried (ماہانہ)'
             WHERE id = 'dept-sales'`);
    run(db, `UPDATE departments SET
              name = 'Accounts (اکاؤنٹس)',
              description = 'Financial records & expenses — salaried (ماہانہ)'
             WHERE id = 'dept-accounts'`);

    // Step 7: Make sure only the 5 essential departments are active (rest inactive)
    // Essential: dept-raw-brick, dept-transport, dept-unloading, dept-sales, dept-accounts
    const essential = ['dept-raw-brick', 'dept-transport', 'dept-unloading', 'dept-sales', 'dept-accounts'];
    const placeholder = essential.map(() => '?').join(',');
    run(db, `UPDATE departments SET is_active = 1 WHERE id IN (${placeholder})`, ...essential);
    run(db, `UPDATE departments SET is_active = 0 WHERE id NOT IN (${placeholder})`, ...essential);

    log.info('[db-init] Migration v2.8.1: departments consolidated');
  } catch (err) {
    log.warn('[db-init] Migration v2.8.1 (departments) error:', err);
  }

  // Migration v2.8.2: Merge kiln_loading stage into raw_brick_transport.
  // User requested Transport + Loading be ONE team (no separate "Kiln Loading" stage).
  // All historical production_entries with stage='kiln_loading' are re-pointed to
  // 'raw_brick_transport' so the dashboard shows ONE combined row.
  // Also re-point the work_type for any leftover 'wt-kiln-loading' rows.
  try {
    log.info('[db-init] Migration v2.8.2: merging kiln_loading stage -> raw_brick_transport');
    const affected = get<{ c: number }>(db, "SELECT COUNT(*) AS c FROM production_entries WHERE stage = 'kiln_loading'");
    if (affected && affected.c > 0) {
      run(db, "UPDATE production_entries SET stage = 'raw_brick_transport' WHERE stage = 'kiln_loading'");
      log.info(`[db-init] Migration v2.8.2: re-pointed ${affected.c} production_entries`);
    }

    // Re-point any leftover work_types whose department was dept-kiln-loading (already merged
    // in v2.8.1 but the work_type row may have been preserved).
    const leftWt = get<{ id: string }>(db, "SELECT id FROM work_types WHERE id = 'wt-kiln-loading'");
    if (leftWt) {
      // Delete it (since v2.8.1 already merged the linked data into dept-transport)
      run(db, "UPDATE production_entries SET work_type_id = 'wt-transport' WHERE work_type_id = 'wt-kiln-loading'");
      run(db, "DELETE FROM work_types WHERE id = 'wt-kiln-loading'");
      log.info('[db-init] Migration v2.8.2: removed obsolete wt-kiln-loading work type');
    }

    // Canonical names for the remaining work types (with Urdu labels)
    run(db, "UPDATE work_types SET name = 'Raw Brick Making (کچی اینٹ بنانا)' WHERE id = 'wt-raw-making'");
    run(db, "UPDATE work_types SET name = 'Transport + Loading (بھٹے تک لانا + بھٹے میں جوڑنا)', department_id = 'dept-transport' WHERE id = 'wt-transport'");
    run(db, "UPDATE work_types SET name = 'Baked Brick Unloading (پکی اینٹ نکالنا)', department_id = 'dept-unloading' WHERE id = 'wt-unloading'");
  } catch (err) {
    log.warn('[db-init] Migration v2.8.2 (stage merge) error:', err);
  }

  // Migration v2.9.3: Reset firstRunCompleted so the firewall rule is re-created
  // with the corrected -Profile Any setting (was Private,Domain in older versions).
  try {
    log.info('[db-init] Migration v2.9.3: resetting firstRunCompleted to re-create firewall rule');
    const fs = require('fs');
    const path = require('path');
    const cfgPath = path.join(app.getPath('userData'), 'network.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (cfg.firstRunCompleted === true) {
        cfg.firstRunCompleted = false;
        cfg._recreateFirewallOnNextRun = true;
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
        log.info('[db-init] Migration v2.9.3: firstRunCompleted reset — setup wizard will re-run on next launch');
      }
    }
  } catch (err) {
    log.warn('[db-init] Migration v2.9.3 (firewall reset) error:', err);
  }

  // Migration v2.9.4: Clear any access code that may have been set accidentally.
  // User reported 401 Unauthorized on mobile app login even though no access
  // code was supposed to be configured. The fix: clear the accessCode field
  // in network.json so the server doesn't require one for LAN access.
  try {
    log.info('[db-init] Migration v2.9.4: clearing access code (no LAN auth required by default)');
    const fs = require('fs');
    const path = require('path');
    const cfgPath = path.join(app.getPath('userData'), 'network.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (cfg.accessCode && cfg.accessCode.length > 0) {
        cfg.accessCode = '';
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
        log.info('[db-init] Migration v2.9.4: accessCode cleared — mobile apps can now connect without a code');
      }
    }
  } catch (err) {
    log.warn('[db-init] Migration v2.9.4 (access code clear) error:', err);
  }

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
