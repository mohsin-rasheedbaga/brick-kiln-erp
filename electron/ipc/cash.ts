/**
 * Cash Register IPC handlers.
 *
 * Channels:
 *   - cash:balance      -> current cash balance (sum of all movements)
 *   - cash:movements    -> paginated list of cash movements with filters
 *   - cash:adjustment   -> manual adjustment (in or out)
 *
 * Balance = SUM(amount) FROM cash_movements
 *   - positive amounts = cash in
 *   - negative amounts = cash out
 *
 * Opening cash can be inserted via cash:adjustment with movement_type='opening' (positive amount).
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';

export interface CashMovement {
  id: string;
  date: string;
  movement_type: string;
  amount: number;       // positive = in, negative = out
  reference_type: string | null;
  reference_id: string | null;
  description: string | null;
  entered_by: string | null;
  entered_by_name?: string;
  created_at: string;
}

const MOVEMENT_SELECT = `
  SELECT cm.*, u.full_name AS entered_by_name
  FROM cash_movements cm
  LEFT JOIN users u ON cm.entered_by = u.id
`;

function rowToMovement(row: any): CashMovement {
  return {
    id: row.id,
    date: row.date,
    movement_type: row.movement_type,
    amount: row.amount ?? 0,
    reference_type: row.reference_type,
    reference_id: row.reference_id,
    description: row.description,
    entered_by: row.entered_by,
    entered_by_name: row.entered_by_name,
    created_at: row.created_at,
  };
}

export function registerCashHandlers(): void {
  ipcMain.handle('cash:balance', async (_evt, args: { token: string; asOf?: string }): Promise<IpcResult<{
    balance: number;
    total_in: number;
    total_out: number;
    movements_count: number;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('cash.manage') && !session.permissions.includes('accounts.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view cash balance.');
      }
      const db = getDb();
      let sql = `SELECT
                   COALESCE(SUM(amount), 0) AS balance,
                   COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_in,
                   COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS total_out,
                   COUNT(*) AS movements_count
                 FROM cash_movements`;
      const params: any[] = [];
      if (args.asOf) {
        sql += ' WHERE date <= ?';
        params.push(args.asOf);
      }
      const row = get<{ balance: number; total_in: number; total_out: number; movements_count: number }>(db, sql, ...params);
      return {
        balance: row?.balance ?? 0,
        total_in: row?.total_in ?? 0,
        total_out: row?.total_out ?? 0,
        movements_count: row?.movements_count ?? 0,
      };
    })();
  });

  ipcMain.handle('cash:movements', async (_evt, args: {
    token: string;
    movementType?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<IpcResult<{ items: CashMovement[]; total: number; runningBalance: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('cash.manage') && !session.permissions.includes('accounts.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view cash movements.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.movementType) { where.push('cm.movement_type = ?'); params.push(args.movementType); }
      if (args.from) { where.push('cm.date >= ?'); params.push(args.from); }
      if (args.to) { where.push('cm.date <= ?'); params.push(args.to); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 50, 500);
      const offset = Math.max(args.offset ?? 0, 0);
      const countRow = get<{ c: number }>(db, `SELECT COUNT(*) as c FROM cash_movements cm ${whereSql}`, ...params);
      const rows = all<any>(db, `${MOVEMENT_SELECT} ${whereSql} ORDER BY cm.date DESC, cm.created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      // Running balance is just current total (not per-row cumulative for simplicity)
      const balanceRow = get<{ b: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS b FROM cash_movements');
      return {
        items: rows.map(rowToMovement),
        total: countRow?.c ?? 0,
        runningBalance: balanceRow?.b ?? 0,
      };
    })();
  });

  ipcMain.handle('cash:adjustment', async (_evt, args: {
    token: string;
    date?: string;
    movementType: 'opening' | 'income_in' | 'adjustment_in' | 'adjustment_out' | 'transfer';
    amount: number;          // positive for in, negative for out (or pass abs + movementType)
    description: string;
  }): Promise<IpcResult<CashMovement>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('cash.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to make cash adjustments.');
      }
      const validTypes = ['opening', 'income_in', 'adjustment_in', 'adjustment_out', 'transfer'];
      if (!validTypes.includes(args.movementType)) throw new Error('Invalid movement type.');
      if (!args.description?.trim()) throw new Error('Description is required.');

      // Allow user to pass positive amount; for *_out, we negate it
      let amount = Number(args.amount);
      if (isNaN(amount)) throw new Error('Amount must be a number.');
      if (args.movementType === 'adjustment_out' && amount > 0) amount = -amount;
      if (args.movementType === 'opening' && amount < 0) throw new Error('Opening balance cannot be negative.');
      if (args.movementType === 'income_in' && amount <= 0) throw new Error('Income amount must be positive.');

      const db = getDb();
      const id = uuidv4();
      const date = args.date || new Date().toISOString().slice(0, 10);

      transaction(db, () => {
        run(
          db,
          `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
           VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, datetime('now'))`,
          id, date, args.movementType, amount, args.description, session.userId
        );
        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'cash',
          entityId: id,
          entityType: 'cash_movement',
          description: `Cash ${args.movementType}: ${amount.toFixed(2)} - ${args.description}`,
          newValues: { movement_type: args.movementType, amount, description: args.description },
        });
      });

      const row = get<any>(db, `${MOVEMENT_SELECT} WHERE cm.id = ?`, id);
      return rowToMovement(row!);
    })();
  });
}
