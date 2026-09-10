/**
 * Dashboard IPC handler.
 *
 * Returns aggregated stats for the dashboard:
 *   - Today's production quantity + labour amount (by stage)
 *   - Today's sales + cash received
 *   - Today's expenses
 *   - Current cash balance
 *   - Active workers count
 *   - Active batches count
 *   - Customer receivables (total outstanding)
 *   - Worker payable (total remaining balance)
 *   - Current stock by category
 *   - Active kilns + status breakdown
 */

import { ipcMain } from 'electron';
import { getDb, get, all } from '../database/connection';
import { getSession } from '../utils/session';
import { wrap, type IpcResult } from '../utils/ipc';

export interface DashboardStats {
  today: {
    date: string;
    production_by_stage: Array<{ stage: string; total_qty: number; total_labour: number }>;
    total_production_qty: number;
    total_labour: number;
    sales_count: number;
    sales_total: number;
    cash_received: number;
    expenses_count: number;
    expenses_total: number;
  };
  cash_balance: number;
  active_workers: number;
  inactive_workers: number;
  left_workers: number;
  active_departments: number;
  active_batches: number;
  firing_batches: number;
  open_invoices_count: number;
  customer_receivables: number;
  worker_payable: number;
  stock_by_category: Array<{ category_id: string; category_name: string; quantity: number }>;
  kiln_status_breakdown: Array<{ status: string; count: number }>;
}

export function registerDashboardHandlers(): void {
  ipcMain.handle('dashboard:stats', async (_evt, args: { token: string }): Promise<IpcResult<DashboardStats>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('dashboard.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view the dashboard.');
      }

      const db = getDb();
      const today = new Date().toISOString().slice(0, 10);

      // Production today by stage
      const prodByStage = all<{ stage: string; total_qty: number; total_labour: number }>(
        db,
        `SELECT stage,
                COALESCE(SUM(quantity), 0) AS total_qty,
                COALESCE(SUM(labour_amount), 0) AS total_labour
         FROM production_entries WHERE date = ?
         GROUP BY stage ORDER BY stage`,
        today
      );
      const totalProdQty = prodByStage.reduce((s, p) => s + p.total_qty, 0);
      const totalLabour = prodByStage.reduce((s, p) => s + p.total_labour, 0);

      // Sales today
      const salesRow = get<{ c: number; total: number; paid: number }>(
        db,
        `SELECT COUNT(*) as c, COALESCE(SUM(total), 0) as total, COALESCE(SUM(paid), 0) as paid
         FROM sales_invoices WHERE date = ? AND is_void = 0`,
        today
      );

      // Expenses today
      const expRow = get<{ c: number; total: number }>(
        db,
        `SELECT COUNT(*) as c, COALESCE(SUM(amount), 0) as total
         FROM expenses WHERE date = ? AND is_void = 0`,
        today
      );

      // Cash balance
      const cashRow = get<{ b: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS b FROM cash_movements');

      // Workers
      const workersRow = get<{ active: number; inactive: number; left: number }>(
        db,
        `SELECT
           SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active,
           SUM(CASE WHEN status='inactive' THEN 1 ELSE 0 END) as inactive,
           SUM(CASE WHEN status='left' THEN 1 ELSE 0 END) as left
         FROM workers`
      );

      // Departments & batches
      const deptRow = get<{ c: number }>(db, 'SELECT COUNT(*) as c FROM departments WHERE is_active = 1');
      const batchRow = get<{ open: number; firing: number }>(
        db,
        `SELECT
           SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open,
           SUM(CASE WHEN status='firing' THEN 1 ELSE 0 END) as firing
         FROM batches`
      );

      // Open invoices
      const invRow = get<{ c: number }>(db, "SELECT COUNT(*) as c FROM sales_invoices WHERE is_void = 0 AND payment_status IN ('unpaid','partial')");

      // Customer receivables (sum of remaining balances)
      const recvRow = get<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(c.opening_balance
                            + (SELECT COALESCE(SUM(si.total), 0) FROM sales_invoices si WHERE si.customer_id = c.id AND si.is_void = 0)
                            - (SELECT COALESCE(SUM(cp.amount), 0) FROM customer_payments cp WHERE cp.customer_id = c.id AND cp.is_void = 0)
                          ), 0) AS total
         FROM customers c WHERE c.is_active = 1`
      );

      // Worker payable (earned - advances - payments)
      const wpayRow = get<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(
            (SELECT COALESCE(SUM(labour_amount), 0) FROM production_entries pe WHERE pe.worker_id = w.id)
            - (SELECT COALESCE(SUM(amount), 0) FROM worker_advances wa WHERE wa.worker_id = w.id AND wa.is_void = 0)
            - (SELECT COALESCE(SUM(amount), 0) FROM worker_payments wp WHERE wp.worker_id = w.id AND wp.is_void = 0)
          ), 0) AS total
         FROM workers w WHERE w.status = 'active'`
      );

      // Stock by category
      const stockRows = all<{ category_id: string; category_name: string; quantity: number }>(
        db,
        `SELECT s.category_id, bc.name AS category_name, s.quantity
         FROM stock s
         LEFT JOIN brick_categories bc ON s.category_id = bc.id
         WHERE bc.is_active = 1
         ORDER BY bc.sort_order, bc.name`
      );

      // Kiln status breakdown
      const kilnRows = all<{ status: string; count: number }>(
        db,
        `SELECT status, COUNT(*) as count FROM kilns WHERE is_active = 1 GROUP BY status`
      );

      return {
        today: {
          date: today,
          production_by_stage: prodByStage,
          total_production_qty: totalProdQty,
          total_labour: totalLabour,
          sales_count: salesRow?.c ?? 0,
          sales_total: salesRow?.total ?? 0,
          cash_received: salesRow?.paid ?? 0,
          expenses_count: expRow?.c ?? 0,
          expenses_total: expRow?.total ?? 0,
        },
        cash_balance: cashRow?.b ?? 0,
        active_workers: workersRow?.active ?? 0,
        inactive_workers: workersRow?.inactive ?? 0,
        left_workers: workersRow?.left ?? 0,
        active_departments: deptRow?.c ?? 0,
        active_batches: (batchRow?.open ?? 0) + (batchRow?.firing ?? 0),
        firing_batches: batchRow?.firing ?? 0,
        open_invoices_count: invRow?.c ?? 0,
        customer_receivables: recvRow?.total ?? 0,
        worker_payable: wpayRow?.total ?? 0,
        stock_by_category: stockRows,
        kiln_status_breakdown: kilnRows,
      };
    })();
  });
}
