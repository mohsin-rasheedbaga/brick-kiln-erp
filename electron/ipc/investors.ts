/**
 * Investors IPC handlers.
 *
 * Channels:
 *   - investors:list           -> all investors with computed balances
 *   - investors:get            -> single investor with transactions
 *   - investors:create         -> new investor
 *   - investors:update         -> update investor
 *   - investors:set-status     -> activate/deactivate
 *   - investors:delete         -> delete if no transactions
 *   - investors:add-transaction -> investment_in, profit_paid, capital_withdraw
 *   - investors:list-transactions -> paginated transactions
 *   - investors:monthly-profit  -> calculate monthly profit for each investor
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';

export interface Investor {
  id: string;
  investor_code: string;
  name: string;
  mobile: string | null;
  address: string | null;
  cnic: string | null;
  joining_date: string;
  total_investment: number;
  profit_share_pct: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Computed fields
  current_balance?: number;
  total_profit_paid?: number;
}

export interface InvestorTransaction {
  id: string;
  transaction_number: string;
  date: string;
  investor_id: string;
  type: 'investment_in' | 'profit_paid' | 'capital_withdraw' | 'adjustment';
  amount: number;
  reference_no: string | null;
  payment_method: string;
  description: string | null;
  is_void: boolean;
  created_at: string;
}

function generateInvestorCode(db: any): string {
  const row = get<{ investor_code: string }>(db, "SELECT investor_code FROM investors WHERE investor_code LIKE 'INV-%' ORDER BY investor_code DESC LIMIT 1");
  let next = 1;
  if (row && row.investor_code) {
    const m = row.investor_code.match(/INV-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `INV-${String(next).padStart(4, '0')}`;
}

function generateTxnNumber(db: any): string {
  const year = new Date().getFullYear();
  const row = get<{ transaction_number: string }>(db, "SELECT transaction_number FROM investor_transactions WHERE transaction_number LIKE ? ORDER BY transaction_number DESC LIMIT 1", `IT-${year}-%`);
  let next = 1;
  if (row && row.transaction_number) {
    const m = row.transaction_number.match(/IT-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `IT-${year}-${String(next).padStart(5, '0')}`;
}

function computeInvestorBalance(db: any, investorId: string): { balance: number; totalInvested: number; totalProfitPaid: number } {
  const rows = all<any>(db, "SELECT type, amount, is_void FROM investor_transactions WHERE investor_id = ? AND is_void = 0", investorId);
  let balance = 0;
  let totalInvested = 0;
  let totalProfitPaid = 0;
  for (const r of rows) {
    if (r.type === 'investment_in') { balance += r.amount; totalInvested += r.amount; }
    else if (r.type === 'profit_paid') { balance -= r.amount; totalProfitPaid += r.amount; }
    else if (r.type === 'capital_withdraw') { balance -= r.amount; }
    else if (r.type === 'adjustment') { balance += r.amount; }
  }
  return { balance, totalInvested, totalProfitPaid };
}

export function registerInvestorHandlers(): void {
  ipcMain.handle('investors:list', async (_evt, args: { token: string; search?: string; includeInactive?: boolean }): Promise<IpcResult<Investor[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.search) {
        where.push('(name LIKE ? OR investor_code LIKE ? OR mobile LIKE ?)');
        const q = `%${args.search}%`;
        params.push(q, q, q);
      }
      if (!args.includeInactive) where.push("status = 'active'");
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = all<any>(db, `SELECT * FROM investors ${whereSql} ORDER BY investor_code ASC`, ...params);

      // Compute balances
      return rows.map((r) => {
        const bal = computeInvestorBalance(db, r.id);
        return {
          ...r,
          total_investment: bal.totalInvested,
          current_balance: bal.balance,
          total_profit_paid: bal.totalProfitPaid,
        };
      });
    })();
  });

  ipcMain.handle('investors:get', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ investor: Investor; transactions: InvestorTransaction[] }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const row = get<any>(db, 'SELECT * FROM investors WHERE id = ?', args.id);
      if (!row) throw new Error('Investor not found.');
      const bal = computeInvestorBalance(db, args.id);
      const txnRows = all<any>(db, 'SELECT * FROM investor_transactions WHERE investor_id = ? ORDER BY date DESC, created_at DESC LIMIT 200', args.id);
      return {
        investor: { ...row, total_investment: bal.totalInvested, current_balance: bal.balance, total_profit_paid: bal.totalProfitPaid },
        transactions: txnRows,
      };
    })();
  });

  ipcMain.handle('investors:create', async (_evt, args: {
    token: string;
    name: string; mobile?: string; address?: string; cnic?: string;
    profit_share_pct?: number; initial_investment?: number; notes?: string;
  }): Promise<IpcResult<Investor>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage investors.');
      }
      const name = args.name?.trim();
      if (!name) throw new Error('Investor name is required.');
      const pct = Number(args.profit_share_pct ?? 0);
      if (isNaN(pct) || pct < 0 || pct > 100) throw new Error('Profit share must be 0-100%.');
      const initial = Number(args.initial_investment ?? 0);

      const db = getDb();
      const id = uuidv4();
      const code = generateInvestorCode(db);

      transaction(db, () => {
        run(db, `INSERT INTO investors (id, investor_code, name, mobile, address, cnic, joining_date, total_investment, profit_share_pct, status, notes, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, date('now'), 0, ?, 'active', ?, ?, datetime('now'), datetime('now'))`,
          id, code, name, args.mobile ?? null, args.address ?? null, args.cnic ?? null, pct, args.notes ?? null, session.userId);

        // If initial investment > 0, create a transaction
        if (initial > 0) {
          const txnId = uuidv4();
          const txnNum = generateTxnNumber(db);
          run(db, `INSERT INTO investor_transactions (id, transaction_number, date, investor_id, type, amount, payment_method, description, entered_by, is_void, created_at)
            VALUES (?, ?, date('now'), ?, 'investment_in', ?, 'cash', 'Initial investment', ?, 0, datetime('now'))`,
            txnId, txnNum, id, initial, session.userId);
        }

        // Update total_investment
        const bal = computeInvestorBalance(db, id);
        run(db, 'UPDATE investors SET total_investment = ? WHERE id = ?', bal.totalInvested, id);

        audit({ userId: session.userId, username: session.username, action: 'create', module: 'investors', entityId: id, entityType: 'investor', description: `Created investor ${name} (${code}) with initial Rs. ${initial}` });
      });

      const row = get<any>(db, 'SELECT * FROM investors WHERE id = ?', id);
      const bal = computeInvestorBalance(db, id);
      return { ...row, total_investment: bal.totalInvested, current_balance: bal.balance, total_profit_paid: bal.totalProfitPaid };
    })();
  });

  ipcMain.handle('investors:update', async (_evt, args: {
    token: string; id: string; name?: string; mobile?: string; address?: string; cnic?: string;
    profit_share_pct?: number; notes?: string;
  }): Promise<IpcResult<Investor>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage investors.');
      }
      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM investors WHERE id = ?', args.id);
      if (!existing) throw new Error('Investor not found.');

      const updates: string[] = [];
      const params: any[] = [];
      if (args.name !== undefined) { updates.push('name = ?'); params.push(args.name.trim()); }
      if (args.mobile !== undefined) { updates.push('mobile = ?'); params.push(args.mobile || null); }
      if (args.address !== undefined) { updates.push('address = ?'); params.push(args.address || null); }
      if (args.cnic !== undefined) { updates.push('cnic = ?'); params.push(args.cnic || null); }
      if (args.profit_share_pct !== undefined) {
        const v = Number(args.profit_share_pct);
        if (isNaN(v) || v < 0 || v > 100) throw new Error('Profit share must be 0-100%.');
        updates.push('profit_share_pct = ?'); params.push(v);
      }
      if (args.notes !== undefined) { updates.push('notes = ?'); params.push(args.notes || null); }
      if (updates.length === 0) throw new Error('No fields to update.');
      updates.push("updated_at = datetime('now')");
      params.push(args.id);

      transaction(db, () => {
        run(db, `UPDATE investors SET ${updates.join(', ')} WHERE id = ?`, ...params);
        audit({ userId: session.userId, username: session.username, action: 'update', module: 'investors', entityId: args.id, description: `Updated investor ${existing.name}` });
      });

      const row = get<any>(db, 'SELECT * FROM investors WHERE id = ?', args.id);
      const bal = computeInvestorBalance(db, args.id);
      return { ...row, total_investment: bal.totalInvested, current_balance: bal.balance, total_profit_paid: bal.totalProfitPaid };
    })();
  });

  ipcMain.handle('investors:set-status', async (_evt, args: { token: string; id: string; status: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage investors.');
      }
      const db = getDb();
      const existing = get<{ name: string }>(db, 'SELECT name FROM investors WHERE id = ?', args.id);
      if (!existing) throw new Error('Investor not found.');
      transaction(db, () => {
        run(db, "UPDATE investors SET status = ?, updated_at = datetime('now') WHERE id = ?", args.status, args.id);
        audit({ userId: session.userId, username: session.username, action: 'status_change', module: 'investors', entityId: args.id, description: `Set ${existing.name} status to ${args.status}` });
      });
      return { success: true } as const;
    })();
  });

  ipcMain.handle('investors:add-transaction', async (_evt, args: {
    token: string; investorId: string; type: 'investment_in' | 'profit_paid' | 'capital_withdraw' | 'adjustment';
    amount: number; date?: string; paymentMethod?: string; referenceNo?: string; description?: string;
  }): Promise<IpcResult<InvestorTransaction>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('accounts.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to add investor transactions.');
      }
      if (!args.amount || args.amount <= 0) throw new Error('Amount must be positive.');
      if (!['investment_in','profit_paid','capital_withdraw','adjustment'].includes(args.type)) throw new Error('Invalid transaction type.');

      const db = getDb();
      const inv = get<{ id: string; name: string }>(db, 'SELECT id, name FROM investors WHERE id = ?', args.investorId);
      if (!inv) throw new Error('Investor not found.');

      const id = uuidv4();
      const txnNum = generateTxnNumber(db);
      const date = args.date || new Date().toISOString().slice(0, 10);

      transaction(db, () => {
        run(db, `INSERT INTO investor_transactions (id, transaction_number, date, investor_id, type, amount, payment_method, reference_no, description, entered_by, is_void, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
          id, txnNum, date, args.investorId, args.type, args.amount, args.paymentMethod || 'cash', args.referenceNo ?? null, args.description ?? null, session.userId);

        // Cash movement
        if ((args.paymentMethod || 'cash') === 'cash') {
          const direction = (args.type === 'investment_in') ? 1 : -1; // investment_in = cash in, others = cash out
          run(db, `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
            VALUES (?, ?, ?, ?, 'investor_txn', ?, ?, ?, datetime('now'))`,
            uuidv4(), date, args.type === 'investment_in' ? 'income_in' : 'expense_out', direction * args.amount, id, `${args.type} — ${inv.name}`, session.userId);
        }

        // Update total_investment on investor record
        const bal = computeInvestorBalance(db, args.investorId);
        run(db, 'UPDATE investors SET total_investment = ?, updated_at = datetime(\'now\') WHERE id = ?', bal.totalInvested, args.investorId);

        audit({ userId: session.userId, username: session.username, action: 'create', module: 'investors', entityId: id, entityType: 'investor_txn', description: `${args.type} Rs. ${args.amount} for ${inv.name}` });
      });

      const row = get<any>(db, 'SELECT * FROM investor_transactions WHERE id = ?', id);
      return row;
    })();
  });

  // Monthly profit calculation: total monthly profit × investor's profit_share_pct / 100
  ipcMain.handle('investors:monthly-profit', async (_evt, args: { token: string; month: string }): Promise<IpcResult<{
    total_monthly_profit: number;
    investors: Array<{ id: string; name: string; investor_code: string; profit_share_pct: number; profit_amount: number; current_balance: number }>;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();

      // Calculate monthly profit from profit-loss report logic
      // profit = sales + other income - (labour + fuel + transport + expenses + worker_payments + worker_advances)
      const monthStart = args.month + '-01';
      const monthEnd = args.month + '-31';

      const salesRow = get<{ total: number }>(db, "SELECT COALESCE(SUM(total), 0) AS total FROM sales_invoices WHERE is_void = 0 AND date >= ? AND date <= ?", monthStart, monthEnd);
      const expRow = get<{ total: number }>(db, "SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE is_void = 0 AND date >= ? AND date <= ?", monthStart, monthEnd);
      const labourRow = get<{ total: number }>(db, "SELECT COALESCE(SUM(labour_amount), 0) AS total FROM production_entries WHERE date >= ? AND date <= ?", monthStart, monthEnd);

      const totalRevenue = salesRow?.total ?? 0;
      const totalCosts = (expRow?.total ?? 0) + (labourRow?.total ?? 0);
      const monthlyProfit = totalRevenue - totalCosts;

      const investors = all<any>(db, "SELECT id, name, investor_code, profit_share_pct FROM investors WHERE status = 'active' AND profit_share_pct > 0");

      return {
        total_monthly_profit: monthlyProfit,
        investors: investors.map((inv) => {
          const bal = computeInvestorBalance(db, inv.id);
          return {
            id: inv.id,
            name: inv.name,
            investor_code: inv.investor_code,
            profit_share_pct: inv.profit_share_pct,
            profit_amount: (monthlyProfit * inv.profit_share_pct) / 100,
            current_balance: bal.balance,
          };
        }),
      };
    })();
  });

  ipcMain.handle('investors:delete', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to delete investors.');
      }
      const db = getDb();
      const existing = get<{ name: string; investor_code: string }>(db, 'SELECT name, investor_code FROM investors WHERE id = ?', args.id);
      if (!existing) throw new Error('Investor not found.');
      const txnCount = get<{ c: number }>(db, 'SELECT COUNT(*) as c FROM investor_transactions WHERE investor_id = ?', args.id);
      if (txnCount && txnCount.c > 0) throw new Error('Cannot delete investor with transactions. Set status to inactive instead.');

      transaction(db, () => {
        run(db, 'DELETE FROM investors WHERE id = ?', args.id);
        audit({ userId: session.userId, username: session.username, action: 'delete', module: 'investors', entityId: args.id, description: `Deleted investor ${existing.name}` });
      });
      return { success: true } as const;
    })();
  });
}
