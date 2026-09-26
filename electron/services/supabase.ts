/**
 * Supabase Sync Service
 *
 * Handles pushing local SQLite data to Supabase (PostgreSQL) and pulling
 * remote changes back. Designed for offline-first operation:
 *   - All daily operations use local SQLite (no internet required)
 *   - When internet is available, user can trigger sync
 *   - Sync is bidirectional with last-write-wins conflict resolution
 *
 * The Supabase project schema must match the local tables. A SQL file
 * for creating the Supabase schema is provided in docs/supabase-schema.sql.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getDb, get, all, run } from '../database/connection';
import { getDbPath } from '../database/connection';
import log from 'electron-log';

// Tables to sync (in dependency order — parents before children)
const SYNC_TABLES = [
  'departments',
  'work_types',
  'brick_categories',
  'expense_categories',
  'kilns',
  'workers',
  'batches',
  'production_entries',
  'sales_invoices',
  'sales_invoice_items',
  'customer_payments',
  'expenses',
  'worker_advances',
  'worker_payments',
  'cash_movements',
  'stock_movements',
  'stock',
  'customers',
  'department_rates',
  'worker_family',
  'payroll_runs',
  'payroll_run_items',
];

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (client) return client;

  const db = getDb();
  const settings = get<{
    supabase_enabled: number;
    supabase_url: string | null;
    supabase_anon_key: string | null;
  }>(db, 'SELECT supabase_enabled, supabase_url, supabase_anon_key FROM settings WHERE id = 1');

  if (!settings?.supabase_enabled || !settings.supabase_url || !settings.supabase_anon_key) {
    return null;
  }

  try {
    client = createClient(settings.supabase_url, settings.supabase_anon_key, {
      auth: { persistSession: false },
    });
    log.info('[supabase] Client initialized for', settings.supabase_url);
    return client;
  } catch (err) {
    log.error('[supabase] Failed to initialize client:', err);
    return null;
  }
}

/**
 * Reset the client (called when settings change).
 */
export function resetClient(): void {
  client = null;
}

export interface SyncResult {
  table_name: string;
  pushed: number;
  pulled: number;
  errors: string[];
}

/**
 * Push local data for a single table to Supabase.
 * Uses upsert (insert on conflict update).
 */
async function pushTable(supabase: SupabaseClient, tableName: string): Promise<{ pushed: number; errors: string[] }> {
  const db = getDb();
  const errors: string[] = [];

  // Get last sync time for this table
  const syncState = get<{ last_sync_at: string }>(
    db,
    'SELECT last_sync_at FROM cloud_sync_state WHERE table_name = ?',
    tableName
  );
  const lastSync = syncState?.last_sync_at || '1970-01-01';

  // Get rows updated since last sync
  // Note: all our tables have updated_at column
  const rows = all<any>(db, `SELECT * FROM ${tableName} WHERE updated_at > ? OR updated_at IS NULL`, lastSync);

  if (rows.length === 0) {
    return { pushed: 0, errors: [] };
  }

  // Push in batches of 100
  const batchSize = 100;
  let pushed = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from(tableName).upsert(batch, { onConflict: 'id' });
    if (error) {
      log.error(`[supabase] Push error for ${tableName}:`, error.message);
      errors.push(`${tableName}: ${error.message}`);
    } else {
      pushed += batch.length;
    }
  }

  return { pushed, errors };
}

/**
 * Pull remote data for a single table from Supabase.
 * Fetches rows updated since last sync.
 */
async function pullTable(supabase: SupabaseClient, tableName: string): Promise<{ pulled: number; errors: string[] }> {
  const db = getDb();
  const errors: string[] = [];

  const syncState = get<{ last_sync_at: string }>(
    db,
    'SELECT last_sync_at FROM cloud_sync_state WHERE table_name = ?',
    tableName
  );
  const lastSync = syncState?.last_sync_at || '1970-01-01';

  // Fetch from Supabase where updated_at > lastSync
  const { data, error } = await supabase
    .from(tableName)
    .select('*')
    .gt('updated_at', lastSync)
    .order('updated_at', { ascending: true })
    .limit(1000);

  if (error) {
    log.error(`[supabase] Pull error for ${tableName}:`, error.message);
    errors.push(`${tableName}: ${error.message}`);
    return { pulled: 0, errors };
  }

  if (!data || data.length === 0) {
    return { pulled: 0, errors: [] };
  }

  // Upsert into local SQLite
  let pulled = 0;
  for (const row of data) {
    const columns = Object.keys(row);
    const placeholders = columns.map(() => '?').join(', ');
    const colList = columns.join(', ');
    const updateSet = columns.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ');

    try {
      run(
        db,
        `INSERT INTO ${tableName} (${colList}) VALUES (${placeholders})
         ON CONFLICT(id) DO UPDATE SET ${updateSet}`,
        ...columns.map(c => row[c])
      );
      pulled++;
    } catch (err: any) {
      log.warn(`[supabase] Row upsert error (${tableName}):`, err.message);
    }
  }

  return { pulled, errors };
}

/**
 * Run a full sync: push local changes, then pull remote changes.
 */
export async function syncAll(): Promise<{
  success: boolean;
  results: SyncResult[];
  total_pushed: number;
  total_pulled: number;
  errors: string[];
}> {
  const supabase = getClient();
  if (!supabase) {
    return {
      success: false,
      results: [],
      total_pushed: 0,
      total_pulled: 0,
      errors: ['Supabase is not configured. Enable it in Settings → Cloud Sync.'],
    };
  }

  const db = getDb();
  const results: SyncResult[] = [];
  let totalPushed = 0;
  let totalPulled = 0;
  const allErrors: string[] = [];

  for (const tableName of SYNC_TABLES) {
    const result: SyncResult = { table_name: tableName, pushed: 0, pulled: 0, errors: [] };

    // Push
    try {
      const pushResult = await pushTable(supabase, tableName);
      result.pushed = pushResult.pushed;
      result.errors.push(...pushResult.errors);
      totalPushed += pushResult.pushed;
    } catch (err: any) {
      result.errors.push(`push: ${err.message}`);
    }

    // Pull
    try {
      const pullResult = await pullTable(supabase, tableName);
      result.pulled = pullResult.pulled;
      result.errors.push(...pullResult.errors);
      totalPulled += pullResult.pulled;
    } catch (err: any) {
      result.errors.push(`pull: ${err.message}`);
    }

    // Update sync state
    const now = new Date().toISOString();
    run(
      db,
      `INSERT INTO cloud_sync_state (table_name, last_sync_at, last_sync_direction, last_sync_status, records_pushed, records_pulled, error_message, updated_at)
       VALUES (?, ?, 'both', ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(table_name) DO UPDATE SET
         last_sync_at = excluded.last_sync_at,
         last_sync_direction = 'both',
         last_sync_status = excluded.last_sync_status,
         records_pushed = excluded.records_pushed,
         records_pulled = excluded.records_pulled,
         error_message = excluded.error_message,
         updated_at = datetime('now')`,
      tableName, now,
      result.errors.length === 0 ? 'success' : 'partial',
      result.pushed, result.pulled,
      result.errors.length > 0 ? result.errors.join('; ') : null
    );

    allErrors.push(...result.errors);
    results.push(result);
  }

  log.info(`[supabase] Sync complete: pushed ${totalPushed}, pulled ${totalPulled}, errors ${allErrors.length}`);

  return {
    success: allErrors.length === 0,
    results,
    total_pushed: totalPushed,
    total_pulled: totalPulled,
    errors: allErrors,
  };
}

/**
 * Get the current sync status (last sync per table).
 */
export function getSyncStatus(): Array<{
  table_name: string;
  last_sync_at: string;
  last_sync_status: string;
  records_pushed: number;
  records_pulled: number;
  error_message: string | null;
}> {
  const db = getDb();
  const rows = all<any>(
    db,
    'SELECT table_name, last_sync_at, last_sync_status, records_pushed, records_pulled, error_message FROM cloud_sync_state ORDER BY table_name'
  );
  return rows;
}

/**
 * Test the Supabase connection.
 */
export async function testConnection(): Promise<{ success: boolean; message: string }> {
  const supabase = getClient();
  if (!supabase) {
    return { success: false, message: 'Supabase is not configured.' };
  }

  try {
    const { error } = await supabase.from('departments').select('id').limit(1);
    if (error) {
      return { success: false, message: `Connection failed: ${error.message}` };
    }
    return { success: true, message: 'Connection successful! Supabase is reachable.' };
  } catch (err: any) {
    return { success: false, message: `Connection error: ${err.message}` };
  }
}
