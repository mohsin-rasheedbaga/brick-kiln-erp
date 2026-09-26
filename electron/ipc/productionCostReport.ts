/**
 * Comprehensive Production Cost Report IPC handler.
 *
 * Generates a full brick production lifecycle report for a date range:
 *   1. Raw bricks made (quantity + labour cost)
 *   2. Raw bricks transported to kiln (quantity + transport cost)
 *   3. Bricks loaded into kiln (quantity + loading cost)
 *   4. Firing cost (coal, wood, diesel expenses)
 *   5. Baked bricks unloaded (quantity + unloading cost)
 *   6. Wastage/broken (calculated: loaded - unloaded)
 *   7. Cost per 1000 bricks (total cost / baked qty)
 *   8. Sales (quantity sold + revenue + rate per brick)
 *   9. Profit/Loss (revenue - total cost)
 *  10. Per-brick profit
 *
 * Channel: reports:production-cost
 */

import { ipcMain } from 'electron';
import { getDb, get, all } from '../database/connection';
import { getSession } from '../utils/session';
import { wrap, type IpcResult } from '../utils/ipc';

export function registerProductionCostReportHandlers(): void {
  ipcMain.handle('reports:production-cost', async (_evt, args: {
    token: string;
    from: string;
    to: string;
  }): Promise<IpcResult<{
    period: { from: string; to: string };
    stages: Array<{
      stage: string;
      label: string;
      quantity: number;
      labour_cost: number;
      entries_count: number;
      workers_count: number;
    }>;
    total_raw_made: number;
    total_transport_cost: number;
    total_loaded: number;
    total_unloaded: number;
    wastage_qty: number;
    wastage_pct: number;
    firing_cost: number;
    labour_cost: number;
    transport_cost: number;
    total_cost: number;
    cost_per_1000: number;
    cost_per_brick: number;
    sales_qty: number;
    sales_revenue: number;
    avg_selling_rate: number;
    profit_loss: number;
    profit_per_brick: number;
    profit_pct: number;
    expense_breakdown: Array<{ category: string; amount: number }>;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('reports.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view reports.');
      }

      const db = getDb();
      const { from, to } = args;

      // 1. Production by stage
      const stageRows = all<any>(
        db,
        `SELECT
           pe.stage,
           COALESCE(SUM(pe.quantity), 0) AS quantity,
           COALESCE(SUM(pe.labour_amount), 0) AS labour_cost,
           COUNT(*) AS entries_count,
           COUNT(DISTINCT pe.worker_id) AS workers_count
         FROM production_entries pe
         WHERE pe.date >= ? AND pe.date <= ?
         GROUP BY pe.stage`,
        from, to
      );

      const STAGE_LABELS: Record<string, string> = {
        raw_brick_making: 'Raw Bricks Made',
        raw_brick_transport: 'Transported to Kiln',
        kiln_loading: 'Loaded into Kiln',
        baked_brick_unloading: 'Baked Bricks Unloaded',
      };

      const stages = stageRows.map((r) => ({
        stage: r.stage,
        label: STAGE_LABELS[r.stage] || r.stage,
        quantity: r.quantity,
        labour_cost: r.labour_cost,
        entries_count: r.entries_count,
        workers_count: r.workers_count,
      }));

      const rawMade = stages.find((s) => s.stage === 'raw_brick_making')?.quantity || 0;
      const transportCost = stages.find((s) => s.stage === 'raw_brick_transport')?.labour_cost || 0;
      const loaded = stages.find((s) => s.stage === 'kiln_loading')?.quantity || 0;
      const unloaded = stages.find((s) => s.stage === 'baked_brick_unloading')?.quantity || 0;
      const wastage = loaded - unloaded;
      const wastagePct = loaded > 0 ? (wastage / loaded) * 100 : 0;

      // 2. Firing cost (coal, wood, diesel expenses)
      const firingRow = get<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(e.amount), 0) AS total
         FROM expenses e
         LEFT JOIN expense_categories ec ON e.category_id = ec.id
         WHERE e.is_void = 0 AND e.date >= ? AND e.date <= ?
         AND ec.code IN ('COAL','WOOD','DIESL')`,
        from, to
      );
      const firingCost = firingRow?.total ?? 0;

      // 3. All expenses (for breakdown)
      const expenseRows = all<any>(
        db,
        `SELECT ec.name AS category, COALESCE(SUM(e.amount), 0) AS amount
         FROM expenses e
         LEFT JOIN expense_categories ec ON e.category_id = ec.id
         WHERE e.is_void = 0 AND e.date >= ? AND e.date <= ?
         GROUP BY ec.name
         ORDER BY amount DESC`,
        from, to
      );

      // 4. Total labour cost (all stages)
      const totalLabour = stages.reduce((s, st) => s + st.labour_cost, 0);
      const totalTransportCost = stages.find((s) => s.stage === 'raw_brick_transport')?.labour_cost || 0;

      // 5. Total cost
      const allExpensesRow = get<{ total: number }>(
        db,
        `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE is_void = 0 AND date >= ? AND date <= ?`,
        from, to
      );
      const allExpenses = allExpensesRow?.total ?? 0;
      const totalCost = totalLabour + allExpenses;

      // 6. Cost per 1000 / per brick
      const costPer1000 = unloaded > 0 ? (totalCost / unloaded) * 1000 : 0;
      const costPerBrick = unloaded > 0 ? totalCost / unloaded : 0;

      // 7. Sales
      const salesRow = get<{ qty: number; revenue: number }>(
        db,
        `SELECT
           COALESCE(SUM(sii.quantity), 0) AS qty,
           COALESCE(SUM(si.total), 0) AS revenue
         FROM sales_invoices si
         LEFT JOIN sales_invoice_items sii ON sii.invoice_id = si.id
         WHERE si.is_void = 0 AND si.date >= ? AND si.date <= ?`,
        from, to
      );
      const salesQty = salesRow?.qty ?? 0;
      const salesRevenue = salesRow?.revenue ?? 0;
      const avgSellingRate = salesQty > 0 ? salesRevenue / salesQty : 0;

      // 8. Profit/Loss
      const profitLoss = salesRevenue - totalCost;
      const profitPerBrick = salesQty > 0 ? profitLoss / salesQty : 0;
      const profitPct = salesRevenue > 0 ? (profitLoss / salesRevenue) * 100 : 0;

      return {
        period: { from, to },
        stages,
        total_raw_made: rawMade,
        total_transport_cost: transportCost,
        total_loaded: loaded,
        total_unloaded: unloaded,
        wastage_qty: wastage,
        wastage_pct: wastagePct,
        firing_cost: firingCost,
        labour_cost: totalLabour,
        transport_cost: totalTransportCost,
        total_cost: totalCost,
        cost_per_1000: costPer1000,
        cost_per_brick: costPerBrick,
        sales_qty: salesQty,
        sales_revenue: salesRevenue,
        avg_selling_rate: avgSellingRate,
        profit_loss: profitLoss,
        profit_per_brick: profitPerBrick,
        profit_pct: profitPct,
        expense_breakdown: expenseRows,
      };
    })();
  });
}
