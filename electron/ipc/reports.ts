/**
 * Reports IPC handler.
 *
 * Aggregates data from multiple tables for reporting. Each report returns
 * rows + summary totals so the renderer can render both a table and KPI cards.
 *
 * Channels:
 *   - reports:production             -> production by stage/worker/department over a date range
 *   - reports:sales                  -> sales summary + invoice list with filters
 *   - reports:expenses               -> expense summary by category with filters
 *   - reports:customers              -> customer balances summary
 *   - reports:workers                 -> worker labour summary
 *   - reports:batch-costing          -> batch cost breakdown + profit/loss
 *   - reports:profit-loss            -> overall profit/loss over date range
 *   - reports:cash-flow              -> cash in/out summary by movement type
 *   - reports:stock                  -> current stock + movement summary
 *
 * All reports support date range (from/to) and optional filters.
 * For exports (CSV/PDF), the renderer formats the returned data.
 */

import { ipcMain } from 'electron';
import { getDb, get, all } from '../database/connection';
import { getSession } from '../utils/session';
import { wrap, type IpcResult } from '../utils/ipc';

type DateArgs = { token: string; from?: string; to?: string };

export function registerReportHandlers(): void {
  // =====================================================
  // Production Report
  // =====================================================
  ipcMain.handle('reports:production', async (_evt, args: DateArgs & {
    stage?: string;
    workerId?: string;
    departmentId?: string;
    batchId?: string;
    groupBy?: 'stage' | 'worker' | 'department' | 'day';
  }): Promise<IpcResult<{
    summary: { total_qty: number; total_labour: number; entries_count: number; unique_workers: number };
    rows: Array<Record<string, any>>;
    entries: Array<{
      id: string; date: string; stage: string; quantity: number; rate_per_1000: number;
      labour_amount: number; worker_name: string; worker_code: string;
      department_name: string; work_type_name: string; batch_number: string | null;
    }>;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('reports.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view reports.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.from) { where.push('pe.date >= ?'); params.push(args.from); }
      if (args.to) { where.push('pe.date <= ?'); params.push(args.to); }
      if (args.stage) { where.push('pe.stage = ?'); params.push(args.stage); }
      if (args.workerId) { where.push('pe.worker_id = ?'); params.push(args.workerId); }
      if (args.departmentId) { where.push('pe.department_id = ?'); params.push(args.departmentId); }
      if (args.batchId) { where.push('pe.batch_id = ?'); params.push(args.batchId); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const summary = get<{ total_qty: number; total_labour: number; entries_count: number; unique_workers: number }>(
        db,
        `SELECT
           COALESCE(SUM(pe.quantity), 0) AS total_qty,
           COALESCE(SUM(pe.labour_amount), 0) AS total_labour,
           COUNT(*) AS entries_count,
           COUNT(DISTINCT pe.worker_id) AS unique_workers
         FROM production_entries pe ${whereSql}`,
        ...params
      );

      // Group by clause
      let groupByCol = 'pe.stage';
      let groupByLabel = 'stage';
      if (args.groupBy === 'worker') { groupByCol = 'w.full_name'; groupByLabel = 'worker_name'; }
      else if (args.groupBy === 'department') { groupByCol = 'd.name'; groupByLabel = 'department_name'; }
      else if (args.groupBy === 'day') { groupByCol = 'pe.date'; groupByLabel = 'date'; }

      const rows = all<any>(
        db,
        `SELECT
           ${groupByCol} AS ${groupByLabel},
           COALESCE(SUM(pe.quantity), 0) AS total_qty,
           COALESCE(SUM(pe.labour_amount), 0) AS total_labour,
           COUNT(*) AS entries_count
         FROM production_entries pe
         LEFT JOIN workers w ON pe.worker_id = w.id
         LEFT JOIN departments d ON pe.department_id = d.id
         ${whereSql}
         GROUP BY ${groupByCol}
         ORDER BY total_qty DESC`,
        ...params
      );

      const entries = all<any>(
        db,
        `SELECT pe.id, pe.date, pe.stage, pe.quantity, pe.rate_per_1000, pe.labour_amount,
                w.full_name AS worker_name, w.worker_code,
                d.name AS department_name, wt.name AS work_type_name,
                b.batch_number
         FROM production_entries pe
         LEFT JOIN workers w ON pe.worker_id = w.id
         LEFT JOIN departments d ON pe.department_id = d.id
         LEFT JOIN work_types wt ON pe.work_type_id = wt.id
         LEFT JOIN batches b ON pe.batch_id = b.id
         ${whereSql}
         ORDER BY pe.date DESC, pe.created_at DESC
         LIMIT 1000`,
        ...params
      );

      return {
        summary: summary || { total_qty: 0, total_labour: 0, entries_count: 0, unique_workers: 0 },
        rows,
        entries,
      };
    })();
  });

  // =====================================================
  // Sales Report
  // =====================================================
  ipcMain.handle('reports:sales', async (_evt, args: DateArgs & {
    customerId?: string;
    batchId?: string;
    status?: string;
    groupBy?: 'customer' | 'day' | 'status';
  }): Promise<IpcResult<{
    summary: { total_subtotal: number; total_discount: number; total: number; total_paid: number; total_remaining: number; invoice_count: number };
    rows: Array<Record<string, any>>;
    invoices: Array<any>;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('reports.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view reports.');
      }
      const db = getDb();
      const where: string[] = ['si.is_void = 0'];
      const params: any[] = [];
      if (args.from) { where.push('si.date >= ?'); params.push(args.from); }
      if (args.to) { where.push('si.date <= ?'); params.push(args.to); }
      if (args.customerId) { where.push('si.customer_id = ?'); params.push(args.customerId); }
      if (args.batchId) { where.push('si.batch_id = ?'); params.push(args.batchId); }
      if (args.status) { where.push('si.payment_status = ?'); params.push(args.status); }
      const whereSql = `WHERE ${where.join(' AND ')}`;

      const summary = get<any>(
        db,
        `SELECT
           COALESCE(SUM(si.subtotal), 0) AS total_subtotal,
           COALESCE(SUM(si.discount), 0) AS total_discount,
           COALESCE(SUM(si.total), 0) AS total,
           COALESCE(SUM(si.paid), 0) AS total_paid,
           COALESCE(SUM(si.remaining), 0) AS total_remaining,
           COUNT(*) AS invoice_count
         FROM sales_invoices si ${whereSql}`,
        ...params
      );

      let groupByCol = 'c.name';
      let groupByLabel = 'customer_name';
      if (args.groupBy === 'day') { groupByCol = 'si.date'; groupByLabel = 'date'; }
      else if (args.groupBy === 'status') { groupByCol = 'si.payment_status'; groupByLabel = 'payment_status'; }

      const rows = all<any>(
        db,
        `SELECT
           ${groupByCol} AS ${groupByLabel},
           COALESCE(SUM(si.total), 0) AS total,
           COALESCE(SUM(si.paid), 0) AS total_paid,
           COALESCE(SUM(si.remaining), 0) AS total_remaining,
           COUNT(*) AS invoice_count
         FROM sales_invoices si
         LEFT JOIN customers c ON si.customer_id = c.id
         ${whereSql}
         GROUP BY ${groupByCol}
         ORDER BY total DESC`,
        ...params
      );

      const invoices = all<any>(
        db,
        `SELECT si.id, si.invoice_number, si.date, si.subtotal, si.discount, si.total, si.paid, si.remaining,
                si.payment_status, c.name AS customer_name, c.customer_code,
                b.batch_number, u.full_name AS sales_user_name
         FROM sales_invoices si
         LEFT JOIN customers c ON si.customer_id = c.id
         LEFT JOIN batches b ON si.batch_id = b.id
         LEFT JOIN users u ON si.sales_user_id = u.id
         ${whereSql}
         ORDER BY si.date DESC, si.invoice_number DESC
         LIMIT 1000`,
        ...params
      );

      return { summary: summary || {}, rows, invoices };
    })();
  });

  // =====================================================
  // Expenses Report
  // =====================================================
  ipcMain.handle('reports:expenses', async (_evt, args: DateArgs & {
    categoryId?: string;
    departmentId?: string;
    batchId?: string;
    groupBy?: 'category' | 'department' | 'batch' | 'day';
  }): Promise<IpcResult<{
    summary: { total_amount: number; expense_count: number; by_method: Array<{ method: string; total: number }> };
    rows: Array<Record<string, any>>;
    expenses: Array<any>;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('reports.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view reports.');
      }
      const db = getDb();
      const where: string[] = ['e.is_void = 0'];
      const params: any[] = [];
      if (args.from) { where.push('e.date >= ?'); params.push(args.from); }
      if (args.to) { where.push('e.date <= ?'); params.push(args.to); }
      if (args.categoryId) { where.push('e.category_id = ?'); params.push(args.categoryId); }
      if (args.departmentId) { where.push('e.department_id = ?'); params.push(args.departmentId); }
      if (args.batchId) { where.push('e.batch_id = ?'); params.push(args.batchId); }
      const whereSql = `WHERE ${where.join(' AND ')}`;

      const summary = get<any>(
        db,
        `SELECT
           COALESCE(SUM(e.amount), 0) AS total_amount,
           COUNT(*) AS expense_count
         FROM expenses e ${whereSql}`,
        ...params
      );

      const byMethod = all<{ method: string; total: number }>(
        db,
        `SELECT e.payment_method AS method, COALESCE(SUM(e.amount), 0) AS total
         FROM expenses e ${whereSql}
         GROUP BY e.payment_method ORDER BY total DESC`,
        ...params
      );

      let groupByCol = 'ec.name';
      let groupByLabel = 'category_name';
      if (args.groupBy === 'department') { groupByCol = 'd.name'; groupByLabel = 'department_name'; }
      else if (args.groupBy === 'batch') { groupByCol = 'b.batch_number'; groupByLabel = 'batch_number'; }
      else if (args.groupBy === 'day') { groupByCol = 'e.date'; groupByLabel = 'date'; }

      const rows = all<any>(
        db,
        `SELECT
           ${groupByCol} AS ${groupByLabel},
           COALESCE(SUM(e.amount), 0) AS total_amount,
           COUNT(*) AS expense_count
         FROM expenses e
         LEFT JOIN expense_categories ec ON e.category_id = ec.id
         LEFT JOIN departments d ON e.department_id = d.id
         LEFT JOIN batches b ON e.batch_id = b.id
         ${whereSql}
         GROUP BY ${groupByCol}
         ORDER BY total_amount DESC`,
        ...params
      );

      const expenses = all<any>(
        db,
        `SELECT e.id, e.expense_number, e.date, e.amount, e.payment_method, e.paid_to, e.description,
                ec.name AS category_name, d.name AS department_name, b.batch_number,
                u.full_name AS paid_by_name
         FROM expenses e
         LEFT JOIN expense_categories ec ON e.category_id = ec.id
         LEFT JOIN departments d ON e.department_id = d.id
         LEFT JOIN batches b ON e.batch_id = b.id
         LEFT JOIN users u ON e.paid_by = u.id
         ${whereSql}
         ORDER BY e.date DESC, e.expense_number DESC
         LIMIT 1000`,
        ...params
      );

      return {
        summary: {
          total_amount: summary?.total_amount ?? 0,
          expense_count: summary?.expense_count ?? 0,
          by_method: byMethod,
        },
        rows,
        expenses,
      };
    })();
  });

  // =====================================================
  // Customers Report (balances summary)
  // =====================================================
  ipcMain.handle('reports:customers', async (_evt, args: { token: string; includeInactive?: boolean }): Promise<IpcResult<{
    summary: { total_customers: number; total_receivables: number; total_sales: number; total_paid: number; customers_with_balance: number };
    customers: Array<any>;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('reports.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view reports.');
      }
      const db = getDb();
      const where = args.includeInactive ? '' : 'WHERE c.is_active = 1';

      const rows = all<any>(
        db,
        `SELECT c.id, c.customer_code, c.name, c.mobile, c.opening_balance,
                (SELECT COALESCE(SUM(si.total), 0) FROM sales_invoices si WHERE si.customer_id = c.id AND si.is_void = 0) AS total_sales,
                (SELECT COALESCE(SUM(cp.amount), 0) FROM customer_payments cp WHERE cp.customer_id = c.id AND cp.is_void = 0) AS total_paid,
                (c.opening_balance
                  + (SELECT COALESCE(SUM(si.total), 0) FROM sales_invoices si WHERE si.customer_id = c.id AND si.is_void = 0)
                  - (SELECT COALESCE(SUM(cp.amount), 0) FROM customer_payments cp WHERE cp.customer_id = c.id AND cp.is_void = 0)
                ) AS current_balance
         FROM customers c
         ${where}
         ORDER BY c.customer_code ASC`
      );

      const totalReceivables = rows.filter((r) => r.current_balance > 0).reduce((s, r) => s + r.current_balance, 0);
      const totalSales = rows.reduce((s, r) => s + r.total_sales, 0);
      const totalPaid = rows.reduce((s, r) => s + r.total_paid, 0);
      const customersWithBalance = rows.filter((r) => r.current_balance > 0).length;

      return {
        summary: {
          total_customers: rows.length,
          total_receivables: totalReceivables,
          total_sales: totalSales,
          total_paid: totalPaid,
          customers_with_balance: customersWithBalance,
        },
        customers: rows,
      };
    })();
  });

  // =====================================================
  // Workers Report (labour summary)
  // =====================================================
  ipcMain.handle('reports:workers', async (_evt, args: DateArgs & {
    departmentId?: string;
    workerId?: string;
  }): Promise<IpcResult<{
    summary: { total_workers: number; total_labour: number; total_advances: number; total_payments: number; total_payable: number };
    workers: Array<any>;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('reports.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view reports.');
      }
      const db = getDb();

      // We need date-filtered production but lifetime advances/payments for balance calc.
      // For simplicity, the report shows date-filtered production + lifetime balances.
      const prodWhere: string[] = [];
      const prodParams: any[] = [];
      if (args.from) { prodWhere.push('pe.date >= ?'); prodParams.push(args.from); }
      if (args.to) { prodWhere.push('pe.date <= ?'); prodParams.push(args.to); }
      if (args.workerId) { prodWhere.push('pe.worker_id = ?'); prodParams.push(args.workerId); }
      if (args.departmentId) { prodWhere.push('w.department_id = ?'); prodParams.push(args.departmentId); }
      const prodWhereSql = prodWhere.length ? `WHERE ${prodWhere.join(' AND ')}` : '';

      const rows = all<any>(
        db,
        `SELECT w.id, w.worker_code, w.full_name, w.status, d.name AS department_name,
                w.rate_per_1000,
                (SELECT COALESCE(SUM(pe2.quantity), 0) FROM production_entries pe2 WHERE pe2.worker_id = w.id
                  ${args.from ? `AND pe2.date >= '${args.from}'` : ''}
                  ${args.to ? `AND pe2.date <= '${args.to}'` : ''}
                ) AS total_qty,
                (SELECT COALESCE(SUM(pe2.labour_amount), 0) FROM production_entries pe2 WHERE pe2.worker_id = w.id
                  ${args.from ? `AND pe2.date >= '${args.from}'` : ''}
                  ${args.to ? `AND pe2.date <= '${args.to}'` : ''}
                ) AS total_labour,
                (SELECT COALESCE(SUM(wa.amount), 0) FROM worker_advances wa WHERE wa.worker_id = w.id AND wa.is_void = 0) AS total_advances,
                (SELECT COALESCE(SUM(wp.amount), 0) FROM worker_payments wp WHERE wp.worker_id = w.id AND wp.is_void = 0) AS total_payments
         FROM workers w
         LEFT JOIN departments d ON w.department_id = d.id
         ${args.departmentId ? 'WHERE w.department_id = ?' : ''}
         ${args.workerId ? (args.departmentId ? 'AND' : 'WHERE') + ' w.id = ?' : ''}
         ORDER BY w.worker_code ASC`,
        ...(args.departmentId ? [args.departmentId] : []),
        ...(args.workerId ? [args.workerId] : [])
      );

      const totalLabour = rows.reduce((s, r) => s + r.total_labour, 0);
      const totalAdvances = rows.reduce((s, r) => s + r.total_advances, 0);
      const totalPayments = rows.reduce((s, r) => s + r.total_payments, 0);
      const totalPayable = rows.reduce((s, r) => s + Math.max(0, r.total_labour - r.total_advances - r.total_payments), 0);

      return {
        summary: {
          total_workers: rows.length,
          total_labour: totalLabour,
          total_advances: totalAdvances,
          total_payments: totalPayments,
          total_payable: totalPayable,
        },
        workers: rows,
      };
    })();
  });

  // =====================================================
  // Batch Costing Report
  // =====================================================
  ipcMain.handle('reports:batch-costing', async (_evt, args: { token: string; batchId?: string; status?: string }): Promise<IpcResult<{
    summary: { total_batches: number; total_cost: number; total_revenue: number; total_profit: number };
    batches: Array<any>;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('reports.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view reports.');
      }
      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.batchId) { where.push('b.id = ?'); params.push(args.batchId); }
      if (args.status) { where.push('b.status = ?'); params.push(args.status); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const rows = all<any>(
        db,
        `SELECT b.id, b.batch_number, b.start_date, b.end_date, b.status,
                b.kiln_id, k.name AS kiln_name,
                b.labour_cost, b.fuel_cost, b.transport_cost, b.other_cost, b.total_cost,
                b.raw_bricks_loaded, b.baked_bricks_unloaded, b.broken_quantity,
                b.sales_revenue,
                (b.total_cost - b.sales_revenue) AS profit_loss,
                CASE WHEN b.total_cost > 0 THEN ((b.sales_revenue - b.total_cost) / b.total_cost * 100) ELSE 0 END AS profit_pct,
                CASE WHEN b.baked_bricks_unloaded > 0 THEN (b.total_cost / b.baked_bricks_unloaded * 1000) ELSE 0 END AS cost_per_1000
         FROM batches b
         LEFT JOIN kilns k ON b.kiln_id = k.id
         ${whereSql}
         ORDER BY b.start_date DESC, b.batch_number DESC`,
        ...params
      );

      const totalCost = rows.reduce((s, r) => s + r.total_cost, 0);
      const totalRevenue = rows.reduce((s, r) => s + r.sales_revenue, 0);

      return {
        summary: {
          total_batches: rows.length,
          total_cost: totalCost,
          total_revenue: totalRevenue,
          total_profit: totalRevenue - totalCost,
        },
        batches: rows,
      };
    })();
  });

  // =====================================================
  // Profit & Loss Report (overall)
  // =====================================================
  ipcMain.handle('reports:profit-loss', async (_evt, args: DateArgs): Promise<IpcResult<{
    revenue: { total_sales: number; total_cash_received: number; other_income: number; total_revenue: number };
    costs: {
      labour_cost: number;
      fuel_cost: number;
      transport_cost: number;
      other_expense: number;
      worker_payments: number;
      worker_advances: number;
      total_costs: number;
    };
    profit_loss: number;
    margin_pct: number;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('reports.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view reports.');
      }
      const db = getDb();
      const fromSql = args.from ? `AND date >= ?` : '';
      const toSql = args.to ? `AND date <= ?` : '';
      const dateParams = [args.from, args.to].filter((x) => x !== undefined) as any[];

      const salesRow = get<{ total: number; paid: number }>(
        db,
        `SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(paid), 0) AS paid
         FROM sales_invoices WHERE is_void = 0 ${fromSql} ${toSql}`,
        ...dateParams
      );

      const otherIncomeRow = get<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(amount), 0) AS total FROM cash_movements WHERE movement_type = 'income_in' ${fromSql ? 'AND date >= ?' : ''} ${toSql ? 'AND date <= ?' : ''}`,
        ...dateParams
      );

      const labourRow = get<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(labour_amount), 0) AS total FROM production_entries WHERE 1=1 ${fromSql} ${toSql}`,
        ...dateParams
      );

      const fuelRow = get<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(fuel_cost), 0) AS total FROM batches WHERE 1=1 ${args.from ? `AND start_date >= ?` : ''} ${args.to ? `AND start_date <= ?` : ''}`,
        ...dateParams
      );

      const otherExpRow = get<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE is_void = 0 AND category_id != (SELECT id FROM expense_categories WHERE code = 'LAB' LIMIT 1) ${fromSql} ${toSql}`,
        ...dateParams
      );

      const wpayRow = get<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(amount), 0) AS total FROM worker_payments WHERE is_void = 0 ${fromSql} ${toSql}`,
        ...dateParams
      );

      const wadvRow = get<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(amount), 0) AS total FROM worker_advances WHERE is_void = 0 ${fromSql} ${toSql}`,
        ...dateParams
      );

      const totalSales = salesRow?.total ?? 0;
      const totalPaid = salesRow?.paid ?? 0;
      const otherIncome = otherIncomeRow?.total ?? 0;
      const totalRevenue = totalSales + otherIncome;

      const labourCost = labourRow?.total ?? 0;
      const fuelCost = fuelRow?.total ?? 0;
      // Transport cost is included in labour_amount for raw_brick_transport stage; we estimate it separately:
      const transportRow = get<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(labour_amount), 0) AS total FROM production_entries WHERE stage = 'raw_brick_transport' ${fromSql} ${toSql}`,
        ...dateParams
      );
      const transportCost = transportRow?.total ?? 0;
      const otherExpense = otherExpRow?.total ?? 0;
      const workerPayments = wpayRow?.total ?? 0;
      const workerAdvances = wadvRow?.total ?? 0;
      const totalCosts = labourCost + fuelCost + transportCost + otherExpense + workerPayments + workerAdvances;

      const profitLoss = totalRevenue - totalCosts;
      const marginPct = totalRevenue > 0 ? (profitLoss / totalRevenue) * 100 : 0;

      return {
        revenue: {
          total_sales: totalSales,
          total_cash_received: totalPaid,
          other_income: otherIncome,
          total_revenue: totalRevenue,
        },
        costs: {
          labour_cost: labourCost,
          fuel_cost: fuelCost,
          transport_cost: transportCost,
          other_expense: otherExpense,
          worker_payments: workerPayments,
          worker_advances: workerAdvances,
          total_costs: totalCosts,
        },
        profit_loss: profitLoss,
        margin_pct: marginPct,
      };
    })();
  });

  // =====================================================
  // Cash Flow Report
  // =====================================================
  ipcMain.handle('reports:cash-flow', async (_evt, args: DateArgs): Promise<IpcResult<{
    summary: { opening_balance: number; total_in: number; total_out: number; closing_balance: number; movements_count: number };
    by_type: Array<{ movement_type: string; total_in: number; total_out: number; count: number }>;
    movements: Array<any>;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('reports.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view reports.');
      }
      const db = getDb();

      // Opening balance = sum of all movements BEFORE the start date (or 0 if no from date)
      let openingBalance = 0;
      if (args.from) {
        const row = get<{ b: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS b FROM cash_movements WHERE date < ?', args.from);
        openingBalance = row?.b ?? 0;
      }

      const where: string[] = [];
      const params: any[] = [];
      if (args.from) { where.push('date >= ?'); params.push(args.from); }
      if (args.to) { where.push('date <= ?'); params.push(args.to); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const summary = get<{ in_sum: number; out_sum: number; count: number }>(
        db,
        `SELECT
           COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS in_sum,
           COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS out_sum,
           COUNT(*) AS count
         FROM cash_movements ${whereSql}`,
        ...params
      );

      const totalIn = summary?.in_sum ?? 0;
      const totalOut = summary?.out_sum ?? 0;
      const closingBalance = openingBalance + totalIn + totalOut; // totalOut is already negative

      const byType = all<{ movement_type: string; total_in: number; total_out: number; count: number }>(
        db,
        `SELECT
           movement_type,
           COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS total_in,
           COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0) AS total_out,
           COUNT(*) AS count
         FROM cash_movements ${whereSql}
         GROUP BY movement_type
         ORDER BY (total_in + ABS(total_out)) DESC`,
        ...params
      );

      const movements = all<any>(
        db,
        `SELECT cm.id, cm.date, cm.movement_type, cm.amount, cm.description,
                u.full_name AS entered_by_name
         FROM cash_movements cm
         LEFT JOIN users u ON cm.entered_by = u.id
         ${whereSql}
         ORDER BY cm.date DESC, cm.created_at DESC
         LIMIT 1000`,
        ...params
      );

      return {
        summary: {
          opening_balance: openingBalance,
          total_in: totalIn,
          total_out: Math.abs(totalOut),
          closing_balance: closingBalance,
          movements_count: summary?.count ?? 0,
        },
        by_type: byType,
        movements,
      };
    })();
  });

  // =====================================================
  // Stock Report
  // =====================================================
  ipcMain.handle('reports:stock', async (_evt, args: DateArgs & { categoryId?: string }): Promise<IpcResult<{
    summary: { total_quantity: number; total_value: number; categories_count: number };
    categories: Array<{ category_id: string; category_name: string; category_code: string; quantity: number; default_selling_rate: number; stock_value: number }>;
    movements_summary: Array<{ movement_type: string; total_in: number; total_out: number; count: number }>;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('reports.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view reports.');
      }
      const db = getDb();

      const categories = all<any>(
        db,
        `SELECT bc.id AS category_id, bc.name AS category_name, bc.code AS category_code,
                bc.default_selling_rate,
                COALESCE(s.quantity, 0) AS quantity,
                (COALESCE(s.quantity, 0) * bc.default_selling_rate) AS stock_value
         FROM brick_categories bc
         LEFT JOIN stock s ON s.category_id = bc.id
         WHERE bc.is_active = 1
         ${args.categoryId ? 'AND bc.id = ?' : ''}
         ORDER BY bc.sort_order, bc.name`,
        ...(args.categoryId ? [args.categoryId] : [])
      );

      const totalQty = categories.reduce((s, c) => s + c.quantity, 0);
      const totalValue = categories.reduce((s, c) => s + c.stock_value, 0);

      // Movement summary by type
      const where: string[] = [];
      const params: any[] = [];
      if (args.from) { where.push('sm.date >= ?'); params.push(args.from); }
      if (args.to) { where.push('sm.date <= ?'); params.push(args.to); }
      if (args.categoryId) { where.push('sm.category_id = ?'); params.push(args.categoryId); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const movementsSummary = all<{ movement_type: string; total_in: number; total_out: number; count: number }>(
        db,
        `SELECT
           movement_type,
           COALESCE(SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END), 0) AS total_in,
           COALESCE(SUM(CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END), 0) AS total_out,
           COUNT(*) AS count
         FROM stock_movements sm ${whereSql}
         GROUP BY movement_type
         ORDER BY (total_in + total_out) DESC`,
        ...params
      );

      return {
        summary: {
          total_quantity: totalQty,
          total_value: totalValue,
          categories_count: categories.length,
        },
        categories,
        movements_summary: movementsSummary,
      };
    })();
  });
}
