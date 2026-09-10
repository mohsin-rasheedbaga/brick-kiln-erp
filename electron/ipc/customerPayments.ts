/**
 * Customer Payments IPC handlers.
 *
 * Channels:
 *   - customer-payments:list        -> paginated list with filters
 *   - customer-payments:create      -> new payment receipt (updates customer balance + cash register)
 *   - customer-payments:void        -> void a receipt
 *
 * Stock handling: none (payments don't affect inventory).
 * Cash handling: if payment_method = 'cash', creates a cash_movement row.
 * Customer balance: reduces outstanding by the payment amount.
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';

export interface CustomerPayment {
  id: string;
  receipt_number: string;
  date: string;
  customer_id: string;
  customer_name?: string;
  customer_code?: string;
  invoice_id: string | null;
  invoice_number?: string;
  amount: number;
  payment_method: 'cash' | 'bank' | 'cheque' | 'other';
  reference_no: string | null;
  received_by: string;
  received_by_name?: string;
  notes: string | null;
  is_void: boolean;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_at: string;
}

const PAYMENT_SELECT = `
  SELECT cp.*,
         c.name AS customer_name, c.customer_code AS customer_code,
         si.invoice_number AS invoice_number,
         u.full_name AS received_by_name
  FROM customer_payments cp
  LEFT JOIN customers c ON cp.customer_id = c.id
  LEFT JOIN sales_invoices si ON cp.invoice_id = si.id
  LEFT JOIN users u ON cp.received_by = u.id
`;

function rowToPayment(row: any): CustomerPayment {
  return {
    id: row.id,
    receipt_number: row.receipt_number,
    date: row.date,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_code: row.customer_code,
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    amount: row.amount ?? 0,
    payment_method: row.payment_method,
    reference_no: row.reference_no,
    received_by: row.received_by,
    received_by_name: row.received_by_name,
    notes: row.notes,
    is_void: !!row.is_void,
    void_reason: row.void_reason,
    voided_by: row.voided_by,
    voided_at: row.voided_at,
    created_at: row.created_at,
  };
}

function generateReceiptNumber(db: any): string {
  const year = new Date().getFullYear();
  const row = get<{ receipt_number: string }>(
    db,
    "SELECT receipt_number FROM customer_payments WHERE receipt_number LIKE ? ORDER BY receipt_number DESC LIMIT 1",
    `RCP-${year}-%`
  );
  let next = 1;
  if (row && row.receipt_number) {
    const m = row.receipt_number.match(/RCP-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `RCP-${year}-${String(next).padStart(5, '0')}`;
}

export function registerCustomerPaymentHandlers(): void {
  ipcMain.handle('customer-payments:list', async (_evt, args: {
    token: string;
    customerId?: string;
    invoiceId?: string;
    from?: string;
    to?: string;
    search?: string;
    includeVoid?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<IpcResult<{ items: CustomerPayment[]; total: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('customers.ledger') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view customer payments.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.customerId) { where.push('cp.customer_id = ?'); params.push(args.customerId); }
      if (args.invoiceId) { where.push('cp.invoice_id = ?'); params.push(args.invoiceId); }
      if (args.from) { where.push('cp.date >= ?'); params.push(args.from); }
      if (args.to) { where.push('cp.date <= ?'); params.push(args.to); }
      if (args.search) {
        where.push('(cp.receipt_number LIKE ? OR c.name LIKE ? OR c.customer_code LIKE ? OR cp.reference_no LIKE ?)');
        const q = `%${args.search}%`;
        params.push(q, q, q, q);
      }
      if (!args.includeVoid) where.push('cp.is_void = 0');
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 50, 500);
      const offset = Math.max(args.offset ?? 0, 0);
      const countRow = get<{ c: number }>(db, `SELECT COUNT(*) as c FROM customer_payments cp LEFT JOIN customers c ON cp.customer_id = c.id ${whereSql}`, ...params);
      const rows = all<any>(db, `${PAYMENT_SELECT} ${whereSql} ORDER BY cp.date DESC, cp.receipt_number DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      return { items: rows.map(rowToPayment), total: countRow?.c ?? 0 };
    })();
  });

  ipcMain.handle('customer-payments:create', async (_evt, args: {
    token: string;
    date?: string;
    customerId: string;
    invoiceId?: string;
    amount: number;
    paymentMethod?: string;
    referenceNo?: string;
    notes?: string;
  }): Promise<IpcResult<CustomerPayment>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('customers.payment') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to receive customer payments.');
      }

      if (!args.customerId) throw new Error('Customer is required.');
      const amount = Number(args.amount);
      if (isNaN(amount) || amount <= 0) throw new Error('Amount must be a positive number.');

      const db = getDb();
      const customer = get<{ id: string; name: string; is_active: number }>(db, 'SELECT id, name, is_active FROM customers WHERE id = ?', args.customerId);
      if (!customer) throw new Error('Customer not found.');
      if (!customer.is_active) throw new Error('Customer is inactive.');

      let invoiceId: string | null = null;
      if (args.invoiceId) {
        const inv = get<{ id: string; customer_id: string; remaining: number; paid: number }>(db, 'SELECT id, customer_id, remaining, paid FROM sales_invoices WHERE id = ? AND is_void = 0', args.invoiceId);
        if (!inv) throw new Error('Invoice not found or voided.');
        if (inv.customer_id !== args.customerId) throw new Error('Invoice does not belong to this customer.');
        invoiceId = args.invoiceId;
      }

      const paymentMethod = (args.paymentMethod || 'cash') as 'cash' | 'bank' | 'cheque' | 'other';
      if (!['cash', 'bank', 'cheque', 'other'].includes(paymentMethod)) {
        throw new Error('Invalid payment method.');
      }

      const id = uuidv4();
      const receiptNumber = generateReceiptNumber(db);
      const date = args.date || new Date().toISOString().slice(0, 10);

      transaction(db, () => {
        // Insert payment
        run(
          db,
          `INSERT INTO customer_payments (id, receipt_number, date, customer_id, invoice_id, amount, payment_method, reference_no, received_by, notes, is_void, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
          id, receiptNumber, date, args.customerId, invoiceId, amount, paymentMethod, args.referenceNo ?? null, session.userId, args.notes ?? null
        );

        // Update linked invoice (paid/remaining/status)
        if (invoiceId) {
          const inv = get<{ paid: number; remaining: number; total: number }>(db, 'SELECT paid, remaining, total FROM sales_invoices WHERE id = ?', invoiceId);
          if (inv) {
            const newPaid = inv.paid + amount;
            const newRemaining = Math.max(0, inv.total - newPaid);
            let status = 'unpaid';
            if (newPaid >= inv.total + 0.001) status = newPaid > inv.total + 0.001 ? 'overpaid' : 'paid';
            else if (newPaid > 0) status = 'partial';
            run(db, "UPDATE sales_invoices SET paid = ?, remaining = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?", newPaid, newRemaining, status, invoiceId);
          }
        }

        // Cash movement
        if (paymentMethod === 'cash') {
          run(
            db,
            `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
             VALUES (?, datetime('now'), 'customer_payment', ?, 'customer_payment', ?, ?, ?, datetime('now'))`,
            uuidv4(), amount, id, `Payment from ${customer.name} (${receiptNumber})`, session.userId
          );
        }

        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'customer_payments',
          entityId: id,
          entityType: 'customer_payment',
          description: `Received ${amount.toFixed(2)} from ${customer.name} via ${paymentMethod} (${receiptNumber})`,
          newValues: { customer_id: args.customerId, amount, payment_method: paymentMethod, invoice_id: invoiceId },
        });
      });

      const row = get<any>(db, `${PAYMENT_SELECT} WHERE cp.id = ?`, id);
      return rowToPayment(row!);
    })();
  });

  ipcMain.handle('customer-payments:void', async (_evt, args: { token: string; id: string; reason: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('customers.payment') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to void payments.');
      }
      if (!args.reason?.trim()) throw new Error('Void reason is required.');

      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM customer_payments WHERE id = ?', args.id);
      if (!existing) throw new Error('Payment not found.');
      if (existing.is_void) throw new Error('Payment is already voided.');

      transaction(db, () => {
        run(db, "UPDATE customer_payments SET is_void = 1, void_reason = ?, voided_by = ?, voided_at = datetime('now') WHERE id = ?", args.reason, session.userId, args.id);

        // Reverse invoice paid amount
        if (existing.invoice_id) {
          const inv = get<{ paid: number; total: number }>(db, 'SELECT paid, total FROM sales_invoices WHERE id = ?', existing.invoice_id);
          if (inv) {
            const newPaid = Math.max(0, inv.paid - existing.amount);
            const newRemaining = Math.max(0, inv.total - newPaid);
            let status = 'unpaid';
            if (newPaid >= inv.total + 0.001) status = newPaid > inv.total + 0.001 ? 'overpaid' : 'paid';
            else if (newPaid > 0) status = 'partial';
            run(db, "UPDATE sales_invoices SET paid = ?, remaining = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?", newPaid, newRemaining, status, existing.invoice_id);
          }
        }

        // Reverse cash movement if payment was cash
        if (existing.payment_method === 'cash') {
          run(
            db,
            `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
             VALUES (?, datetime('now'), 'adjustment_out', ?, 'customer_payment', ?, ?, ?, datetime('now'))`,
            uuidv4(), existing.amount, args.id, `Reversal of voided payment ${existing.receipt_number}`, session.userId
          );
        }

        audit({
          userId: session.userId,
          username: session.username,
          action: 'void',
          module: 'customer_payments',
          entityId: args.id,
          entityType: 'customer_payment',
          description: `Voided payment ${existing.receipt_number} (${existing.amount.toFixed(2)}): ${args.reason}`,
        });
      });

      return { success: true } as const;
    })();
  });
}
