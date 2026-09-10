/**
 * Worker Advances & Payments IPC handlers.
 *
 * Channels:
 *   - worker-advances:list       -> paginated list
 *   - worker-advances:create     -> new advance (cash out)
 *   - worker-advances:void       -> void
 *   - worker-payments:list       -> paginated list
 *   - worker-payments:create     -> new payment (cash out)
 *   - worker-payments:void       -> void
 *
 * Both advances and payments reduce the worker's balance.
 * Cash payments create cash_movement rows with negative amounts.
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';

export interface WorkerAdvance {
  id: string;
  advance_number: string;
  date: string;
  worker_id: string;
  worker_name?: string;
  worker_code?: string;
  amount: number;
  payment_method: 'cash' | 'bank' | 'cheque' | 'other';
  reference_no: string | null;
  description: string | null;
  given_by: string;
  given_by_name?: string;
  is_void: boolean;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_at: string;
}

export interface WorkerPayment {
  id: string;
  payment_number: string;
  date: string;
  worker_id: string;
  worker_name?: string;
  worker_code?: string;
  amount: number;
  payment_method: 'cash' | 'bank' | 'cheque' | 'other';
  reference_no: string | null;
  description: string | null;
  paid_by: string;
  paid_by_name?: string;
  is_void: boolean;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_at: string;
}

const ADVANCE_SELECT = `
  SELECT wa.*,
         w.full_name AS worker_name, w.worker_code,
         u.full_name AS given_by_name
  FROM worker_advances wa
  LEFT JOIN workers w ON wa.worker_id = w.id
  LEFT JOIN users u ON wa.given_by = u.id
`;

const PAYMENT_SELECT = `
  SELECT wp.*,
         w.full_name AS worker_name, w.worker_code,
         u.full_name AS paid_by_name
  FROM worker_payments wp
  LEFT JOIN workers w ON wp.worker_id = w.id
  LEFT JOIN users u ON wp.paid_by = u.id
`;

function rowToAdvance(row: any): WorkerAdvance {
  return {
    id: row.id,
    advance_number: row.advance_number,
    date: row.date,
    worker_id: row.worker_id,
    worker_name: row.worker_name,
    worker_code: row.worker_code,
    amount: row.amount ?? 0,
    payment_method: row.payment_method,
    reference_no: row.reference_no,
    description: row.description,
    given_by: row.given_by,
    given_by_name: row.given_by_name,
    is_void: !!row.is_void,
    void_reason: row.void_reason,
    voided_by: row.voided_by,
    voided_at: row.voided_at,
    created_at: row.created_at,
  };
}

function rowToPayment(row: any): WorkerPayment {
  return {
    id: row.id,
    payment_number: row.payment_number,
    date: row.date,
    worker_id: row.worker_id,
    worker_name: row.worker_name,
    worker_code: row.worker_code,
    amount: row.amount ?? 0,
    payment_method: row.payment_method,
    reference_no: row.reference_no,
    description: row.description,
    paid_by: row.paid_by,
    paid_by_name: row.paid_by_name,
    is_void: !!row.is_void,
    void_reason: row.void_reason,
    voided_by: row.voided_by,
    voided_at: row.voided_at,
    created_at: row.created_at,
  };
}

function generateAdvanceNumber(db: any): string {
  const year = new Date().getFullYear();
  const row = get<{ advance_number: string }>(db, "SELECT advance_number FROM worker_advances WHERE advance_number LIKE ? ORDER BY advance_number DESC LIMIT 1", `ADV-${year}-%`);
  let next = 1;
  if (row && row.advance_number) {
    const m = row.advance_number.match(/ADV-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `ADV-${year}-${String(next).padStart(5, '0')}`;
}

function generatePaymentNumber(db: any): string {
  const year = new Date().getFullYear();
  const row = get<{ payment_number: string }>(db, "SELECT payment_number FROM worker_payments WHERE payment_number LIKE ? ORDER BY payment_number DESC LIMIT 1", `WPAY-${year}-%`);
  let next = 1;
  if (row && row.payment_number) {
    const m = row.payment_number.match(/WPAY-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `WPAY-${year}-${String(next).padStart(5, '0')}`;
}

export function registerWorkerPaymentHandlers(): void {
  // === ADVANCES ===
  ipcMain.handle('worker-advances:list', async (_evt, args: {
    token: string;
    workerId?: string;
    from?: string;
    to?: string;
    includeVoid?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<IpcResult<{ items: WorkerAdvance[]; total: number; totalAmount: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view worker advances.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.workerId) { where.push('wa.worker_id = ?'); params.push(args.workerId); }
      if (args.from) { where.push('wa.date >= ?'); params.push(args.from); }
      if (args.to) { where.push('wa.date <= ?'); params.push(args.to); }
      if (!args.includeVoid) where.push('wa.is_void = 0');
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 50, 500);
      const offset = Math.max(args.offset ?? 0, 0);
      const countRow = get<{ c: number; total: number }>(db, `SELECT COUNT(*) as c, COALESCE(SUM(wa.amount), 0) as total FROM worker_advances wa ${whereSql}`, ...params);
      const rows = all<any>(db, `${ADVANCE_SELECT} ${whereSql} ORDER BY wa.date DESC, wa.advance_number DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      return { items: rows.map(rowToAdvance), total: countRow?.c ?? 0, totalAmount: countRow?.total ?? 0 };
    })();
  });

  ipcMain.handle('worker-advances:create', async (_evt, args: {
    token: string;
    date?: string;
    workerId: string;
    amount: number;
    paymentMethod?: string;
    referenceNo?: string;
    description?: string;
  }): Promise<IpcResult<WorkerAdvance>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.advance') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to give worker advances.');
      }
      const amount = Number(args.amount);
      if (isNaN(amount) || amount <= 0) throw new Error('Amount must be a positive number.');
      if (!args.workerId) throw new Error('Worker is required.');

      const paymentMethod = (args.paymentMethod || 'cash') as 'cash' | 'bank' | 'cheque' | 'other';
      if (!['cash', 'bank', 'cheque', 'other'].includes(paymentMethod)) throw new Error('Invalid payment method.');

      const db = getDb();
      const worker = get<{ id: string; full_name: string; worker_code: string }>(db, 'SELECT id, full_name, worker_code FROM workers WHERE id = ?', args.workerId);
      if (!worker) throw new Error('Worker not found.');

      const id = uuidv4();
      const advanceNumber = generateAdvanceNumber(db);
      const date = args.date || new Date().toISOString().slice(0, 10);

      transaction(db, () => {
        run(
          db,
          `INSERT INTO worker_advances (id, advance_number, date, worker_id, amount, payment_method, reference_no, description, given_by, is_void, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
          id, advanceNumber, date, args.workerId, amount, paymentMethod, args.referenceNo ?? null, args.description ?? null, session.userId
        );
        if (paymentMethod === 'cash') {
          run(
            db,
            `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
             VALUES (?, datetime('now'), 'advance_out', ?, 'worker_advance', ?, ?, ?, datetime('now'))`,
            uuidv4(), -amount, id, `Advance to ${worker.full_name} (${worker.worker_code})`, session.userId
          );
        }
        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'worker_advances',
          entityId: id,
          entityType: 'worker_advance',
          description: `Advance ${advanceNumber}: ${amount.toFixed(2)} to ${worker.full_name}`,
          newValues: { worker_id: args.workerId, amount, payment_method: paymentMethod },
        });
      });

      const row = get<any>(db, `${ADVANCE_SELECT} WHERE wa.id = ?`, id);
      return rowToAdvance(row!);
    })();
  });

  ipcMain.handle('worker-advances:void', async (_evt, args: { token: string; id: string; reason: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.advance') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to void advances.');
      }
      if (!args.reason?.trim()) throw new Error('Void reason is required.');

      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM worker_advances WHERE id = ?', args.id);
      if (!existing) throw new Error('Advance not found.');
      if (existing.is_void) throw new Error('Advance is already voided.');

      transaction(db, () => {
        run(db, "UPDATE worker_advances SET is_void = 1, void_reason = ?, voided_by = ?, voided_at = datetime('now') WHERE id = ?", args.reason, session.userId, args.id);
        if (existing.payment_method === 'cash') {
          run(
            db,
            `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
             VALUES (?, datetime('now'), 'adjustment_in', ?, 'worker_advance', ?, ?, ?, datetime('now'))`,
            uuidv4(), existing.amount, args.id, `Reversal of voided advance ${existing.advance_number}`, session.userId
          );
        }
        audit({
          userId: session.userId,
          username: session.username,
          action: 'void',
          module: 'worker_advances',
          entityId: args.id,
          entityType: 'worker_advance',
          description: `Voided advance ${existing.advance_number} (${existing.amount.toFixed(2)}): ${args.reason}`,
        });
      });
      return { success: true } as const;
    })();
  });

  // === PAYMENTS ===
  ipcMain.handle('worker-payments:list', async (_evt, args: {
    token: string;
    workerId?: string;
    from?: string;
    to?: string;
    includeVoid?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<IpcResult<{ items: WorkerPayment[]; total: number; totalAmount: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view worker payments.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.workerId) { where.push('wp.worker_id = ?'); params.push(args.workerId); }
      if (args.from) { where.push('wp.date >= ?'); params.push(args.from); }
      if (args.to) { where.push('wp.date <= ?'); params.push(args.to); }
      if (!args.includeVoid) where.push('wp.is_void = 0');
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 50, 500);
      const offset = Math.max(args.offset ?? 0, 0);
      const countRow = get<{ c: number; total: number }>(db, `SELECT COUNT(*) as c, COALESCE(SUM(wp.amount), 0) as total FROM worker_payments wp ${whereSql}`, ...params);
      const rows = all<any>(db, `${PAYMENT_SELECT} ${whereSql} ORDER BY wp.date DESC, wp.payment_number DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      return { items: rows.map(rowToPayment), total: countRow?.c ?? 0, totalAmount: countRow?.total ?? 0 };
    })();
  });

  ipcMain.handle('worker-payments:create', async (_evt, args: {
    token: string;
    date?: string;
    workerId: string;
    amount: number;
    paymentMethod?: string;
    referenceNo?: string;
    description?: string;
  }): Promise<IpcResult<WorkerPayment>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to record worker payments.');
      }
      const amount = Number(args.amount);
      if (isNaN(amount) || amount <= 0) throw new Error('Amount must be a positive number.');
      if (!args.workerId) throw new Error('Worker is required.');

      const paymentMethod = (args.paymentMethod || 'cash') as 'cash' | 'bank' | 'cheque' | 'other';
      if (!['cash', 'bank', 'cheque', 'other'].includes(paymentMethod)) throw new Error('Invalid payment method.');

      const db = getDb();
      const worker = get<{ id: string; full_name: string; worker_code: string }>(db, 'SELECT id, full_name, worker_code FROM workers WHERE id = ?', args.workerId);
      if (!worker) throw new Error('Worker not found.');

      const id = uuidv4();
      const paymentNumber = generatePaymentNumber(db);
      const date = args.date || new Date().toISOString().slice(0, 10);

      transaction(db, () => {
        run(
          db,
          `INSERT INTO worker_payments (id, payment_number, date, worker_id, amount, payment_method, reference_no, description, paid_by, is_void, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
          id, paymentNumber, date, args.workerId, amount, paymentMethod, args.referenceNo ?? null, args.description ?? null, session.userId
        );
        if (paymentMethod === 'cash') {
          run(
            db,
            `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
             VALUES (?, datetime('now'), 'worker_payment_out', ?, 'worker_payment', ?, ?, ?, datetime('now'))`,
            uuidv4(), -amount, id, `Payment to ${worker.full_name} (${worker.worker_code})`, session.userId
          );
        }
        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'worker_payments',
          entityId: id,
          entityType: 'worker_payment',
          description: `Payment ${paymentNumber}: ${amount.toFixed(2)} to ${worker.full_name}`,
          newValues: { worker_id: args.workerId, amount, payment_method: paymentMethod },
        });
      });

      const row = get<any>(db, `${PAYMENT_SELECT} WHERE wp.id = ?`, id);
      return rowToPayment(row!);
    })();
  });

  ipcMain.handle('worker-payments:void', async (_evt, args: { token: string; id: string; reason: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to void payments.');
      }
      if (!args.reason?.trim()) throw new Error('Void reason is required.');

      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM worker_payments WHERE id = ?', args.id);
      if (!existing) throw new Error('Payment not found.');
      if (existing.is_void) throw new Error('Payment is already voided.');

      transaction(db, () => {
        run(db, "UPDATE worker_payments SET is_void = 1, void_reason = ?, voided_by = ?, voided_at = datetime('now') WHERE id = ?", args.reason, session.userId, args.id);
        if (existing.payment_method === 'cash') {
          run(
            db,
            `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
             VALUES (?, datetime('now'), 'adjustment_in', ?, 'worker_payment', ?, ?, ?, datetime('now'))`,
            uuidv4(), existing.amount, args.id, `Reversal of voided payment ${existing.payment_number}`, session.userId
          );
        }
        audit({
          userId: session.userId,
          username: session.username,
          action: 'void',
          module: 'worker_payments',
          entityId: args.id,
          entityType: 'worker_payment',
          description: `Voided payment ${existing.payment_number} (${existing.amount.toFixed(2)}): ${args.reason}`,
        });
      });
      return { success: true } as const;
    })();
  });
}
