/**
 * Database connection singleton
 * Brick Kiln ERP - Electron main process
 *
 * Uses better-sqlite3 for synchronous, fast, embedded SQLite access.
 * Database file is stored in the OS-specific user data directory.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import log from 'electron-log';

export type DB = Database.Database;

let dbInstance: DB | null = null;

/**
 * Get the database file path.
 * - In development: ./dev-data/brick-kiln-erp.db (relative to project root)
 * - In production: <userData>/brick-kiln-erp.db
 */
export function getDbPath(): string {
  if (app && app.isPackaged) {
    return path.join(app.getPath('userData'), 'brick-kiln-erp.db');
  }
  // Development: use a local dev-data folder
  const devDir = path.join(process.cwd(), 'dev-data');
  if (!fs.existsSync(devDir)) {
    fs.mkdirSync(devDir, { recursive: true });
  }
  return path.join(devDir, 'brick-kiln-erp.db');
}

/**
 * Initialize and return the database connection singleton.
 * Caller must ensure migrations have been run.
 */
export function getDb(): DB {
  if (dbInstance) return dbInstance;

  const dbPath = getDbPath();
  log.info(`[db] Opening database at: ${dbPath}`);

  const db = new Database(dbPath);

  // Recommended pragmas for performance and reliability
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -8000'); // ~8MB cache

  dbInstance = db;
  return db;
}

/**
 * Close the database connection (used on app shutdown).
 */
export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
      log.info('[db] Database closed.');
    } catch (err) {
      log.error('[db] Error closing database:', err);
    } finally {
      dbInstance = null;
    }
  }
}

/**
 * Execute multiple SQL statements (no parameters, no return).
 * Used for schema and seed files.
 */
export function execSql(db: DB, sql: string): void {
  db.exec(sql);
}

/**
 * Run a parameterized statement.
 */
export function run(db: DB, sql: string, ...params: any[]): Database.RunResult {
  return db.prepare(sql).run(...params);
}

/**
 * Get a single row.
 */
export function get<T = any>(db: DB, sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

/**
 * Get multiple rows.
 */
export function all<T = any>(db: DB, sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

/**
 * Run a function inside a transaction.
 * If the function throws, the transaction is rolled back.
 */
export function transaction<T>(db: DB, fn: () => T): T {
  return db.transaction(fn)();
}
