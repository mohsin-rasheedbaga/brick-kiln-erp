/**
 * Expenses IPC handlers.
 *
 * Channels:
 *   - expenses:list            -> paginated list with filters
 *   - expenses:create          -> new expense (cash out if cash payment)
 *   - expenses:void            -> void an expense (reverses cash movement)
 *   - expense-categories:list  -> expense categories
 *   - expense-categories:create
 *   - expense-categories:set-active
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';

export interface Expense {
  id: string;
  expense_number: string;
  date: string;
  category_id: string;
  category_name?: string;
  department_id: string | null;
  department_name?: string;
  batch_id: string | null;
  batch_number?: string;
  amount: number;
  payment_method: 'cash' | 'bank' | 'cheque' | 'credit' | 'other';
  reference_no: string | null;
  paid_to: string | null;
  paid_by: string;
  paid_by_name?: string;
  description: string | null;
  is_void: boolean;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
}

const EXPENSE_SELECT = `
  SELECT e.*,
         ec.name AS category_name,
         d.name AS department_name,
         b.batch_number AS batch_number,
         u.full_name AS paid_by_name
  FROM expenses e
  LEFT JOIN expense_categories ec ON e.category_id = ec.id
  LEFT JOIN departments d ON e.department_id = d.id
  LEFT JOIN batches b ON e.batch_id = b.id
  LEFT JOIN users u ON e.paid_by = u.id
`;

function rowToExpense(row: any): Expense {
  return {
    id: row.id,
    expense_number: row.expense_number,
    date: row.date,
    category_id: row.category_id,
    category_name: row.category_name,
    department_id: row.department_id,
    department_name: row.department_name,
    batch_id: row.batch_id,
    batch_number: row.batch_number,
    amount: row.amount ?? 0,
    payment_method: row.payment_method,
    reference_no: row.reference_no,
    paid_to: row.paid_to,
    paid_by: row.paid_by,
    paid_by_name: row.paid_by_name,
    description: row.description,
    is_void: !!row.is_void,
    void_reason: row.void_reason,
    voided_by: row.voided_by,
    voided_at: row.voided_at,
    created_at: row.created_at,
  };
}

function generateExpenseNumber(db: any): string {
  const year = new Date().getFullYear();
  const row = get<{ expense_number: string }>(
    db,
    "SELECT expense_number FROM expenses WHERE expense_number LIKE ? ORDER BY expense_number DESC LIMIT 1",
    `EXP-${year}-%`
  );
  let next = 1;
  if (row && row.expense_number) {
    const m = row.expense_number.match(/EXP-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `EXP-${year}-${String(next).padStart(5, '0')}`;
}

export function registerExpenseHandlers(): void {
  // === Expense Categories ===
  ipcMain.handle('expense-categories:list', async (_evt, args: { token: string; includeInactive?: boolean }): Promise<IpcResult<ExpenseCategory[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const sql = args.includeInactive
        ? 'SELECT * FROM expense_categories ORDER BY name'
        : 'SELECT * FROM expense_categories WHERE is_active = 1 ORDER BY name';
      return all<any>(db, sql).map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        description: r.description,
        is_active: !!r.is_active,
      }));
    })();
  });

  ipcMain.handle('expense-categories:create', async (_evt, args: { token: string; name: string; code: string; description?: string }): Promise<IpcResult<ExpenseCategory>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage expense categories.');
      }
      const name = args.name?.trim();
      const code = args.code?.trim().toUpperCase();
      if (!name) throw new Error('Category name is required.');
      if (!code) throw new Error('Category code is required.');
      const db = getDb();
      const dup = get<{ id: string }>(db, 'SELECT id FROM expense_categories WHERE name = ? OR code = ?', name, code);
      if (dup) throw new Error('A category with this name or code already exists.');
      const id = `exp-${uuidv4()}`;
      transaction(db, () => {
        run(db, `INSERT INTO expense_categories (id, name, code, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))`, id, name, code, args.description ?? null);
        audit({ userId: session.userId, username: session.username, action: 'create', module: 'expense_categories', entityId: id, entityType: 'expense_category', description: `Created expense category ${name}` });
      });
      const row = get<any>(db, 'SELECT * FROM expense_categories WHERE id = ?', id);
      return { id: row.id, name: row.name, code: row.code, description: row.description, is_active: !!row.is_active };
    })();
  });

  ipcMain.handle('expense-categories:set-active', async (_evt, args: { token: string; id: string; active: boolean }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage expense categories.');
      }
      const db = getDb();
      transaction(db, () => {
        run(db, "UPDATE expense_categories SET is_active = ?, updated_at = datetime('now') WHERE id = ?", args.active ? 1 : 0, args.id);
        audit({ userId: session.userId, username: session.username, action: args.active ? 'enable' : 'disable', module: 'expense_categories', entityId: args.id, entityType: 'expense_category', description: `${args.active ? 'Activated' : 'Deactivated'} expense category` });
      });
      return { success: true } as const;
    })();
  });

  // === Expenses ===
  ipcMain.handle('expenses:list', async (_evt, args: {
    token: string;
    categoryId?: string;
    departmentId?: string;
    batchId?: string;
    from?: string;
    to?: string;
    search?: string;
    includeVoid?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<IpcResult<{ items: Expense[]; total: number; totalAmount: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('expenses.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view expenses.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.categoryId) { where.push('e.category_id = ?'); params.push(args.categoryId); }
      if (args.departmentId) { where.push('e.department_id = ?'); params.push(args.departmentId); }
      if (args.batchId) { where.push('e.batch_id = ?'); params.push(args.batchId); }
      if (args.from) { where.push('e.date >= ?'); params.push(args.from); }
      if (args.to) { where.push('e.date <= ?'); params.push(args.to); }
      if (args.search) {
        where.push('(e.expense_number LIKE ? OR e.paid_to LIKE ? OR e.description LIKE ? OR e.reference_no LIKE ?)');
        const q = `%${args.search}%`;
        params.push(q, q, q, q);
      }
      if (!args.includeVoid) where.push('e.is_void = 0');
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 50, 500);
      const offset = Math.max(args.offset ?? 0, 0);
      const countRow = get<{ c: number; total: number }>(
        db,
        `SELECT COUNT(*) as c, COALESCE(SUM(e.amount), 0) as total FROM expenses e ${whereSql}`,
        ...params
      );
      const rows = all<any>(db, `${EXPENSE_SELECT} ${whereSql} ORDER BY e.date DESC, e.expense_number DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      return { items: rows.map(rowToExpense), total: countRow?.c ?? 0, totalAmount: countRow?.total ?? 0 };
    })();
  });

  ipcMain.handle('expenses:create', async (_evt, args: {
    token: string;
    date?: string;
    categoryId: string;
    departmentId?: string;
    batchId?: string;
    amount: number;
    paymentMethod?: string;
    referenceNo?: string;
    paidTo?: string;
    description?: string;
  }): Promise<IpcResult<Expense>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('expenses.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to create expenses.');
      }

      const amount = Number(args.amount);
      if (isNaN(amount) || amount <= 0) throw new Error('Amount must be a positive number.');
      if (!args.categoryId) throw new Error('Category is required.');

      const paymentMethod = (args.paymentMethod || 'cash') as 'cash' | 'bank' | 'cheque' | 'credit' | 'other';
      if (!['cash', 'bank', 'cheque', 'credit', 'other'].includes(paymentMethod)) {
        throw new Error('Invalid payment method.');
      }

      const db = getDb();
      const cat = get<{ id: string }>(db, 'SELECT id FROM expense_categories WHERE id = ?', args.categoryId);
      if (!cat) throw new Error('Expense category not found.');
      if (args.departmentId) {
        const d = get<{ id: string }>(db, 'SELECT id FROM departments WHERE id = ?', args.departmentId);
        if (!d) throw new Error('Department not found.');
      }
      if (args.batchId) {
        const b = get<{ id: string }>(db, 'SELECT id FROM batches WHERE id = ?', args.batchId);
        if (!b) throw new Error('Batch not found.');
      }

      const id = uuidv4();
      const expenseNumber = generateExpenseNumber(db);
      const date = args.date || new Date().toISOString().slice(0, 10);

      transaction(db, () => {
        run(
          db,
          `INSERT INTO expenses (id, expense_number, date, category_id, department_id, batch_id, amount, payment_method, reference_no, paid_to, paid_by, description, is_void, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
          id, expenseNumber, date, args.categoryId, args.departmentId ?? null, args.batchId ?? null,
          amount, paymentMethod, args.referenceNo ?? null, args.paidTo ?? null, session.userId, args.description ?? null
        );

        // Cash movement out (for cash payments)
        if (paymentMethod === 'cash') {
          run(
            db,
            `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
             VALUES (?, datetime('now'), 'expense_out', ?, 'expense', ?, ?, ?, datetime('now'))`,
            uuidv4(), -amount, id, `Expense: ${expenseNumber}`, session.userId
          );
        }

        // Update batch totals (other_cost)
        if (args.batchId) {
          run(db, "UPDATE batches SET other_cost = other_cost + ?, total_cost = labour_cost + transport_cost + fuel_cost + other_cost + ?, updated_at = datetime('now') WHERE id = ?",
            amount, amount, args.batchId);
          // Simpler: recompute total
          run(db, "UPDATE batches SET total_cost = labour_cost + fuel_cost + transport_cost + other_cost, updated_at = datetime('now') WHERE id = ?", args.batchId);
        }

        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'expenses',
          entityId: id,
          entityType: 'expense',
          description: `Recorded expense ${expenseNumber}: ${amount.toFixed(2)} via ${paymentMethod}`,
          newValues: { amount, category_id: args.categoryId, department_id: args.departmentId, batch_id: args.batchId },
        });
      });

      const row = get<any>(db, `${EXPENSE_SELECT} WHERE e.id = ?`, id);
      return rowToExpense(row!);
    })();
  });

  ipcMain.handle('expenses:void', async (_evt, args: { token: string; id: string; reason: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('expenses.void') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to void expenses.');
      }
      if (!args.reason?.trim()) throw new Error('Void reason is required.');

      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM expenses WHERE id = ?', args.id);
      if (!existing) throw new Error('Expense not found.');
      if (existing.is_void) throw new Error('Expense is already voided.');

      transaction(db, () => {
        run(db, "UPDATE expenses SET is_void = 1, void_reason = ?, voided_by = ?, voided_at = datetime('now') WHERE id = ?", args.reason, session.userId, args.id);

        // Reverse cash movement if cash payment
        if (existing.payment_method === 'cash') {
          run(
            db,
            `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
             VALUES (?, datetime('now'), 'adjustment_in', ?, 'expense', ?, ?, ?, datetime('now'))`,
            uuidv4(), existing.amount, args.id, `Reversal of voided expense ${existing.expense_number}`, session.userId
          );
        }

        // Reverse batch totals
        if (existing.batch_id) {
          run(db, "UPDATE batches SET other_cost = MAX(0, other_cost - ?), updated_at = datetime('now') WHERE id = ?", existing.amount, existing.batch_id);
          run(db, "UPDATE batches SET total_cost = labour_cost + fuel_cost + transport_cost + other_cost, updated_at = datetime('now') WHERE id = ?", existing.batch_id);
        }

        audit({
          userId: session.userId,
          username: session.username,
          action: 'void',
          module: 'expenses',
          entityId: args.id,
          entityType: 'expense',
          description: `Voided expense ${existing.expense_number} (${existing.amount.toFixed(2)}): ${args.reason}`,
        });
      });

      return { success: true } as const;
    })();
  });
}
