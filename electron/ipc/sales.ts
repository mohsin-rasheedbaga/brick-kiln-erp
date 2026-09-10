/**
 * Sales Invoices IPC handlers.
 *
 * Channels:
 *   - sales:list                -> paginated list with filters
 *   - sales:get                 -> single invoice with items
 *   - sales:create              -> new invoice (multi-line items, auto stock deduction, optional cash movement)
 *   - sales:update              -> NOT supported for posted invoices (void + recreate is the safe path)
 *   - sales:void                -> void an invoice (reverses stock & cash movement, keeps audit trail)
 *
 * Stock handling:
 *   - Each line item decrements stock for the brick_category.
 *   - Stock movements recorded with reference_type='sale' and reference_id=invoice_id.
 *   - If stock would go negative and settings.allow_negative_stock = false, the invoice is rejected.
 *
 * Cash handling:
 *   - If paid > 0 and payment_method = 'cash', a cash_movement row is created (movement_type='sale' or 'customer_payment' depending on flow).
 *   - For simplicity, we treat the paid amount as a customer_payment linked to this invoice.
 *
 * Customer balance:
 *   - Invoice total adds to customer's outstanding balance.
 *   - Paid amount reduces it.
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';

export interface SalesInvoiceItem {
  id: string;
  invoice_id: string;
  category_id: string;
  category_name?: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface SalesInvoice {
  id: string;
  invoice_number: string;
  date: string;
  customer_id: string;
  customer_name?: string;
  customer_code?: string;
  batch_id: string | null;
  batch_number?: string;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  remaining: number;
  payment_method: string | null;
  payment_status: 'unpaid' | 'partial' | 'paid' | 'overpaid';
  sales_user_id: string;
  sales_user_name?: string;
  notes: string | null;
  is_void: boolean;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
  items?: SalesInvoiceItem[];
}

interface SaleItemInput {
  category_id: string;
  quantity: number;
  rate: number;
}

interface CreateSaleArgs {
  token: string;
  date?: string;
  customerId: string;
  batchId?: string;
  items: SaleItemInput[];
  discount?: number;
  paid?: number;
  paymentMethod?: string;
  notes?: string;
}

const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'overpaid'] as const;

function derivePaymentStatus(total: number, paid: number): typeof PAYMENT_STATUSES[number] {
  if (paid <= 0) return 'unpaid';
  if (paid >= total + 0.001) {
    // if paid exceeds total by even a tiny amount, mark as overpaid
    return paid > total + 0.001 ? 'overpaid' : 'paid';
  }
  return 'partial';
}

function generateInvoiceNumber(db: any): string {
  const year = new Date().getFullYear();
  const row = get<{ invoice_number: string }>(
    db,
    "SELECT invoice_number FROM sales_invoices WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1",
    `INV-${year}-%`
  );
  let next = 1;
  if (row && row.invoice_number) {
    const m = row.invoice_number.match(/INV-\d{4}-(\d+)/);
    if (m) next = parseInt(m[1], 10) + 1;
  }
  return `INV-${year}-${String(next).padStart(5, '0')}`;
}

function adjustStock(db: any, categoryId: string, delta: number, movementType: string, referenceId: string, batchId: string | null, notes: string | null, userId: string): void {
  let row = get<{ quantity: number }>(db, 'SELECT quantity FROM stock WHERE category_id = ?', categoryId);
  if (!row) {
    run(db, "INSERT INTO stock (category_id, quantity, last_updated) VALUES (?, 0, datetime('now'))", categoryId);
    row = { quantity: 0 };
  }
  const newQty = row.quantity + delta;
  if (newQty < 0) {
    // Check settings
    const settings = get<{ allow_negative_stock: number }>(db, 'SELECT allow_negative_stock FROM settings WHERE id = 1');
    if (!settings?.allow_negative_stock) {
      throw new Error(`Stock cannot become negative for this brick category (current: ${row.quantity}, attempted change: ${delta}).`);
    }
  }
  run(db, "UPDATE stock SET quantity = ?, last_updated = datetime('now') WHERE category_id = ?", newQty, categoryId);
  run(
    db,
    `INSERT INTO stock_movements (id, date, category_id, movement_type, quantity, reference_type, reference_id, batch_id, notes, entered_by, created_at)
     VALUES (?, date('now'), ?, ?, ?, 'sale', ?, ?, ?, ?, datetime('now'))`,
    uuidv4(), categoryId, movementType, delta, referenceId, batchId, notes, userId
  );
}

const INVOICE_SELECT = `
  SELECT si.*,
         c.name AS customer_name, c.customer_code AS customer_code,
         b.batch_number AS batch_number,
         u.full_name AS sales_user_name
  FROM sales_invoices si
  LEFT JOIN customers c ON si.customer_id = c.id
  LEFT JOIN batches b ON si.batch_id = b.id
  LEFT JOIN users u ON si.sales_user_id = u.id
`;

function rowToInvoice(row: any): SalesInvoice {
  return {
    id: row.id,
    invoice_number: row.invoice_number,
    date: row.date,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_code: row.customer_code,
    batch_id: row.batch_id,
    batch_number: row.batch_number,
    subtotal: row.subtotal ?? 0,
    discount: row.discount ?? 0,
    total: row.total ?? 0,
    paid: row.paid ?? 0,
    remaining: row.remaining ?? 0,
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    sales_user_id: row.sales_user_id,
    sales_user_name: row.sales_user_name,
    notes: row.notes,
    is_void: !!row.is_void,
    void_reason: row.void_reason,
    voided_by: row.voided_by,
    voided_at: row.voided_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function registerSalesHandlers(): void {
  ipcMain.handle('sales:list', async (_evt, args: {
    token: string;
    customerId?: string;
    batchId?: string;
    status?: string;
    from?: string;
    to?: string;
    search?: string;
    includeVoid?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<IpcResult<{ items: SalesInvoice[]; total: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('sales.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view sales.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.customerId) { where.push('si.customer_id = ?'); params.push(args.customerId); }
      if (args.batchId) { where.push('si.batch_id = ?'); params.push(args.batchId); }
      if (args.from) { where.push('si.date >= ?'); params.push(args.from); }
      if (args.to) { where.push('si.date <= ?'); params.push(args.to); }
      if (args.status) { where.push('si.payment_status = ?'); params.push(args.status); }
      if (args.search) {
        where.push('(si.invoice_number LIKE ? OR c.name LIKE ? OR c.customer_code LIKE ?)');
        const q = `%${args.search}%`;
        params.push(q, q, q);
      }
      // Show void invoices? Default: hide them unless explicitly requested
      if (!args.includeVoid) where.push('si.is_void = 0');
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 50, 500);
      const offset = Math.max(args.offset ?? 0, 0);
      const countRow = get<{ c: number }>(db, `SELECT COUNT(*) as c FROM sales_invoices si LEFT JOIN customers c ON si.customer_id = c.id ${whereSql}`, ...params);
      const rows = all<any>(db, `${INVOICE_SELECT} ${whereSql} ORDER BY si.date DESC, si.invoice_number DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
      return { items: rows.map(rowToInvoice), total: countRow?.c ?? 0 };
    })();
  });

  ipcMain.handle('sales:get', async (_evt, args: { token: string; id: string }): Promise<IpcResult<SalesInvoice | null>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const row = get<any>(db, `${INVOICE_SELECT} WHERE si.id = ?`, args.id);
      if (!row) return null;
      const invoice = rowToInvoice(row);
      const items = all<any>(
        db,
        `SELECT sii.*, bc.name AS category_name
         FROM sales_invoice_items sii
         LEFT JOIN brick_categories bc ON sii.category_id = bc.id
         WHERE sii.invoice_id = ?
         ORDER BY sii.id ASC`,
        args.id
      );
      invoice.items = items.map((i) => ({
        id: i.id,
        invoice_id: i.invoice_id,
        category_id: i.category_id,
        category_name: i.category_name,
        quantity: i.quantity,
        rate: i.rate,
        amount: i.amount,
      }));
      return invoice;
    })();
  });

  ipcMain.handle('sales:create', async (_evt, args: CreateSaleArgs): Promise<IpcResult<SalesInvoice>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('sales.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to create sales.');
      }

      // Validation
      if (!args.customerId) throw new Error('Customer is required.');
      if (!args.items || args.items.length === 0) throw new Error('At least one line item is required.');
      for (const item of args.items) {
        if (!item.category_id) throw new Error('Each line item must have a brick category.');
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new Error('Quantity must be a positive integer.');
        if (isNaN(item.rate) || item.rate < 0) throw new Error('Rate must be a non-negative number.');
      }
      const discount = Number(args.discount ?? 0);
      if (isNaN(discount) || discount < 0) throw new Error('Discount must be a non-negative number.');
      const paid = Number(args.paid ?? 0);
      if (isNaN(paid) || paid < 0) throw new Error('Paid amount must be a non-negative number.');

      const db = getDb();
      // Verify customer
      const customer = get<{ id: string; is_active: number; name: string }>(db, 'SELECT id, is_active, name FROM customers WHERE id = ?', args.customerId);
      if (!customer) throw new Error('Customer not found.');
      if (!customer.is_active) throw new Error('Customer is inactive. Activate the customer first.');

      // Verify batch if provided
      if (args.batchId) {
        const batch = get<{ id: string }>(db, 'SELECT id FROM batches WHERE id = ?', args.batchId);
        if (!batch) throw new Error('Batch not found.');
      }

      // Verify all categories exist
      for (const item of args.items) {
        const cat = get<{ id: string; is_active: number }>(db, 'SELECT id, is_active FROM brick_categories WHERE id = ?', item.category_id);
        if (!cat) throw new Error(`Brick category not found (id: ${item.category_id}).`);
      }

      // Compute totals
      const subtotal = args.items.reduce((s, i) => s + (i.quantity * i.rate), 0);
      const total = Math.max(0, subtotal - discount);
      const remaining = total - paid;
      const paymentStatus = derivePaymentStatus(total, paid);
      const paymentMethod = args.paymentMethod || (paid > 0 ? 'cash' : null);

      const id = uuidv4();
      const invoiceNumber = generateInvoiceNumber(db);
      const date = args.date || new Date().toISOString().slice(0, 10);

      // Overpayment check
      if (paid > total) {
        const settings = get<{ allow_overpayment: number }>(db, 'SELECT allow_overpayment FROM settings WHERE id = 1');
        if (!settings?.allow_overpayment) {
          throw new Error(`Paid amount (${paid}) exceeds invoice total (${total}). Enable "Allow Overpayment" in settings if this is intentional.`);
        }
      }

      transaction(db, () => {
        // Insert invoice
        run(
          db,
          `INSERT INTO sales_invoices
            (id, invoice_number, date, customer_id, batch_id, subtotal, discount, total, paid, remaining,
             payment_method, payment_status, sales_user_id, notes, is_void, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
          id, invoiceNumber, date, args.customerId, args.batchId ?? null, subtotal, discount, total, paid, remaining,
          paymentMethod, paymentStatus, session.userId, args.notes ?? null
        );

        // Insert line items + deduct stock
        const stmt = db.prepare(
          `INSERT INTO sales_invoice_items (id, invoice_id, category_id, quantity, rate, amount, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
        );
        for (const item of args.items) {
          const itemId = uuidv4();
          const amount = item.quantity * item.rate;
          stmt.run(itemId, id, item.category_id, item.quantity, item.rate, amount);
          // Deduct stock
          adjustStock(db, item.category_id, -item.quantity, 'sale_out', id, args.batchId ?? null, `Sale ${invoiceNumber}`, session.userId);
        }

        // If customer paid, record a customer_payment + cash movement
        if (paid > 0) {
          const receiptId = uuidv4();
          const receiptNumber = generateReceiptNumber(db);
          run(
            db,
            `INSERT INTO customer_payments
              (id, receipt_number, date, customer_id, invoice_id, amount, payment_method, reference_no,
               received_by, is_void, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, datetime('now'))`,
            receiptId, receiptNumber, date, args.customerId, id, paid, paymentMethod || 'cash', session.userId
          );
          // Cash movement (only for cash payments)
          if ((paymentMethod || 'cash') === 'cash') {
            run(
              db,
              `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
               VALUES (?, datetime('now'), 'customer_payment', ?, 'customer_payment', ?, ?, ?, datetime('now'))`,
              uuidv4(), paid, receiptId, `Customer payment for invoice ${invoiceNumber}`, session.userId
            );
          }
        }

        // Update batch sales_revenue
        if (args.batchId) {
          run(db, "UPDATE batches SET sales_revenue = sales_revenue + ?, updated_at = datetime('now') WHERE id = ?", total, args.batchId);
        }

        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'sales',
          entityId: id,
          entityType: 'sales_invoice',
          description: `Created invoice ${invoiceNumber} for ${customer.name}: total=${total.toFixed(2)}, paid=${paid.toFixed(2)}`,
          newValues: { invoice_number: invoiceNumber, customer_id: args.customerId, total, paid, items_count: args.items.length },
        });
      });

      // Return the full invoice with items
      const row = get<any>(db, `${INVOICE_SELECT} WHERE si.id = ?`, id);
      const invoice = rowToInvoice(row!);
      const items = all<any>(
        db,
        `SELECT sii.*, bc.name AS category_name
         FROM sales_invoice_items sii
         LEFT JOIN brick_categories bc ON sii.category_id = bc.id
         WHERE sii.invoice_id = ?
         ORDER BY sii.id ASC`,
        id
      );
      invoice.items = items.map((i) => ({
        id: i.id,
        invoice_id: i.invoice_id,
        category_id: i.category_id,
        category_name: i.category_name,
        quantity: i.quantity,
        rate: i.rate,
        amount: i.amount,
      }));
      return invoice;
    })();
  });

  ipcMain.handle('sales:void', async (_evt, args: { token: string; id: string; reason: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('sales.void') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to void sales.');
      }
      if (!args.reason?.trim()) throw new Error('Void reason is required.');

      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM sales_invoices WHERE id = ?', args.id);
      if (!existing) throw new Error('Invoice not found.');
      if (existing.is_void) throw new Error('Invoice is already voided.');

      transaction(db, () => {
        // Mark as void
        run(
          db,
          `UPDATE sales_invoices SET is_void = 1, void_reason = ?, voided_by = ?, voided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
          args.reason, session.userId, args.id
        );

        // Reverse stock for each line item
        const items = all<any>(db, 'SELECT category_id, quantity FROM sales_invoice_items WHERE invoice_id = ?', args.id);
        for (const item of items) {
          adjustStock(db, item.category_id, item.quantity, 'adjustment_in', args.id, existing.batch_id, `Void of invoice ${existing.invoice_number}`, session.userId);
        }

        // Reverse batch sales_revenue
        if (existing.batch_id) {
          run(db, "UPDATE batches SET sales_revenue = sales_revenue - ?, updated_at = datetime('now') WHERE id = ?", existing.total, existing.batch_id);
        }

        // Void linked customer payments
        const linkedPayments = all<{ id: string; amount: number }>(db, 'SELECT id, amount FROM customer_payments WHERE invoice_id = ? AND is_void = 0', args.id);
        for (const p of linkedPayments) {
          run(db, "UPDATE customer_payments SET is_void = 1, void_reason = ?, voided_by = ?, voided_at = datetime('now') WHERE id = ?", `Void of invoice ${existing.invoice_number}`, session.userId, p.id);
          // Reverse cash movement (if any) by adding a counter-movement
          run(
            db,
            `INSERT INTO cash_movements (id, date, movement_type, amount, reference_type, reference_id, description, entered_by, created_at)
             VALUES (?, datetime('now'), 'adjustment_out', ?, 'customer_payment', ?, ?, ?, datetime('now'))`,
            uuidv4(), p.amount, p.id, `Reversal of payment for voided invoice ${existing.invoice_number}`, session.userId
          );
        }

        audit({
          userId: session.userId,
          username: session.username,
          action: 'void',
          module: 'sales',
          entityId: args.id,
          entityType: 'sales_invoice',
          description: `Voided invoice ${existing.invoice_number}: ${args.reason}`,
          oldValues: { total: existing.total, paid: existing.paid },
        });
      });

      return { success: true } as const;
    })();
  });
}

/**
 * Generate next receipt number like RCP-2026-0001.
 * (kept here to avoid circular imports with customerPayments.ts)
 */
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
