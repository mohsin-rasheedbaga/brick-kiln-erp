/**
 * Batches IPC handlers.
 * Channels:
 *   - batches:list         -> paginated list with filters
 *   - batches:get          -> single batch
 *   - batches:create       -> new batch (auto-generates batch_number like BATCH-2026-0001)
 *   - batches:update       -> update batch metadata
 *   - batches:set-status   -> open | firing | completed | closed | cancelled
 *   - batches:delete       -> only if no transactions
 *   - batches:cost-summary -> recomputed cost summary (labour + fuel + transport + other + total)
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';

export interface Batch {
  id: string;
  batch_number: string;
  kiln_id: string | null;
  kiln_name?: string;
  start_date: string;
  end_date: string | null;
  status: 'open' | 'firing' | 'completed' | 'closed' | 'cancelled';
  notes: string | null;
  labour_cost: number;
  fuel_cost: number;
  transport_cost: number;
  other_cost: number;
  total_cost: number;
  raw_bricks_loaded: number;
  baked_bricks_unloaded: number;
  broken_quantity: number;
  sales_revenue: number;
  profit_loss: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const VALID_STATUSES = ['open', 'firing', 'completed', 'closed', 'cancelled'];

const BATCH_SELECT = `
  SELECT b.*,
         k.name AS kiln_name,
         (b.total_cost - b.sales_revenue) AS profit_loss
  FROM batches b
  LEFT JOIN kilns k ON b.kiln_id = k.id
`;

function rowToBatch(row: any): Batch {
  return {
    id: row.id,
    batch_number: row.batch_number,
    kiln_id: row.kiln_id,
    kiln_name: row.kiln_name,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status,
    notes: row.notes,
    labour_cost: row.labour_cost ?? 0,
    fuel_cost: row.fuel_cost ?? 0,
    transport_cost: row.transport_cost ?? 0,
    other_cost: row.other_cost ?? 0,
    total_cost: row.total_cost ?? 0,
    raw_bricks_loaded: row.raw_bricks_loaded ?? 0,
    baked_bricks_unloaded: row.baked_bricks_unloaded ?? 0,
    broken_quantity: row.broken_quantity ?? 0,
    sales_revenue: row.sales_revenue ?? 0,
    profit_loss: row.profit_loss ?? 0,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Generate the next sequential batch number like BATCH-2026-0001.
 */
function generateBatchNumber(db: any): string {
  const year = new Date().getFullYear();
  const row = get<{ batch_number: string }>(
    db,
    "SELECT batch_number FROM batches WHERE batch_number LIKE ? ORDER BY batch_number DESC LIMIT 1",
    `BATCH-${year}-%`
  );
  let next = 1;
  if (row && row.batch_number) {
    const match = row.batch_number.match(/BATCH-\d{4}-(\d+)/);
    if (match) next = parseInt(match[1], 10) + 1;
  }
  return `BATCH-${year}-${String(next).padStart(4, '0')}`;
}

export function registerBatchHandlers(): void {
  ipcMain.handle('batches:list', async (_evt, args: {
    token: string;
    status?: string;
    kilnId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<IpcResult<{ items: Batch[]; total: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');

      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.status) { where.push('b.status = ?'); params.push(args.status); }
      if (args.kilnId) { where.push('b.kiln_id = ?'); params.push(args.kilnId); }
      if (args.search) {
        where.push('(b.batch_number LIKE ? OR b.notes LIKE ?)');
        const q = `%${args.search}%`;
        params.push(q, q);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 50, 500);
      const offset = Math.max(args.offset ?? 0, 0);
      const countRow = get<{ c: number }>(db, `SELECT COUNT(*) as c FROM batches b ${whereSql}`, ...params);
      const rows = all<any>(db, `${BATCH_SELECT} ${whereSql} ORDER BY b.start_date DESC, b.batch_number DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      return { items: rows.map(rowToBatch), total: countRow?.c ?? 0 };
    })();
  });

  ipcMain.handle('batches:get', async (_evt, args: { token: string; id: string }): Promise<IpcResult<Batch | null>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const row = get<any>(db, `${BATCH_SELECT} WHERE b.id = ?`, args.id);
      return row ? rowToBatch(row) : null;
    })();
  });

  ipcMain.handle('batches:create', async (_evt, args: {
    token: string;
    kilnId?: string;
    startDate?: string;
    notes?: string;
  }): Promise<IpcResult<Batch>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('batches.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to create batches.');
      }

      const db = getDb();
      if (args.kilnId) {
        const k = get<{ id: string }>(db, 'SELECT id FROM kilns WHERE id = ?', args.kilnId);
        if (!k) throw new Error('Kiln not found.');
      }

      const id = uuidv4();
      const batchNumber = generateBatchNumber(db);
      const startDate = args.startDate || new Date().toISOString().slice(0, 10);

      transaction(db, () => {
        run(
          db,
          `INSERT INTO batches (id, batch_number, kiln_id, start_date, end_date, status, notes,
             labour_cost, fuel_cost, transport_cost, other_cost, total_cost,
             raw_bricks_loaded, baked_bricks_unloaded, broken_quantity, sales_revenue, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, 'open', ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?, datetime('now'), datetime('now'))`,
          id, batchNumber, args.kilnId ?? null, startDate, args.notes ?? null, session.userId
        );
        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'batches',
          entityId: id,
          entityType: 'batch',
          description: `Created batch ${batchNumber}`,
        });
      });

      const row = get<any>(db, `${BATCH_SELECT} WHERE b.id = ?`, id);
      return rowToBatch(row!);
    })();
  });

  ipcMain.handle('batches:update', async (_evt, args: {
    token: string;
    id: string;
    kilnId?: string | null;
    startDate?: string;
    endDate?: string | null;
    notes?: string;
    fuelCost?: number;
    otherCost?: number;
    brokenQuantity?: number;
  }): Promise<IpcResult<Batch>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('batches.edit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to edit batches.');
      }

      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM batches WHERE id = ?', args.id);
      if (!existing) throw new Error('Batch not found.');

      const updates: string[] = [];
      const params: any[] = [];
      if (args.kilnId !== undefined) {
        if (args.kilnId) {
          const k = get<{ id: string }>(db, 'SELECT id FROM kilns WHERE id = ?', args.kilnId);
          if (!k) throw new Error('Kiln not found.');
        }
        updates.push('kiln_id = ?'); params.push(args.kilnId);
      }
      if (args.startDate !== undefined) { updates.push('start_date = ?'); params.push(args.startDate); }
      if (args.endDate !== undefined) { updates.push('end_date = ?'); params.push(args.endDate); }
      if (args.notes !== undefined) { updates.push('notes = ?'); params.push(args.notes); }
      if (args.fuelCost !== undefined) {
        const v = Number(args.fuelCost);
        if (isNaN(v) || v < 0) throw new Error('Fuel cost must be a non-negative number.');
        updates.push('fuel_cost = ?'); params.push(v);
      }
      if (args.otherCost !== undefined) {
        const v = Number(args.otherCost);
        if (isNaN(v) || v < 0) throw new Error('Other cost must be a non-negative number.');
        updates.push('other_cost = ?'); params.push(v);
      }
      if (args.brokenQuantity !== undefined) {
        const v = Number(args.brokenQuantity);
        if (!Number.isInteger(v) || v < 0) throw new Error('Broken quantity must be a non-negative integer.');
        updates.push('broken_quantity = ?'); params.push(v);
      }

      // Always recompute total_cost when any cost component changes
      if (args.fuelCost !== undefined || args.otherCost !== undefined) {
        const labour = args.fuelCost !== undefined ? existing.labour_cost : existing.labour_cost; // labour & transport not directly editable here
        const transport = existing.transport_cost;
        const fuel = args.fuelCost !== undefined ? Number(args.fuelCost) : existing.fuel_cost;
        const other = args.otherCost !== undefined ? Number(args.otherCost) : existing.other_cost;
        const total = labour + transport + fuel + other;
        updates.push('total_cost = ?'); params.push(total);
      }

      if (updates.length === 0) throw new Error('No fields to update.');
      updates.push("updated_at = datetime('now')");
      params.push(args.id);

      transaction(db, () => {
        run(db, `UPDATE batches SET ${updates.join(', ')} WHERE id = ?`, ...params);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'update',
          module: 'batches',
          entityId: args.id,
          entityType: 'batch',
          description: `Updated batch ${existing.batch_number}`,
        });
      });

      const row = get<any>(db, `${BATCH_SELECT} WHERE b.id = ?`, args.id);
      return rowToBatch(row!);
    })();
  });

  ipcMain.handle('batches:set-status', async (_evt, args: { token: string; id: string; status: string; endDate?: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('batches.edit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to update batches.');
      }
      if (!VALID_STATUSES.includes(args.status)) throw new Error('Invalid batch status.');

      const db = getDb();
      const existing = get<{ batch_number: string }>(db, 'SELECT batch_number FROM batches WHERE id = ?', args.id);
      if (!existing) throw new Error('Batch not found.');

      const endDate = (args.status === 'completed' || args.status === 'closed')
        ? (args.endDate || new Date().toISOString().slice(0, 10))
        : null;

      transaction(db, () => {
        run(db, "UPDATE batches SET status = ?, end_date = ?, updated_at = datetime('now') WHERE id = ?", args.status, endDate, args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'status_change',
          module: 'batches',
          entityId: args.id,
          entityType: 'batch',
          description: `Set batch ${existing.batch_number} status to ${args.status}`,
        });
      });
      return { success: true } as const;
    })();
  });

  ipcMain.handle('batches:delete', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('batches.edit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to delete batches.');
      }

      const db = getDb();
      const existing = get<{ batch_number: string }>(db, 'SELECT batch_number FROM batches WHERE id = ?', args.id);
      if (!existing) throw new Error('Batch not found.');

      const prodCount = get<{ c: number }>(db, 'SELECT COUNT(*) as c FROM production_entries WHERE batch_id = ?', args.id);
      const saleCount = get<{ c: number }>(db, 'SELECT COUNT(*) as c FROM sales_invoices WHERE batch_id = ?', args.id);
      const totalTrans = (prodCount?.c ?? 0) + (saleCount?.c ?? 0);
      if (totalTrans > 0) {
        throw new Error(`Cannot delete batch: ${totalTrans} transaction(s) exist. Close the batch instead.`);
      }

      transaction(db, () => {
        run(db, 'DELETE FROM batches WHERE id = ?', args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'delete',
          module: 'batches',
          entityId: args.id,
          entityType: 'batch',
          description: `Deleted batch ${existing.batch_number}`,
        });
      });
      return { success: true } as const;
    })();
  });

  ipcMain.handle('batches:cost-summary', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{
    batch: Batch;
    production_by_stage: Array<{ stage: string; total_qty: number; total_labour: number }>;
    expense_breakdown: Array<{ category: string; total: number }>;
    sales_count: number;
    sales_total: number;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const batchRow = get<any>(db, `${BATCH_SELECT} WHERE b.id = ?`, args.id);
      if (!batchRow) throw new Error('Batch not found.');

      const prodByStage = all<{ stage: string; total_qty: number; total_labour: number }>(
        db,
        `SELECT stage,
                COALESCE(SUM(quantity), 0) AS total_qty,
                COALESCE(SUM(labour_amount), 0) AS total_labour
         FROM production_entries WHERE batch_id = ?
         GROUP BY stage ORDER BY stage`,
        args.id
      );

      const expByCat = all<{ category: string; total: number }>(
        db,
        `SELECT ec.name AS category, COALESCE(SUM(e.amount), 0) AS total
         FROM expenses e
         LEFT JOIN expense_categories ec ON e.category_id = ec.id
         WHERE e.batch_id = ? AND e.is_void = 0
         GROUP BY ec.name`,
        args.id
      );

      const salesCount = get<{ c: number; total: number }>(
        db,
        `SELECT COUNT(*) as c, COALESCE(SUM(total), 0) AS total FROM sales_invoices WHERE batch_id = ? AND is_void = 0`,
        args.id
      );

      return {
        batch: rowToBatch(batchRow),
        production_by_stage: prodByStage,
        expense_breakdown: expByCat,
        sales_count: salesCount?.c ?? 0,
        sales_total: salesCount?.total ?? 0,
      };
    })();
  });
}
