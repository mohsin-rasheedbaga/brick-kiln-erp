/**
 * Stock Adjustments IPC handlers.
 *
 * Channels:
 *   - stock:balance                   -> current stock levels for all categories
 *   - stock:movements                 -> paginated movement history with filters
 *   - stock:adjustment                -> manual adjustment (in or out, with reason)
 *   - stock:adjustments:list          -> list of manual adjustments only
 *
 * Manual adjustments create stock_movement rows with movement_type='adjustment_in' or 'adjustment_out'.
 * These appear in the audit trail alongside automatic movements from sales/production.
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';

export interface StockBalance {
  category_id: string;
  category_name: string;
  category_code: string;
  quantity: number;
  default_selling_rate: number;
  is_active: boolean;
}

export interface StockMovement {
  id: string;
  date: string;
  category_id: string;
  category_name?: string;
  movement_type: string;
  quantity: number;          // positive = in, negative = out
  reference_type: string | null;
  reference_id: string | null;
  batch_id: string | null;
  batch_number?: string;
  notes: string | null;
  entered_by: string;
  entered_by_name?: string;
  created_at: string;
}

const MOVEMENT_SELECT = `
  SELECT sm.*,
         bc.name AS category_name,
         b.batch_number AS batch_number,
         u.full_name AS entered_by_name
  FROM stock_movements sm
  LEFT JOIN brick_categories bc ON sm.category_id = bc.id
  LEFT JOIN batches b ON sm.batch_id = b.id
  LEFT JOIN users u ON sm.entered_by = u.id
`;

function rowToMovement(row: any): StockMovement {
  return {
    id: row.id,
    date: row.date,
    category_id: row.category_id,
    category_name: row.category_name,
    movement_type: row.movement_type,
    quantity: row.quantity ?? 0,
    reference_type: row.reference_type,
    reference_id: row.reference_id,
    batch_id: row.batch_id,
    batch_number: row.batch_number,
    notes: row.notes,
    entered_by: row.entered_by,
    entered_by_name: row.entered_by_name,
    created_at: row.created_at,
  };
}

export function registerStockHandlers(): void {
  // Current stock levels for all active categories
  ipcMain.handle('stock:balance', async (_evt, args: { token: string; includeInactive?: boolean }): Promise<IpcResult<StockBalance[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('stock.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view stock.');
      }
      const db = getDb();
      const where = args.includeInactive ? '' : 'WHERE bc.is_active = 1';
      const rows = all<any>(
        db,
        `SELECT bc.id AS category_id, bc.name AS category_name, bc.code AS category_code,
                bc.default_selling_rate, bc.is_active,
                COALESCE(s.quantity, 0) AS quantity
         FROM brick_categories bc
         LEFT JOIN stock s ON s.category_id = bc.id
         ${where}
         ORDER BY bc.sort_order, bc.name`
      );
      return rows.map((r) => ({
        category_id: r.category_id,
        category_name: r.category_name,
        category_code: r.category_code,
        quantity: r.quantity,
        default_selling_rate: r.default_selling_rate,
        is_active: !!r.is_active,
      }));
    })();
  });

  // Movement history with filters
  ipcMain.handle('stock:movements', async (_evt, args: {
    token: string;
    categoryId?: string;
    movementType?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<IpcResult<{ items: StockMovement[]; total: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('stock.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view stock movements.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.categoryId) { where.push('sm.category_id = ?'); params.push(args.categoryId); }
      if (args.movementType) { where.push('sm.movement_type = ?'); params.push(args.movementType); }
      if (args.from) { where.push('sm.date >= ?'); params.push(args.from); }
      if (args.to) { where.push('sm.date <= ?'); params.push(args.to); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 100, 1000);
      const offset = Math.max(args.offset ?? 0, 0);
      const countRow = get<{ c: number }>(db, `SELECT COUNT(*) as c FROM stock_movements sm ${whereSql}`, ...params);
      const rows = all<any>(db, `${MOVEMENT_SELECT} ${whereSql} ORDER BY sm.date DESC, sm.created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      return { items: rows.map(rowToMovement), total: countRow?.c ?? 0 };
    })();
  });

  // Manual adjustment (in or out, with reason)
  ipcMain.handle('stock:adjustment', async (_evt, args: {
    token: string;
    date?: string;
    categoryId: string;
    direction: 'in' | 'out';
    quantity: number;
    reason: string;
    batchId?: string;
    notes?: string;
  }): Promise<IpcResult<StockMovement>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('stock.adjust') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to adjust stock.');
      }

      if (!args.categoryId) throw new Error('Brick category is required.');
      if (args.direction !== 'in' && args.direction !== 'out') throw new Error('Direction must be "in" or "out".');
      if (!Number.isInteger(args.quantity) || args.quantity <= 0) {
        throw new Error('Quantity must be a positive integer.');
      }
      if (!args.reason?.trim()) throw new Error('Reason is required for stock adjustments.');

      const db = getDb();
      const cat = get<{ id: string; name: string }>(db, 'SELECT id, name FROM brick_categories WHERE id = ?', args.categoryId);
      if (!cat) throw new Error('Brick category not found.');

      if (args.batchId) {
        const b = get<{ id: string }>(db, 'SELECT id FROM batches WHERE id = ?', args.batchId);
        if (!b) throw new Error('Batch not found.');
      }

      const movementType = args.direction === 'in' ? 'adjustment_in' : 'adjustment_out';
      const delta = args.direction === 'in' ? args.quantity : -args.quantity;
      const id = uuidv4();
      const date = args.date || new Date().toISOString().slice(0, 10);

      transaction(db, () => {
        // Get current quantity (or initialize to 0 if no row exists yet)
        const row = get<{ quantity: number }>(db, 'SELECT quantity FROM stock WHERE category_id = ?', args.categoryId);
        const current = row?.quantity ?? 0;
        const newQty = current + delta;

        if (newQty < 0) {
          const settings = get<{ allow_negative_stock: number }>(db, 'SELECT allow_negative_stock FROM settings WHERE id = 1');
          if (!settings?.allow_negative_stock) {
            throw new Error(`Stock cannot become negative (current: ${current}, adjustment: ${delta}).`);
          }
        }

        // Upsert stock row
        if (row) {
          run(db, "UPDATE stock SET quantity = ?, last_updated = datetime('now') WHERE category_id = ?", newQty, args.categoryId);
        } else {
          run(db, "INSERT INTO stock (category_id, quantity, last_updated) VALUES (?, ?, datetime('now'))", args.categoryId, newQty);
        }

        // Record movement
        run(
          db,
          `INSERT INTO stock_movements (id, date, category_id, movement_type, quantity, reference_type, reference_id, batch_id, notes, entered_by, created_at)
           VALUES (?, ?, ?, ?, ?, 'adjustment', ?, ?, ?, ?, ?, datetime('now'))`,
          id, date, args.categoryId, movementType, delta, id, args.batchId ?? null,
          `${args.reason}${args.notes ? ' | ' + args.notes : ''}`, session.userId
        );

        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'stock',
          entityId: id,
          entityType: 'stock_movement',
          description: `Stock adjustment ${args.direction.toUpperCase()} ${args.quantity} (${cat.name}): ${args.reason}`,
          newValues: {
            category_id: args.categoryId,
            direction: args.direction,
            quantity: args.quantity,
            reason: args.reason,
            old_quantity: current,
            new_quantity: newQty,
          },
        });
      });

      const row = get<any>(db, `${MOVEMENT_SELECT} WHERE sm.id = ?`, id);
      return rowToMovement(row!);
    })();
  });

  // List only manual adjustments (filtered view)
  ipcMain.handle('stock:adjustments:list', async (_evt, args: {
    token: string;
    categoryId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<IpcResult<{ items: StockMovement[]; total: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('stock.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view stock adjustments.');
      }
      const db = getDb();
      const where = ["sm.movement_type IN ('adjustment_in', 'adjustment_out')"];
      const params: any[] = [];
      if (args.categoryId) { where.push('sm.category_id = ?'); params.push(args.categoryId); }
      if (args.from) { where.push('sm.date >= ?'); params.push(args.from); }
      if (args.to) { where.push('sm.date <= ?'); params.push(args.to); }
      const whereSql = `WHERE ${where.join(' AND ')}`;
      const limit = Math.min(args.limit ?? 50, 500);
      const offset = Math.max(args.offset ?? 0, 0);
      const countRow = get<{ c: number }>(db, `SELECT COUNT(*) as c FROM stock_movements sm ${whereSql}`, ...params);
      const rows = all<any>(db, `${MOVEMENT_SELECT} ${whereSql} ORDER BY sm.date DESC, sm.created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      return { items: rows.map(rowToMovement), total: countRow?.c ?? 0 };
    })();
  });
}
