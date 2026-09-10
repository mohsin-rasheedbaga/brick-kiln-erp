/**
 * Customers IPC handlers.
 * Channels:
 *   - customers:list            -> paginated list with filters
 *   - customers:get             -> single customer
 *   - customers:create          -> new customer (auto-generates customer_code)
 *   - customers:update          -> update customer
 *   - customers:set-active      -> enable/disable
 *   - customers:delete          -> delete if no transactions
 *   - customers:ledger          -> complete ledger (invoices, payments, balance)
 *   - customers:lookup-by-code  -> quick lookup by customer_code or mobile
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';

export interface Customer {
  id: string;
  customer_code: string;
  name: string;
  mobile: string | null;
  phone: string | null;
  address: string | null;
  cnic: string | null;
  opening_balance: number;
  credit_limit: number | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Aggregated (optional)
  total_sales?: number;
  total_paid?: number;
  current_balance?: number;
}

interface ListArgs {
  token: string;
  search?: string;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

function rowToCustomer(row: any): Customer {
  return {
    id: row.id,
    customer_code: row.customer_code,
    name: row.name,
    mobile: row.mobile,
    phone: row.phone,
    address: row.address,
    cnic: row.cnic,
    opening_balance: row.opening_balance ?? 0,
    credit_limit: row.credit_limit,
    notes: row.notes,
    is_active: !!row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    total_sales: row.total_sales,
    total_paid: row.total_paid,
    current_balance: row.current_balance,
  };
}

/**
 * Generate next customer code like CUST-0001.
 */
function generateCustomerCode(db: any): string {
  const row = get<{ customer_code: string }>(db, "SELECT customer_code FROM customers WHERE customer_code LIKE 'CUST-%' ORDER BY customer_code DESC LIMIT 1");
  let next = 1;
  if (row && row.customer_code) {
    const match = row.customer_code.match(/CUST-(\d+)/);
    if (match) next = parseInt(match[1], 10) + 1;
  }
  return `CUST-${String(next).padStart(4, '0')}`;
}

export function registerCustomerHandlers(): void {
  ipcMain.handle('customers:list', async (_evt, args: ListArgs): Promise<IpcResult<{ items: Customer[]; total: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');

      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.search) {
        where.push('(c.name LIKE ? OR c.customer_code LIKE ? OR c.mobile LIKE ? OR c.cnic LIKE ?)');
        const q = `%${args.search}%`;
        params.push(q, q, q, q);
      }
      if (!args.includeInactive) where.push('c.is_active = 1');
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 50, 500);
      const offset = Math.max(args.offset ?? 0, 0);

      const countRow = get<{ c: number }>(db, `SELECT COUNT(*) as c FROM customers c ${whereSql}`, ...params);
      // Compute aggregates via subqueries (cheap on small datasets; for larger ones we'd cache)
      const rows = all<any>(
        db,
        `SELECT c.*,
                (SELECT COALESCE(SUM(si.total), 0) FROM sales_invoices si WHERE si.customer_id = c.id AND si.is_void = 0) AS total_sales,
                (SELECT COALESCE(SUM(cp.amount), 0) FROM customer_payments cp WHERE cp.customer_id = c.id AND cp.is_void = 0) AS total_paid,
                (c.opening_balance + (SELECT COALESCE(SUM(si.total), 0) FROM sales_invoices si WHERE si.customer_id = c.id AND si.is_void = 0)
                  - (SELECT COALESCE(SUM(cp.amount), 0) FROM customer_payments cp WHERE cp.customer_id = c.id AND cp.is_void = 0)) AS current_balance
         FROM customers c
         ${whereSql}
         ORDER BY c.customer_code ASC
         LIMIT ? OFFSET ?`,
        ...params, limit, offset
      );

      return { items: rows.map(rowToCustomer), total: countRow?.c ?? 0 };
    })();
  });

  ipcMain.handle('customers:get', async (_evt, args: { token: string; id: string }): Promise<IpcResult<Customer | null>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const row = get<any>(
        db,
        `SELECT c.*,
                (SELECT COALESCE(SUM(si.total), 0) FROM sales_invoices si WHERE si.customer_id = c.id AND si.is_void = 0) AS total_sales,
                (SELECT COALESCE(SUM(cp.amount), 0) FROM customer_payments cp WHERE cp.customer_id = c.id AND cp.is_void = 0) AS total_paid,
                (c.opening_balance + (SELECT COALESCE(SUM(si.total), 0) FROM sales_invoices si WHERE si.customer_id = c.id AND si.is_void = 0)
                  - (SELECT COALESCE(SUM(cp.amount), 0) FROM customer_payments cp WHERE cp.customer_id = c.id AND cp.is_void = 0)) AS current_balance
         FROM customers c WHERE c.id = ?`,
        args.id
      );
      return row ? rowToCustomer(row) : null;
    })();
  });

  ipcMain.handle('customers:create', async (_evt, args: {
    token: string;
    name: string;
    mobile?: string;
    phone?: string;
    address?: string;
    cnic?: string;
    openingBalance?: number;
    creditLimit?: number;
    notes?: string;
  }): Promise<IpcResult<Customer>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('customers.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to create customers.');
      }

      const name = args.name?.trim();
      if (!name) throw new Error('Customer name is required.');
      if (name.length > 200) throw new Error('Customer name is too long.');

      const opening = Number(args.openingBalance ?? 0);
      if (isNaN(opening)) throw new Error('Opening balance must be a number.');

      const creditLimit = args.creditLimit !== undefined ? Number(args.creditLimit) : null;
      if (creditLimit !== null && (isNaN(creditLimit) || creditLimit < 0)) {
        throw new Error('Credit limit must be a non-negative number.');
      }

      const db = getDb();
      const id = uuidv4();
      const customerCode = generateCustomerCode(db);

      transaction(db, () => {
        run(
          db,
          `INSERT INTO customers (id, customer_code, name, mobile, phone, address, cnic, opening_balance, credit_limit, notes, is_active, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`,
          id, customerCode, name, args.mobile ?? null, args.phone ?? null, args.address ?? null, args.cnic ?? null,
          opening, creditLimit, args.notes ?? null, session.userId
        );
        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'customers',
          entityId: id,
          entityType: 'customer',
          description: `Created customer ${name} (${customerCode})`,
          newValues: { name, customer_code: customerCode, opening_balance: opening },
        });
      });

      const row = get<any>(db, 'SELECT * FROM customers WHERE id = ?', id);
      return rowToCustomer(row!);
    })();
  });

  ipcMain.handle('customers:update', async (_evt, args: {
    token: string;
    id: string;
    name?: string;
    mobile?: string;
    phone?: string;
    address?: string;
    cnic?: string;
    openingBalance?: number;
    creditLimit?: number;
    notes?: string;
  }): Promise<IpcResult<Customer>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('customers.edit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to edit customers.');
      }

      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM customers WHERE id = ?', args.id);
      if (!existing) throw new Error('Customer not found.');

      const updates: string[] = [];
      const params: any[] = [];
      if (args.name !== undefined) {
        const v = args.name.trim();
        if (!v) throw new Error('Customer name cannot be empty.');
        updates.push('name = ?'); params.push(v);
      }
      if (args.mobile !== undefined) { updates.push('mobile = ?'); params.push(args.mobile || null); }
      if (args.phone !== undefined) { updates.push('phone = ?'); params.push(args.phone || null); }
      if (args.address !== undefined) { updates.push('address = ?'); params.push(args.address || null); }
      if (args.cnic !== undefined) { updates.push('cnic = ?'); params.push(args.cnic || null); }
      if (args.openingBalance !== undefined) {
        const v = Number(args.openingBalance);
        if (isNaN(v)) throw new Error('Opening balance must be a number.');
        updates.push('opening_balance = ?'); params.push(v);
      }
      if (args.creditLimit !== undefined) {
        const v = args.creditLimit !== null ? Number(args.creditLimit) : null;
        if (v !== null && (isNaN(v) || v < 0)) throw new Error('Credit limit must be non-negative.');
        updates.push('credit_limit = ?'); params.push(v);
      }
      if (args.notes !== undefined) { updates.push('notes = ?'); params.push(args.notes || null); }

      if (updates.length === 0) throw new Error('No fields to update.');
      updates.push("updated_at = datetime('now')");
      params.push(args.id);

      transaction(db, () => {
        run(db, `UPDATE customers SET ${updates.join(', ')} WHERE id = ?`, ...params);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'update',
          module: 'customers',
          entityId: args.id,
          entityType: 'customer',
          description: `Updated customer ${existing.name}`,
        });
      });

      const row = get<any>(db, 'SELECT * FROM customers WHERE id = ?', args.id);
      return rowToCustomer(row!);
    })();
  });

  ipcMain.handle('customers:set-active', async (_evt, args: { token: string; id: string; active: boolean }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('customers.edit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to update customers.');
      }
      const db = getDb();
      const existing = get<{ name: string }>(db, 'SELECT name FROM customers WHERE id = ?', args.id);
      if (!existing) throw new Error('Customer not found.');
      transaction(db, () => {
        run(db, "UPDATE customers SET is_active = ?, updated_at = datetime('now') WHERE id = ?", args.active ? 1 : 0, args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: args.active ? 'enable' : 'disable',
          module: 'customers',
          entityId: args.id,
          entityType: 'customer',
          description: `${args.active ? 'Activated' : 'Deactivated'} customer ${existing.name}`,
        });
      });
      return { success: true } as const;
    })();
  });

  ipcMain.handle('customers:delete', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('customers.edit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to delete customers.');
      }
      const db = getDb();
      const existing = get<{ name: string; customer_code: string }>(db, 'SELECT name, customer_code FROM customers WHERE id = ?', args.id);
      if (!existing) throw new Error('Customer not found.');

      const saleCount = get<{ c: number }>(db, 'SELECT COUNT(*) as c FROM sales_invoices WHERE customer_id = ?', args.id);
      const payCount = get<{ c: number }>(db, 'SELECT COUNT(*) as c FROM customer_payments WHERE customer_id = ?', args.id);
      const total = (saleCount?.c ?? 0) + (payCount?.c ?? 0);
      if (total > 0) {
        throw new Error(`Cannot delete customer: ${total} transaction(s) exist. Disable the customer instead.`);
      }

      transaction(db, () => {
        run(db, 'DELETE FROM customers WHERE id = ?', args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'delete',
          module: 'customers',
          entityId: args.id,
          entityType: 'customer',
          description: `Deleted customer ${existing.name} (${existing.customer_code})`,
        });
      });
      return { success: true } as const;
    })();
  });

  ipcMain.handle('customers:ledger', async (_evt, args: { token: string; id: string; from?: string; to?: string }): Promise<IpcResult<{
    customer: Customer;
    invoices: Array<{ id: string; invoice_number: string; date: string; subtotal: number; discount: number; total: number; paid: number; remaining: number; payment_status: string; is_void: boolean; }>;
    payments: Array<{ id: string; receipt_number: string; date: string; amount: number; payment_method: string; reference_no: string | null; }>;
    totals: { opening_balance: number; total_sales: number; total_paid: number; current_balance: number; };
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('customers.ledger') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view customer ledgers.');
      }
      const db = getDb();
      const cust = get<any>(db, 'SELECT * FROM customers WHERE id = ?', args.id);
      if (!cust) throw new Error('Customer not found.');

      const dateFilterInv: string[] = [];
      const paramsInv: any[] = [];
      if (args.from) { dateFilterInv.push('date >= ?'); paramsInv.push(args.from); }
      if (args.to) { dateFilterInv.push('date <= ?'); paramsInv.push(args.to); }
      const dateSqlInv = dateFilterInv.length ? `AND ${dateFilterInv.join(' AND ')}` : '';

      const invoices = all<any>(
        db,
        `SELECT id, invoice_number, date, subtotal, discount, total, paid, remaining, payment_status, is_void
         FROM sales_invoices WHERE customer_id = ? ${dateSqlInv}
         ORDER BY date ASC, created_at ASC`,
        args.id, ...paramsInv
      );

      const payments = all<any>(
        db,
        `SELECT id, receipt_number, date, amount, payment_method, reference_no
         FROM customer_payments WHERE customer_id = ? AND is_void = 0 ${dateSqlInv}
         ORDER BY date ASC, created_at ASC`,
        args.id, ...paramsInv
      );

      const totalSales = invoices.filter((i) => !i.is_void).reduce((s, i) => s + i.total, 0);
      const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
      const opening = cust.opening_balance ?? 0;
      const currentBalance = opening + totalSales - totalPaid;

      return {
        customer: rowToCustomer(cust),
        invoices,
        payments,
        totals: {
          opening_balance: opening,
          total_sales: totalSales,
          total_paid: totalPaid,
          current_balance: currentBalance,
        },
      };
    })();
  });

  ipcMain.handle('customers:lookup-by-code', async (_evt, args: { token: string; code: string }): Promise<IpcResult<Customer | null>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const row = get<any>(db, 'SELECT * FROM customers WHERE customer_code = ? OR mobile = ? OR cnic = ? LIMIT 1', args.code, args.code, args.code);
      return row ? rowToCustomer(row) : null;
    })();
  });
}
