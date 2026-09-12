/**
 * Payroll Run IPC handlers.
 *
 * A payroll run is a batch operation:
 *   1. Accountant selects cycle (weekly/monthly/custom) + date range
 *   2. System calculates per-worker: earned_in_period, advances, previous_balance, net_payable
 *   3. Accountant reviews, adjusts payment amounts, selects/deselects workers
 *   4. Posts the run — creates worker_payments for selected workers + cash movements
 *
 * Channels:
 *   - payroll:create-run        -> draft payroll run with auto-calculated items
 *   - payroll:get-run           -> full run with items
 *   - payroll:list-runs         -> paginated list
 *   - payroll:update-item       -> adjust payment amount / select / notes
 *   - payroll:post-run          -> post (creates worker_payments + cash out)
 *   - payroll:void-run          -> void a posted run (reverses payments)
 *   - payroll:delete-run        -> delete a draft run
 *   - payroll:set-worker-cycle  -> set worker's payroll_cycle (weekly/monthly/daily)
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';

export interface PayrollRun {
  id: string;
  run_number: string;
  cycle_type: 'weekly' | 'monthly' | 'daily' | 'custom';
  period_start: string;
  period_end: string;
  status: 'draft' | 'posted' | 'void';
  total_earned: number;
  total_advances: number;
  total_previous_balance: number;
  total_net_payable: number;
  total_paid: number;
  workers_count: number;
  payment_method: string;
  notes: string | null;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  posted_at: string | null;
  posted_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

export interface PayrollRunItem {
  id: string;
  run_id: string;
  worker_id: string;
  worker_code?: string;
  worker_name?: string;
  department_name?: string;
  payroll_cycle?: string;
  days_worked: number;
  total_qty: number;
  earned_in_period: number;
  advances_in_period: number;
  previous_balance: number;
  net_payable: number;
  payment_amount: number;
  is_selected: boolean;
  notes: string | null;
  worker_payment_id: string | null;
  payment_number?: string;
}

const RUN_SELECT = `
  SELECT pr.*,
         u.full_name AS created_by_name
  FROM payroll_runs pr
  LEFT JOIN users u ON pr.created_by = u.id
`;

const ITEM_SELECT = `
  SELECT pri.*,
         w.worker_code, w.full_name AS worker_name, w.payroll_cycle,
         d.name AS department_name,
         wp.payment_number
  FROM payroll_run_items pri
  LEFT JOIN workers w ON pri.worker_id = w.id
  LEFT JOIN departments d ON w.department_id = d.id
  LEFT JOIN worker_payments wp ON pri.worker_payment_id = wp.id
`;

function rowToRun(row: any): PayrollRun {
  return {
    id: row.id,
    run_number: row.run_number,
    cycle_type: row.cycle_type,
    period_start: row.period_start,
    period_end: row.period_end,
    status: row.status,
    total_earned: row.total_earned ?? 0,
    total_advances: row.total_advances ?? 0,
    total_previous_balance: row.total_previous_balance ?? 0,
    total_net_payable: row.total_net_payable ?? 0,
    total_paid: row.total_paid ?? 0,
    workers_count: row.workers_count ?? 0,
    payment_method: row.payment_method,
    notes: row.notes,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    posted_at: row.posted_at,
    posted_by: row.posted_by,
    voided_at: row.voided_at,
    voided_by: row.voided_by,
    void_reason: row.void_reason,
  };
}

function rowToItem(row: any): PayrollRunItem {
  return {
    id: row.id,
    run_id: row.run_id,
    worker_id: row.worker_id,
    worker_code: row.worker_code,
    worker_name: row.worker_name,
    department_name: row.department_name,
    payroll_cycle: row.payroll_cycle,
    days_worked: row.days_worked ?? 0,
    total_qty: row.total_qty ?? 0,
    earned_in_period: row.earned_in_period ?? 0,
    advances_in_period: row.advances_in_period ?? 0,
    previous_balance: row.previous_balance ?? 0,
    net_payable: row.net_payable ?? 0,
    payment_amount: row.payment_amount ?? 0,
    is_selected: !!row.is_selected,
    notes: row.notes,
    worker_payment_id: row.worker_payment_id,
    payment_number: row.payment_number,
  };
}

function generateRunNumber(db: any): string {
  const year = new Date().getFullYear();
  const row = get<{ run_number: string }>(
    db,
    "SELECT run_number FROM payroll_runs WHERE run_number LIKE ? ORDER BY run_number DESC LIMIT 1",
    `PR-${year}-%`
  );
  let next = 1;
  if (row && row.run_number) {
    const m = row.run_number.match(/PR-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `PR-${year}-${String(next).padStart(4, '0')}`;
}

function generatePaymentNumber(db: any): string {
  const year = new Date().getFullYear();
  const row = get<{ payment_number: string }>(
    db,
    "SELECT payment_number FROM worker_payments WHERE payment_number LIKE ? ORDER BY payment_number DESC LIMIT 1",
    `WPAY-${year}-%`
  );
  let next = 1;
  if (row && row.payment_number) {
    const m = row.payment_number.match(/WPAY-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `WPAY-${year}-${String(next).padStart(5, '0')}`;
}

export function registerPayrollHandlers(): void {
  // Create a draft payroll run with auto-calculated items
  ipcMain.handle('payroll:create-run', async (_evt, args: {
    token: string;
    cycleType: 'weekly' | 'monthly' | 'daily' | 'custom';
    periodStart: string;
    periodEnd: string;
    paymentMethod?: string;
    departmentId?: string;          // optional: filter workers by department
    cycleFilter?: 'weekly' | 'monthly' | 'daily' | 'all';  // filter workers by their payroll_cycle
    notes?: string;
  }): Promise<IpcResult<PayrollRun>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to create payroll runs.');
      }

      if (!args.periodStart || !args.periodEnd) throw new Error('Period start and end dates are required.');
      if (args.periodStart > args.periodEnd) throw new Error('Period start must be before or equal to period end.');

      const db = getDb();
      const id = uuidv4();
      const runNumber = generateRunNumber(db);

      // Build worker filter
      const workerWhere: string[] = ['w.status = \'active\''];
      const workerParams: any[] = [];
      if (args.departmentId) {
        workerWhere.push('w.department_id = ?');
        workerParams.push(args.departmentId);
      }
      if (args.cycleFilter && args.cycleFilter !== 'all') {
        workerWhere.push('w.payroll_cycle = ?');
        workerParams.push(args.cycleFilter);
      }
      const workerWhereSql = `WHERE ${workerWhere.join(' AND ')}`;

      // Get all active workers matching the filter
      const workers = all<{ id: string; worker_code: string; full_name: string; daily_wage: number }>(
        db,
        `SELECT id, worker_code, full_name, daily_wage FROM workers w ${workerWhereSql}`,
        ...workerParams
      );

      if (workers.length === 0) {
        throw new Error('No active workers found matching the filter. Add workers first or adjust filters.');
      }

      let totalEarned = 0;
      let totalAdvances = 0;
      let totalPreviousBalance = 0;
      let totalNetPayable = 0;
      let totalPaid = 0;
      const items: any[] = [];

      transaction(db, () => {
        // Create the run header
        run(
          db,
          `INSERT INTO payroll_runs
            (id, run_number, cycle_type, period_start, period_end, status,
             total_earned, total_advances, total_previous_balance, total_net_payable, total_paid,
             workers_count, payment_method, notes, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'draft', 0, 0, 0, 0, 0, 0, ?, ?, ?, datetime('now'), datetime('now'))`,
          id, runNumber, args.cycleType, args.periodStart, args.periodEnd,
          args.paymentMethod || 'cash', args.notes ?? null, session.userId
        );

        // For each worker, calculate their numbers
        const insertItemStmt = db.prepare(
          `INSERT INTO payroll_run_items
            (id, run_id, worker_id, days_worked, total_qty, earned_in_period, advances_in_period,
             previous_balance, net_payable, payment_amount, is_selected, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, datetime('now'))`
        );

        for (const w of workers) {
          // 1. Earned in period (sum of labour_amount for production in the period)
          const earnedRow = get<{ total: number; qty: number; days: number }>(
            db,
            `SELECT
               COALESCE(SUM(labour_amount), 0) AS total,
               COALESCE(SUM(quantity), 0) AS qty,
               COUNT(DISTINCT date) AS days
             FROM production_entries
             WHERE worker_id = ? AND date >= ? AND date <= ?`,
            w.id, args.periodStart, args.periodEnd
          );

          // 2. Advances taken in the period
          const advRow = get<{ total: number }>(
            db,
            `SELECT COALESCE(SUM(amount), 0) AS total
             FROM worker_advances
             WHERE worker_id = ? AND is_void = 0 AND date >= ? AND date <= ?`,
            w.id, args.periodStart, args.periodEnd
          );

          // 3. Previous balance (earned − advances − payments BEFORE period start)
          const prevEarned = get<{ total: number }>(
            db,
            `SELECT COALESCE(SUM(labour_amount), 0) AS total
             FROM production_entries WHERE worker_id = ? AND date < ?`,
            w.id, args.periodStart
          );
          const prevAdv = get<{ total: number }>(
            db,
            `SELECT COALESCE(SUM(amount), 0) AS total
             FROM worker_advances WHERE worker_id = ? AND is_void = 0 AND date < ?`,
            w.id, args.periodStart
          );
          const prevPay = get<{ total: number }>(
            db,
            `SELECT COALESCE(SUM(amount), 0) AS total
             FROM worker_payments WHERE worker_id = ? AND is_void = 0 AND date < ?`,
            w.id, args.periodStart
          );

          const earnedInPeriod = earnedRow?.total ?? 0;
          const advancesInPeriod = advRow?.total ?? 0;
          const previousBalance = (prevEarned?.total ?? 0) - (prevAdv?.total ?? 0) - (prevPay?.total ?? 0);
          const netPayable = earnedInPeriod + previousBalance - advancesInPeriod;
          // Default payment = net payable (if positive), otherwise 0
          const paymentAmount = Math.max(0, netPayable);

          const itemId = uuidv4();
          insertItemStmt.run(
            itemId, id, w.id,
            earnedRow?.days ?? 0,
            earnedRow?.qty ?? 0,
            earnedInPeriod,
            advancesInPeriod,
            previousBalance,
            netPayable,
            paymentAmount
          );

          totalEarned += earnedInPeriod;
          totalAdvances += advancesInPeriod;
          totalPreviousBalance += previousBalance;
          totalNetPayable += netPayable;
          totalPaid += paymentAmount;
          items.push({ id: itemId, worker_id: w.id });
        }

        // Update run totals
        run(
          db,
          `UPDATE payroll_runs SET
            total_earned = ?, total_advances = ?, total_previous_balance = ?,
            total_net_payable = ?, total_paid = ?, workers_count = ?,
            updated_at = datetime('now')
           WHERE id = ?`,
          totalEarned, totalAdvances, totalPreviousBalance,
          totalNetPayable, totalPaid, workers.length, id
        );

        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'payroll',
          entityId: id,
          entityType: 'payroll_run',
          description: `Created payroll run ${runNumber} (${args.cycleType} ${args.periodStart} to ${args.periodEnd}) with ${workers.length} workers`,
          newValues: {
            run_number: runNumber,
            cycle_type: args.cycleType,
            period_start: args.periodStart,
            period_end: args.periodEnd,
            workers_count: workers.length,
            total_net_payable: totalNetPayable,
          },
        });
      });

      const row = get<any>(db, `${RUN_SELECT} WHERE pr.id = ?`, id);
      return rowToRun(row!);
    })();
  });

  // Get a full run with all items
  ipcMain.handle('payroll:get-run', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ run: PayrollRun; items: PayrollRunItem[] }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view payroll runs.');
      }
      const db = getDb();
      const runRow = get<any>(db, `${RUN_SELECT} WHERE pr.id = ?`, args.id);
      if (!runRow) throw new Error('Payroll run not found.');
      const itemRows = all<any>(db, `${ITEM_SELECT} WHERE pri.run_id = ? ORDER BY w.worker_code ASC`, args.id);
      return { run: rowToRun(runRow), items: itemRows.map(rowToItem) };
    })();
  });

  // List runs
  ipcMain.handle('payroll:list-runs', async (_evt, args: {
    token: string;
    status?: string;
    cycleType?: string;
    limit?: number;
    offset?: number;
  }): Promise<IpcResult<{ items: PayrollRun[]; total: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view payroll runs.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.status) { where.push('pr.status = ?'); params.push(args.status); }
      if (args.cycleType) { where.push('pr.cycle_type = ?'); params.push(args.cycleType); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 50, 500);
      const offset = Math.max(args.offset ?? 0, 0);
      const countRow = get<{ c: number }>(db, `SELECT COUNT(*) as c FROM payroll_runs pr ${whereSql}`, ...params);
      const rows = all<any>(db, `${RUN_SELECT} ${whereSql} ORDER BY pr.created_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      return { items: rows.map(rowToRun), total: countRow?.c ?? 0 };
    })();
  });

  // Update a single item (adjust payment amount, select/deselect, notes)
  ipcMain.handle('payroll:update-item', async (_evt, args: {
    token: string;
    itemId: string;
    paymentAmount?: number;
    isSelected?: boolean;
    notes?: string;
  }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to edit payroll.');
      }
      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM payroll_run_items WHERE id = ?', args.itemId);
      if (!existing) throw new Error('Payroll item not found.');

      // Verify run is still draft
      const runRow = get<{ status: string }>(db, 'SELECT status FROM payroll_runs WHERE id = ?', existing.run_id);
      if (!runRow) throw new Error('Payroll run not found.');
      if (runRow.status !== 'draft') throw new Error('Cannot edit items of a posted or voided run.');

      const updates: string[] = [];
      const params: any[] = [];
      if (args.paymentAmount !== undefined) {
        const v = Number(args.paymentAmount);
        if (isNaN(v) || v < 0) throw new Error('Payment amount must be non-negative.');
        updates.push('payment_amount = ?'); params.push(v);
      }
      if (args.isSelected !== undefined) {
        updates.push('is_selected = ?'); params.push(args.isSelected ? 1 : 0);
      }
      if (args.notes !== undefined) { updates.push('notes = ?'); params.push(args.notes || null); }

      if (updates.length === 0) return { success: true } as const;
      params.push(args.itemId);
      transaction(db, () => {
        run(db, `UPDATE payroll_run_items SET ${updates.join(', ')} WHERE id = ?`, ...params);
        // Recalculate run totals
        const totals = get<{ paid: number; selected: number }>(
          db,
          'SELECT COALESCE(SUM(payment_amount), 0) AS paid, SUM(is_selected) AS selected FROM payroll_run_items WHERE run_id = ?',
          existing.run_id
        );
        run(db, "UPDATE payroll_runs SET total_paid = ?, updated_at = datetime('now') WHERE id = ?", totals?.paid ?? 0, existing.run_id);
      });

      return { success: true } as const;
    })();
  });

  // Post a draft run — creates worker_payments for selected items
  ipcMain.handle('payroll:post-run', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ posted_count: number; total_paid: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to post payroll runs.');
      }
      const db = getDb();
      const runRow = get<any>(db, 'SELECT * FROM payroll_runs WHERE id = ?', args.id);
      if (!runRow) throw new Error('Payroll run not found.');
      if (runRow.status !== 'draft') throw new Error('Only draft runs can be posted.');

      // Get selected items with payment_amount > 0
      const items = all<any>(
        db,
        'SELECT * FROM payroll_run_items WHERE run_id = ? AND is_selected = 1 AND payment_amount > 0',
        args.id
      );

      let postedCount = 0;
      let totalPaid = 0;

      transaction(db, () => {
        for (const item of items) {
          const paymentId = uuidv4();
          const paymentNumber = generatePaymentNumber(db);
          const today = new Date().toISOString().slice(0, 10);

          // Create worker_payment
          run(
            db,
            `INSERT INTO worker_payments
              (id, payment_number, date, worker_id, amount, payment_method, reference_no,
               description, paid_by, is_void, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, datetime('now'))`,
            paymentId, paymentNumber, today, item.worker_id, item.payment_amount,
            runRow.payment_method, `Payroll run ${runRow.run_number}`, session.userId
          );

          // Cash movement (if cash payment)
          if (runRow.payment_method === 'cash') {
            const worker = get<{ full_name: string; worker_code: string }>(db, 'SELECT full_name, worker_code FROM workers WHERE id = ?', item.worker_id);
            run(
              db,
              `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
               VALUES (?, datetime('now'), 'worker_payment_out', ?, 'worker_payment', ?, ?, ?, datetime('now'))`,
              uuidv4(), -item.payment_amount, paymentId,
              `Payroll: ${worker?.full_name} (${worker?.worker_code}) — ${runRow.run_number}`,
              session.userId
            );
          }

          // Link item to the payment
          run(db, 'UPDATE payroll_run_items SET worker_payment_id = ? WHERE id = ?', paymentId, item.id);

          postedCount++;
          totalPaid += item.payment_amount;
        }

        // Mark run as posted
        run(db, "UPDATE payroll_runs SET status = 'posted', posted_at = datetime('now'), posted_by = ?, total_paid = ?, updated_at = datetime('now') WHERE id = ?",
          session.userId, totalPaid, args.id);

        audit({
          userId: session.userId,
          username: session.username,
          action: 'post',
          module: 'payroll',
          entityId: args.id,
          entityType: 'payroll_run',
          description: `Posted payroll run ${runRow.run_number}: ${postedCount} payments, total Rs. ${totalPaid.toFixed(2)}`,
          newValues: { posted_count: postedCount, total_paid: totalPaid },
        });
      });

      return { posted_count: postedCount, total_paid: totalPaid };
    })();
  });

  // Void a posted run (reverses all worker_payments + cash movements)
  ipcMain.handle('payroll:void-run', async (_evt, args: { token: string; id: string; reason: string }): Promise<IpcResult<{ success: true; voided_count: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to void payroll runs.');
      }
      if (!args.reason?.trim()) throw new Error('Void reason is required.');

      const db = getDb();
      const runRow = get<any>(db, 'SELECT * FROM payroll_runs WHERE id = ?', args.id);
      if (!runRow) throw new Error('Payroll run not found.');
      if (runRow.status !== 'posted') throw new Error('Only posted runs can be voided.');

      const items = all<any>(db, 'SELECT * FROM payroll_run_items WHERE run_id = ? AND worker_payment_id IS NOT NULL', args.id);
      let voidedCount = 0;

      transaction(db, () => {
        for (const item of items) {
          // Void the worker payment
          run(db, "UPDATE worker_payments SET is_void = 1, void_reason = ?, voided_by = ?, voided_at = datetime('now') WHERE id = ?",
            `Payroll run ${runRow.run_number} voided: ${args.reason}`, session.userId, item.worker_payment_id);

          // Reverse cash movement
          if (runRow.payment_method === 'cash') {
            run(
              db,
              `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
               VALUES (?, datetime('now'), 'adjustment_in', ?, 'worker_payment', ?, ?, ?, datetime('now'))`,
              uuidv4(), item.payment_amount, item.worker_payment_id,
              `Reversal of voided payroll payment (${runRow.run_number})`,
              session.userId
            );
          }
          voidedCount++;
        }

        // Mark run as void
        run(db, "UPDATE payroll_runs SET status = 'void', voided_at = datetime('now'), voided_by = ?, void_reason = ?, updated_at = datetime('now') WHERE id = ?",
          session.userId, args.reason, args.id);

        audit({
          userId: session.userId,
          username: session.username,
          action: 'void',
          module: 'payroll',
          entityId: args.id,
          entityType: 'payroll_run',
          description: `Voided payroll run ${runRow.run_number}: ${voidedCount} payments reversed. Reason: ${args.reason}`,
        });
      });

      return { success: true as const, voided_count: voidedCount };
    })();
  });

  // Delete a draft run
  ipcMain.handle('payroll:delete-run', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to delete payroll runs.');
      }
      const db = getDb();
      const runRow = get<{ status: string; run_number: string }>(db, 'SELECT status, run_number FROM payroll_runs WHERE id = ?', args.id);
      if (!runRow) throw new Error('Payroll run not found.');
      if (runRow.status !== 'draft') throw new Error('Only draft runs can be deleted. Void posted runs instead.');

      transaction(db, () => {
        run(db, 'DELETE FROM payroll_run_items WHERE run_id = ?', args.id);
        run(db, 'DELETE FROM payroll_runs WHERE id = ?', args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'delete',
          module: 'payroll',
          entityId: args.id,
          entityType: 'payroll_run',
          description: `Deleted draft payroll run ${runRow.run_number}`,
        });
      });
      return { success: true } as const;
    })();
  });

  // Set a worker's payroll_cycle (weekly/monthly/daily)
  ipcMain.handle('payroll:set-worker-cycle', async (_evt, args: {
    token: string; workerId: string; cycle: 'weekly' | 'monthly' | 'daily'; dailyWage?: number;
  }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('workers.edit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to edit workers.');
      }
      if (!['weekly', 'monthly', 'daily'].includes(args.cycle)) throw new Error('Invalid cycle type.');

      const db = getDb();
      const w = get<{ id: string; full_name: string }>(db, 'SELECT id, full_name FROM workers WHERE id = ?', args.workerId);
      if (!w) throw new Error('Worker not found.');

      transaction(db, () => {
        if (args.dailyWage !== undefined) {
          const v = Number(args.dailyWage);
          if (isNaN(v) || v < 0) throw new Error('Daily wage must be non-negative.');
          run(db, "UPDATE workers SET payroll_cycle = ?, daily_wage = ?, updated_at = datetime('now') WHERE id = ?", args.cycle, v, args.workerId);
        } else {
          run(db, "UPDATE workers SET payroll_cycle = ?, updated_at = datetime('now') WHERE id = ?", args.cycle, args.workerId);
        }
        audit({
          userId: session.userId,
          username: session.username,
          action: 'update',
          module: 'workers',
          entityId: args.workerId,
          description: `Set ${w.full_name} payroll cycle to ${args.cycle}`,
        });
      });
      return { success: true } as const;
    })();
  });
}
