/**
 * Daily Production Summary IPC handler.
 *
 * Returns a structured summary for a single day, breaking down production
 * by stage with quantities + labour costs. Used by:
 *   - The Daily Production Summary page
 *   - The dashboard "today" widget
 *
 * Channels:
 *   - reports:daily-summary -> structured per-stage summary for a single day
 */

import { ipcMain } from 'electron';
import { getDb, get, all } from '../database/connection';
import { getSession } from '../utils/session';
import { wrap, type IpcResult } from '../utils/ipc';

export interface DailyStageSummary {
  stage: string;
  stage_label: string;
  total_qty: number;
  total_labour: number;
  entries_count: number;
  unique_workers: number;
}

export interface DailyProductionSummary {
  date: string;
  stages: DailyStageSummary[];
  total_qty: number;
  total_labour: number;
  total_entries: number;
  total_workers_active: number;
  top_workers: Array<{
    worker_id: string;
    worker_code: string;
    worker_name: string;
    department_name: string;
    total_qty: number;
    total_labour: number;
  }>;
  // Stock snapshot (current, not just today)
  stock_snapshot: Array<{
    category_id: string;
    category_name: string;
    quantity: number;
  }>;
  // Batch info
  active_batches: number;
  firing_batches: number;
  // Department-wise breakdown
  by_department: Array<{
    department_id: string;
    department_name: string;
    total_qty: number;
    total_labour: number;
    entries_count: number;
  }>;
}

const STAGE_LABELS: Record<string, string> = {
  raw_brick_making: 'Raw Bricks Made (نئی کچی اینٹ)',
  raw_brick_transport: 'Raw Bricks Transported to Kiln (کچی اینٹ پہنچی)',
  kiln_loading: 'Bricks Loaded into Kiln (بھٹے میں لوڈ ہوئی)',
  baked_brick_unloading: 'Baked Bricks Unloaded (پکی اینٹ نکلی)',
};

export function registerDailySummaryHandlers(): void {
  ipcMain.handle('reports:daily-summary', async (_evt, args: { token: string; date?: string }): Promise<IpcResult<DailyProductionSummary>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('reports.view') && !session.permissions.includes('dashboard.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view reports.');
      }

      const db = getDb();
      const date = args.date || new Date().toISOString().slice(0, 10);

      // Per-stage summary
      const stageRows = all<any>(
        db,
        `SELECT
           pe.stage,
           COALESCE(SUM(pe.quantity), 0) AS total_qty,
           COALESCE(SUM(pe.labour_amount), 0) AS total_labour,
           COUNT(*) AS entries_count,
           COUNT(DISTINCT pe.worker_id) AS unique_workers
         FROM production_entries pe
         WHERE pe.date = ?
         GROUP BY pe.stage
         ORDER BY CASE pe.stage
           WHEN 'raw_brick_making' THEN 1
           WHEN 'raw_brick_transport' THEN 2
           WHEN 'kiln_loading' THEN 3
           WHEN 'baked_brick_unloading' THEN 4
           ELSE 99 END`,
        date
      );

      const stages: DailyStageSummary[] = stageRows.map((r) => ({
        stage: r.stage,
        stage_label: STAGE_LABELS[r.stage] || r.stage,
        total_qty: r.total_qty,
        total_labour: r.total_labour,
        entries_count: r.entries_count,
        unique_workers: r.unique_workers,
      }));

      // Top workers (by quantity, top 10)
      const topWorkers = all<any>(
        db,
        `SELECT
           pe.worker_id,
           w.worker_code,
           w.full_name AS worker_name,
           d.name AS department_name,
           COALESCE(SUM(pe.quantity), 0) AS total_qty,
           COALESCE(SUM(pe.labour_amount), 0) AS total_labour
         FROM production_entries pe
         LEFT JOIN workers w ON pe.worker_id = w.id
         LEFT JOIN departments d ON pe.department_id = d.id
         WHERE pe.date = ?
         GROUP BY pe.worker_id
         ORDER BY total_qty DESC
         LIMIT 10`,
        date
      );

      // Stock snapshot
      const stockRows = all<any>(
        db,
        `SELECT bc.id AS category_id, bc.name AS category_name, COALESCE(s.quantity, 0) AS quantity
         FROM brick_categories bc
         LEFT JOIN stock s ON s.category_id = bc.id
         WHERE bc.is_active = 1
         ORDER BY bc.sort_order, bc.name`
      );

      // Batch counts
      const batchRow = get<{ active: number; firing: number }>(
        db,
        `SELECT
           SUM(CASE WHEN status IN ('open', 'loading', 'loaded', 'firing', 'ready', 'unloading') THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status = 'firing' THEN 1 ELSE 0 END) AS firing
         FROM batches`
      );

      // Department-wise breakdown
      const deptRows = all<any>(
        db,
        `SELECT
           pe.department_id,
           d.name AS department_name,
           COALESCE(SUM(pe.quantity), 0) AS total_qty,
           COALESCE(SUM(pe.labour_amount), 0) AS total_labour,
           COUNT(*) AS entries_count
         FROM production_entries pe
         LEFT JOIN departments d ON pe.department_id = d.id
         WHERE pe.date = ?
         GROUP BY pe.department_id
         ORDER BY total_qty DESC`,
        date
      );

      const totalQty = stages.reduce((s, x) => s + x.total_qty, 0);
      const totalLabour = stages.reduce((s, x) => s + x.total_labour, 0);
      const totalEntries = stages.reduce((s, x) => s + x.entries_count, 0);
      const totalWorkers = new Set(topWorkers.map((w) => w.worker_id)).size;

      return {
        date,
        stages,
        total_qty: totalQty,
        total_labour: totalLabour,
        total_entries: totalEntries,
        total_workers_active: totalWorkers,
        top_workers: topWorkers,
        stock_snapshot: stockRows,
        active_batches: batchRow?.active ?? 0,
        firing_batches: batchRow?.firing ?? 0,
        by_department: deptRows,
      };
    })();
  });
}
