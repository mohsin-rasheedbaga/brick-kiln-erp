/**
 * Worker Account Withdraw IPC handlers.
 *
 * When accountant clicks on a worker's earned amount, they can withdraw (pay) it.
 * The withdrawal can be partial with advance deduction.
 *
 * Channels:
 *   - workers:withdraw-earnings -> pay worker with optional advance deduction
 *     args: { workerId, payAmount, deductFromAdvance, deductionAmount, description }
 *     Creates worker_payment for payAmount
 *     If deductFromAdvance, also creates a worker_advance with negative amount (repayment)
 *     Returns updated account summary
 *
 *   - workers:weekly-summary -> get worker's current week breakdown
 *     Returns: { earned_this_week, advances_this_week, total_earned, total_advances, total_paid, balance }
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';
import { loadUserPermissions } from '../utils/session';

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

export function registerWithdrawHandlers(): void {
  // Withdraw earnings: pay worker + optionally deduct from advance
  ipcMain.handle('workers:withdraw-earnings', async (_evt, args: {
    token: string;
    workerId: string;
    payAmount: number;           // amount to actually pay to worker
    deductFromAdvance: boolean;  // should we deduct from advance?
    deductionAmount: number;     // amount to deduct from advance balance
    description?: string;
  }): Promise<IpcResult<{
    payment_number: string;
    advance_number: string | null;
    payAmount: number;
    deductionAmount: number;
    newBalance: number;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('worker_payments.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to make payments.');
      }

      if (!args.workerId) throw new Error('Worker ID is required.');
      if (!args.payAmount || args.payAmount <= 0) throw new Error('Pay amount must be positive.');

      const db = getDb();
      const worker = get<{ id: string; full_name: string; worker_code: string }>(db, 'SELECT id, full_name, worker_code FROM workers WHERE id = ?', args.workerId);
      if (!worker) throw new Error('Worker not found.');

      // Calculate current balance
      const earnedRow = get<{ total: number }>(db, 'SELECT COALESCE(SUM(labour_amount), 0) AS total FROM production_entries WHERE worker_id = ?', args.workerId);
      const advRow = get<{ total: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS total FROM worker_advances WHERE worker_id = ? AND is_void = 0', args.workerId);
      const payRow = get<{ total: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS total FROM worker_payments WHERE worker_id = ? AND is_void = 0', args.workerId);

      const earned = earnedRow?.total ?? 0;
      const advances = advRow?.total ?? 0;
      const payments = payRow?.total ?? 0;
      const currentBalance = earned - advances - payments;

      // Validate: payAmount + deductionAmount should not exceed currentBalance
      const totalOutflow = args.payAmount + (args.deductFromAdvance ? args.deductionAmount : 0);
      if (totalOutflow > currentBalance + 0.01) {
        throw new Error(`Total outflow (${totalOutflow}) exceeds worker's balance (${currentBalance.toFixed(2)}). Worker earns ${earned.toFixed(2)}, advances ${advances.toFixed(2)}, already paid ${payments.toFixed(2)}.`);
      }

      const today = new Date().toISOString().slice(0, 10);
      const paymentId = uuidv4();
      const paymentNumber = generatePaymentNumber(db);
      let advanceNumber: string | null = null;

      transaction(db, () => {
        // 1. Create worker_payment for the payAmount
        run(db,
          `INSERT INTO worker_payments (id, payment_number, date, worker_id, amount, payment_method, reference_no, description, paid_by, is_void, created_at)
           VALUES (?, ?, ?, ?, ?, 'cash', NULL, ?, ?, 0, datetime('now'))`,
          paymentId, paymentNumber, today, args.workerId, args.payAmount,
          args.description || `Payment to ${worker.full_name}`, session.userId
        );

        // Cash movement for payment
        run(db,
          `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
           VALUES (?, ?, 'worker_payment_out', ?, 'worker_payment', ?, ?, ?, datetime('now'))`,
          uuidv4(), -args.payAmount, paymentId,
          `Payment: ${worker.full_name} (${worker.worker_code})`, session.userId
        );

        // 2. If deducting from advance, create a negative advance (repayment)
        if (args.deductFromAdvance && args.deductionAmount > 0) {
          const advId = uuidv4();
          advanceNumber = generateAdvanceNumber(db);
          run(db,
            `INSERT INTO worker_advances (id, advance_number, date, worker_id, amount, payment_method, reference_no, description, given_by, is_void, created_at)
             VALUES (?, ?, ?, ?, ?, 'cash', NULL, ?, ?, 0, datetime('now'))`,
            advId, advanceNumber, today, args.workerId, -args.deductionAmount,
            `Advance deduction from earnings — ${worker.full_name}`, session.userId
          );
          // Note: negative advance reduces the total advances, effectively "repaying" part of the advance
        }

        // 3. Calculate new balance
        const newEarnedRow = get<{ total: number }>(db, 'SELECT COALESCE(SUM(labour_amount), 0) AS total FROM production_entries WHERE worker_id = ?', args.workerId);
        const newAdvRow = get<{ total: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS total FROM worker_advances WHERE worker_id = ? AND is_void = 0', args.workerId);
        const newPayRow = get<{ total: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS total FROM worker_payments WHERE worker_id = ? AND is_void = 0', args.workerId);

        const newBalance = (newEarnedRow?.total ?? 0) - (newAdvRow?.total ?? 0) - (newPayRow?.total ?? 0);

        audit({
          userId: session.userId,
          username: session.username,
          action: 'withdraw_earnings',
          module: 'worker_payments',
          entityId: paymentId,
          description: `Withdrew earnings for ${worker.full_name}: paid Rs. ${args.payAmount}, deducted Rs. ${args.deductFromAdvance ? args.deductionAmount : 0} from advance. New balance: Rs. ${newBalance.toFixed(2)}`,
          newValues: { payAmount: args.payAmount, deductionAmount: args.deductFromAdvance ? args.deductionAmount : 0, newBalance },
        });

        return { paymentNumber, advanceNumber, newBalance };
      });

      // Recalculate after transaction
      const finalEarnedRow = get<{ total: number }>(db, 'SELECT COALESCE(SUM(labour_amount), 0) AS total FROM production_entries WHERE worker_id = ?', args.workerId);
      const finalAdvRow = get<{ total: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS total FROM worker_advances WHERE worker_id = ? AND is_void = 0', args.workerId);
      const finalPayRow = get<{ total: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS total FROM worker_payments WHERE worker_id = ? AND is_void = 0', args.workerId);
      const finalBalance = (finalEarnedRow?.total ?? 0) - (finalAdvRow?.total ?? 0) - (finalPayRow?.total ?? 0);

      return {
        payment_number: paymentNumber,
        advance_number: advanceNumber,
        payAmount: args.payAmount,
        deductionAmount: args.deductFromAdvance ? args.deductionAmount : 0,
        newBalance: finalBalance,
      };
    })();
  });

  // Weekly summary: current week's earned + advances
  ipcMain.handle('workers:weekly-summary', async (_evt, args: { token: string; workerId: string }): Promise<IpcResult<{
    earned_this_week: number;
    advances_this_week: number;
    payments_this_week: number;
    total_earned: number;
    total_advances: number;
    total_payments: number;
    balance: number;
    week_start: string;
    week_end: string;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');

      const db = getDb();
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0=Sunday
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - dayOfWeek);
      const weekStartStr = weekStart.toISOString().slice(0, 10);
      const weekEndStr = now.toISOString().slice(0, 10);

      const weekEarned = get<{ total: number }>(db, 'SELECT COALESCE(SUM(labour_amount), 0) AS total FROM production_entries WHERE worker_id = ? AND date >= ? AND date <= ?', args.workerId, weekStartStr, weekEndStr);
      const weekAdvances = get<{ total: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS total FROM worker_advances WHERE worker_id = ? AND is_void = 0 AND date >= ? AND date <= ?', args.workerId, weekStartStr, weekEndStr);
      const weekPayments = get<{ total: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS total FROM worker_payments WHERE worker_id = ? AND is_void = 0 AND date >= ? AND date <= ?', args.workerId, weekStartStr, weekEndStr);

      const totalEarned = get<{ total: number }>(db, 'SELECT COALESCE(SUM(labour_amount), 0) AS total FROM production_entries WHERE worker_id = ?', args.workerId);
      const totalAdvances = get<{ total: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS total FROM worker_advances WHERE worker_id = ? AND is_void = 0', args.workerId);
      const totalPayments = get<{ total: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS total FROM worker_payments WHERE worker_id = ? AND is_void = 0', args.workerId);

      return {
        earned_this_week: weekEarned?.total ?? 0,
        advances_this_week: weekAdvances?.total ?? 0,
        payments_this_week: weekPayments?.total ?? 0,
        total_earned: totalEarned?.total ?? 0,
        total_advances: totalAdvances?.total ?? 0,
        total_payments: totalPayments?.total ?? 0,
        balance: (totalEarned?.total ?? 0) - (totalAdvances?.total ?? 0) - (totalPayments?.total ?? 0),
        week_start: weekStartStr,
        week_end: weekEndStr,
      };
    })();
  });
}
