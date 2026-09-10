/**
 * Production IPC handlers.
 *
 * Production entries cover four stages:
 *   - raw_brick_making
 *   - raw_brick_transport
 *   - kiln_loading
 *   - baked_brick_unloading
 *
 * Each entry:
 *   - validates quantity > 0 and rate >= 0
 *   - auto-computes labour_amount = (quantity / 1000) * rate_per_1000
 *   - updates the relevant batch totals
 *   - if stage = baked_brick_unloading, also creates a stock movement (production_in)
 *
 * Channels:
 *   - production:create  -> ProductionEntry
 *   - production:list    -> paginated list
 *   - production:update  -> updated entry
 *   - production:delete  -> void/delete entry (reverses batch totals & stock)
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, wrap, type IpcResult } from '../utils/ipc';

export interface ProductionEntry {
  id: string;
  stage: 'raw_brick_making' | 'raw_brick_transport' | 'kiln_loading' | 'baked_brick_unloading';
  date: string;
  batch_id: string | null;
  batch_number?: string;
  kiln_id: string | null;
  kiln_name?: string;
  worker_id: string;
  worker_name?: string;
  worker_code?: string;
  department_id: string;
  department_name?: string;
  work_type_id: string;
  work_type_name?: string;
  quantity: number;
  rate_per_1000: number;
  labour_amount: number;
  transport_method: string | null;
  notes: string | null;
  entered_by: string;
  entered_by_name?: string;
  created_at: string;
  updated_at: string;
}

const VALID_STAGES = ['raw_brick_making', 'raw_brick_transport', 'kiln_loading', 'baked_brick_unloading'];

const PRODUCTION_SELECT = `
  SELECT pe.*,
         w.full_name AS worker_name, w.worker_code,
         d.name AS department_name,
         wt.name AS work_type_name,
         b.batch_number,
         k.name AS kiln_name,
         u.full_name AS entered_by_name
  FROM production_entries pe
  LEFT JOIN workers w ON pe.worker_id = w.id
  LEFT JOIN departments d ON pe.department_id = d.id
  LEFT JOIN work_types wt ON pe.work_type_id = wt.id
  LEFT JOIN batches b ON pe.batch_id = b.id
  LEFT JOIN kilns k ON pe.kiln_id = k.id
  LEFT JOIN users u ON pe.entered_by = u.id
`;

function rowToEntry(row: any): ProductionEntry {
  return {
    id: row.id,
    stage: row.stage,
    date: row.date,
    batch_id: row.batch_id,
    batch_number: row.batch_number,
    kiln_id: row.kiln_id,
    kiln_name: row.kiln_name,
    worker_id: row.worker_id,
    worker_name: row.worker_name,
    worker_code: row.worker_code,
    department_id: row.department_id,
    department_name: row.department_name,
    work_type_id: row.work_type_id,
    work_type_name: row.work_type_name,
    quantity: row.quantity,
    rate_per_1000: row.rate_per_1000,
    labour_amount: row.labour_amount,
    transport_method: row.transport_method,
    notes: row.notes,
    entered_by: row.entered_by,
    entered_by_name: row.entered_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Update batch aggregate totals after a production entry is created/updated/deleted.
 * For simplicity we recompute from scratch each time.
 */
function recomputeBatchTotals(db: any, batchId: string): void {
  if (!batchId) return;
  const labourRow = get<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(labour_amount),0) AS total FROM production_entries WHERE batch_id = ?`,
    batchId
  );
  const qtyRow = get<{ loaded: number; unloaded: number }>(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN stage = 'kiln_loading' THEN quantity ELSE 0 END),0) AS loaded,
       COALESCE(SUM(CASE WHEN stage = 'baked_brick_unloading' THEN quantity ELSE 0 END),0) AS unloaded
     FROM production_entries WHERE batch_id = ?`,
    batchId
  );
  const totalLabour = labourRow?.total ?? 0;
  const loaded = qtyRow?.loaded ?? 0;
  const unloaded = qtyRow?.unloaded ?? 0;

  // Add labour-related expenses (transport cost is captured separately)
  const transRow = get<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(CASE WHEN stage = 'raw_brick_transport' THEN labour_amount ELSE 0 END),0) AS total FROM production_entries WHERE batch_id = ?`,
    batchId
  );
  const transportCost = transRow?.total ?? 0;

  run(db, `UPDATE batches SET labour_cost = ?, transport_cost = ?, total_cost = labour_cost + transport_cost + fuel_cost + other_cost,
           raw_bricks_loaded = ?, baked_bricks_unloaded = ?, updated_at = datetime('now') WHERE id = ?`,
    totalLabour, transportCost, loaded, unloaded, batchId);
}

/**
 * Update stock for baked brick unloading entries.
 * Each unloading creates a stock_movement row + updates the running stock balance.
 * We assume one category at a time per entry — category is derived from notes or
 * default to 'A Grade'. For a real implementation, production entries for
 * baked_brick_unloading would carry an explicit category_id; for now we add an
 * optional category_id column via ALTER if not present, or fall back to first
 * active category.
 */
function getOrCreateStockRow(db: any, categoryId: string): number {
  const row = get<{ quantity: number }>(db, 'SELECT quantity FROM stock WHERE category_id = ?', categoryId);
  if (row) return row.quantity;
  run(db, "INSERT INTO stock (category_id, quantity, last_updated) VALUES (?, 0, datetime('now'))", categoryId);
  return 0;
}

function adjustStock(db: any, categoryId: string, delta: number, movementType: string, referenceId: string, batchId: string | null, notes: string | null, userId: string): void {
  const current = getOrCreateStockRow(db, categoryId);
  const newQty = current + delta;
  if (newQty < 0) throw new Error('Stock cannot become negative for this category.');
  run(db, "UPDATE stock SET quantity = ?, last_updated = datetime('now') WHERE category_id = ?", newQty, categoryId);
  run(
    db,
    `INSERT INTO stock_movements (id, date, category_id, movement_type, quantity, reference_type, reference_id, batch_id, notes, entered_by, created_at)
     VALUES (?, date('now'), ?, ?, ?, 'production', ?, ?, ?, ?, datetime('now'))`,
    uuidv4(), categoryId, movementType, delta, referenceId, batchId, notes, userId
  );
}

export function registerProductionHandlers(): void {
  ipcMain.handle('production:create', async (_evt, args: {
    token: string;
    stage: string;
    date?: string;
    batchId?: string;
    kilnId?: string;
    workerId: string;
    departmentId: string;
    workTypeId: string;
    quantity: number;
    ratePer1000?: number;
    transportMethod?: string;
    notes?: string;
    categoryId?: string;            // for baked_brick_unloading stage
  }): Promise<IpcResult<ProductionEntry>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('production.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to create production entries.');
      }
      if (!VALID_STAGES.includes(args.stage)) throw new Error('Invalid production stage.');
      if (!Number.isInteger(args.quantity) || args.quantity <= 0) throw new Error('Quantity must be a positive integer.');
      if (!args.workerId) throw new Error('Worker is required.');
      if (!args.departmentId) throw new Error('Department is required.');
      if (!args.workTypeId) throw new Error('Work type is required.');

      const db = getDb();
      // Validate worker, department, work_type
      const worker = get<{ id: string; rate_per_1000: number }>(db, 'SELECT id, rate_per_1000 FROM workers WHERE id = ?', args.workerId);
      if (!worker) throw new Error('Worker not found.');
      const dept = get<{ id: string }>(db, 'SELECT id FROM departments WHERE id = ?', args.departmentId);
      if (!dept) throw new Error('Department not found.');
      const wt = get<{ id: string; default_rate_per_1000: number }>(db, 'SELECT id, default_rate_per_1000 FROM work_types WHERE id = ?', args.workTypeId);
      if (!wt) throw new Error('Work type not found.');

      // Rate: explicit > worker's rate > work type default
      const rate = args.ratePer1000 !== undefined ? Number(args.ratePer1000) : (worker.rate_per_1000 || wt.default_rate_per_1000);
      if (isNaN(rate) || rate < 0) throw new Error('Rate must be a non-negative number.');

      const labourAmount = (args.quantity / 1000) * rate;
      const date = args.date || new Date().toISOString().slice(0, 10);
      const id = uuidv4();

      // Validate batch if provided
      if (args.batchId) {
        const batch = get<{ id: string }>(db, 'SELECT id FROM batches WHERE id = ?', args.batchId);
        if (!batch) throw new Error('Batch not found.');
      }
      if (args.kilnId) {
        const kiln = get<{ id: string }>(db, 'SELECT id FROM kilns WHERE id = ?', args.kilnId);
        if (!kiln) throw new Error('Kiln not found.');
      }

      transaction(db, () => {
        run(
          db,
          `INSERT INTO production_entries (id, stage, date, batch_id, kiln_id, worker_id, department_id, work_type_id,
            quantity, rate_per_1000, labour_amount, transport_method, notes, entered_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          id, args.stage, date, args.batchId ?? null, args.kilnId ?? null, args.workerId, args.departmentId, args.workTypeId,
          args.quantity, rate, labourAmount, args.transportMethod ?? null, args.notes ?? null, session.userId
        );

        // Recompute batch totals
        if (args.batchId) recomputeBatchTotals(db, args.batchId);

        // Update stock on baked_brick_unloading
        if (args.stage === 'baked_brick_unloading') {
          const categoryId = args.categoryId || 'cat-a';
          adjustStock(db, categoryId, args.quantity, 'production_in', id, args.batchId ?? null, args.notes, session.userId);
        }

        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'production',
          entityId: id,
          entityType: 'production_entry',
          description: `Recorded ${args.stage}: qty=${args.quantity}, labour=${labourAmount.toFixed(2)}`,
          newValues: { stage: args.stage, quantity: args.quantity, rate, labour_amount: labourAmount, worker_id: args.workerId },
        });
      });

      const row = get<any>(db, `${PRODUCTION_SELECT} WHERE pe.id = ?`, id);
      return rowToEntry(row!);
    })();
  });

  ipcMain.handle('production:list', async (_evt, args: {
    token: string;
    stage?: string;
    workerId?: string;
    departmentId?: string;
    batchId?: string;
    kilnId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<IpcResult<{ items: ProductionEntry[]; total: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('production.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view production entries.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.stage) { where.push('pe.stage = ?'); params.push(args.stage); }
      if (args.workerId) { where.push('pe.worker_id = ?'); params.push(args.workerId); }
      if (args.departmentId) { where.push('pe.department_id = ?'); params.push(args.departmentId); }
      if (args.batchId) { where.push('pe.batch_id = ?'); params.push(args.batchId); }
      if (args.kilnId) { where.push('pe.kiln_id = ?'); params.push(args.kilnId); }
      if (args.from) { where.push('pe.date >= ?'); params.push(args.from); }
      if (args.to)   { where.push('pe.date <= ?'); params.push(args.to); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 100, 1000);
      const offset = Math.max(args.offset ?? 0, 0);
      const countRow = get<{ c: number }>(db, `SELECT COUNT(*) as c FROM production_entries pe ${whereSql}`, ...params);
      const rows = all<any>(db, `${PRODUCTION_SELECT} ${whereSql} ORDER BY pe.date DESC, pe.created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      return { items: rows.map(rowToEntry), total: countRow?.c ?? 0 };
    })();
  });

  ipcMain.handle('production:update', async (_evt, args: {
    token: string;
    id: string;
    date?: string;
    batchId?: string | null;
    kilnId?: string | null;
    workerId?: string;
    departmentId?: string;
    workTypeId?: string;
    quantity?: number;
    ratePer1000?: number;
    transportMethod?: string | null;
    notes?: string | null;
    categoryId?: string;
  }): Promise<IpcResult<ProductionEntry>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('production.edit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to edit production entries.');
      }
      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM production_entries WHERE id = ?', args.id);
      if (!existing) throw new Error('Production entry not found.');

      // For baked_brick_unloading, editing quantity means adjusting stock.
      // We don't support changing stage here — that's a destructive operation.
      const updates: string[] = [];
      const params: any[] = [];
      let newQty = existing.quantity;
      let newRate = existing.rate_per_1000;
      let newLabour = existing.labour_amount;
      let needStockAdjust = false;

      if (args.date !== undefined) { updates.push('date = ?'); params.push(args.date); }
      if (args.batchId !== undefined) { updates.push('batch_id = ?'); params.push(args.batchId); }
      if (args.kilnId !== undefined) { updates.push('kiln_id = ?'); params.push(args.kilnId); }
      if (args.workerId !== undefined) {
        const w = get<{ id: string }>(db, 'SELECT id FROM workers WHERE id = ?', args.workerId);
        if (!w) throw new Error('Worker not found.');
        updates.push('worker_id = ?'); params.push(args.workerId);
      }
      if (args.departmentId !== undefined) {
        const d = get<{ id: string }>(db, 'SELECT id FROM departments WHERE id = ?', args.departmentId);
        if (!d) throw new Error('Department not found.');
        updates.push('department_id = ?'); params.push(args.departmentId);
      }
      if (args.workTypeId !== undefined) {
        const wt = get<{ id: string }>(db, 'SELECT id FROM work_types WHERE id = ?', args.workTypeId);
        if (!wt) throw new Error('Work type not found.');
        updates.push('work_type_id = ?'); params.push(args.workTypeId);
      }
      if (args.quantity !== undefined) {
        if (!Number.isInteger(args.quantity) || args.quantity <= 0) throw new Error('Quantity must be a positive integer.');
        updates.push('quantity = ?'); params.push(args.quantity);
        newQty = args.quantity;
        needStockAdjust = existing.stage === 'baked_brick_unloading';
      }
      if (args.ratePer1000 !== undefined) {
        const v = Number(args.ratePer1000);
        if (isNaN(v) || v < 0) throw new Error('Rate must be a non-negative number.');
        updates.push('rate_per_1000 = ?'); params.push(v);
        newRate = v;
      }
      if (args.transportMethod !== undefined) { updates.push('transport_method = ?'); params.push(args.transportMethod); }
      if (args.notes !== undefined) { updates.push('notes = ?'); params.push(args.notes); }

      // Recompute labour if quantity or rate changed
      if (args.quantity !== undefined || args.ratePer1000 !== undefined) {
        newLabour = (newQty / 1000) * newRate;
        updates.push('labour_amount = ?'); params.push(newLabour);
      }

      if (updates.length === 0) throw new Error('No fields to update.');
      updates.push("updated_at = datetime('now')");
      params.push(args.id);

      transaction(db, () => {
        run(db, `UPDATE production_entries SET ${updates.join(', ')} WHERE id = ?`, ...params);

        if (needStockAdjust) {
          // Reverse the old stock movement and create a new one for the new quantity
          const categoryId = args.categoryId || 'cat-a';
          const delta = newQty - existing.quantity;
          adjustStock(db, categoryId, delta, 'adjustment_in', args.id, existing.batch_id, `Edited production entry ${args.id}`, session.userId);
        }

        if (existing.batch_id) recomputeBatchTotals(db, existing.batch_id);

        audit({
          userId: session.userId,
          username: session.username,
          action: 'update',
          module: 'production',
          entityId: args.id,
          entityType: 'production_entry',
          description: `Updated production entry`,
          oldValues: { quantity: existing.quantity, rate: existing.rate_per_1000 },
          newValues: { quantity: newQty, rate: newRate },
        });
      });

      const row = get<any>(db, `${PRODUCTION_SELECT} WHERE pe.id = ?`, args.id);
      return rowToEntry(row!);
    })();
  });

  ipcMain.handle('production:delete', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('production.delete') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to delete production entries.');
      }
      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM production_entries WHERE id = ?', args.id);
      if (!existing) throw new Error('Production entry not found.');

      transaction(db, () => {
        // Reverse stock if baked_brick_unloading
        if (existing.stage === 'baked_brick_unloading') {
          adjustStock(db, 'cat-a', -existing.quantity, 'adjustment_out', args.id, existing.batch_id, `Deleted production entry ${args.id}`, session.userId);
        }
        run(db, 'DELETE FROM production_entries WHERE id = ?', args.id);
        if (existing.batch_id) recomputeBatchTotals(db, existing.batch_id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'delete',
          module: 'production',
          entityId: args.id,
          entityType: 'production_entry',
          description: `Deleted production entry (${existing.stage}, qty=${existing.quantity})`,
        });
      });
      return { success: true } as const;
    })();
  });
}
