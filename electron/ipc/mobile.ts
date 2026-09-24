/**
 * Mobile-specific IPC handlers.
 *
 * The Android app uses these to minimize network round-trips:
 *   - mobile:context  -> returns user info + department workers + work types + recent entries
 *   - mobile:submit    -> submits a production entry (alias for production:create with validation)
 *
 * All existing desktop IPC channels (auth:login, workers:list, production:create, etc.)
 * are ALSO accessible to the mobile app via the same /rpc endpoint. These mobile:*
 * channels just bundle common calls for efficiency.
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, wrap, type IpcResult } from '../utils/ipc';

const VALID_STAGES = ['raw_brick_making', 'raw_brick_transport', 'baked_brick_unloading'];

export function registerMobileHandlers(): void {
  /**
   * Fetch everything the mobile app needs in ONE call after login:
   *   - Current user info (id, name, role, department, permissions)
   *   - Workers in the user's department (for production entry dropdown)
   *   - Work types (with default rates)
   *   - User's last 20 production entries (history)
   *   - Kilns (for transport + unloading stages)
   *   - Brick categories (for unloading stage)
   */
  ipcMain.handle('mobile:context', async (_evt, args: { token: string }): Promise<IpcResult<any>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired. Please log in again.');

      const db = getDb();

      // User's department info
      const dept = session.departmentId
        ? get<{ id: string; name: string; code: string }>(
            db, 'SELECT id, name, code FROM departments WHERE id = ?', session.departmentId
          )
        : null;

      // Workers in user's department (operators only see their own dept's workers)
      // For super-admin/admin/manager: return ALL active workers
      const isOperator = ['role-raw-maker', 'role-transport', 'role-kiln-unload'].includes(session.roleId);
      let workers: any[];
      if (isOperator && session.departmentId) {
        workers = all<any>(
          db, `SELECT id, worker_code, full_name, father_name, department_id, work_type_id,
                      rate_per_1000, employment_type, daily_wage, monthly_salary, status
               FROM workers WHERE department_id = ? AND status = 'active' ORDER BY full_name`,
          session.departmentId
        );
      } else {
        workers = all<any>(
          db, `SELECT id, worker_code, full_name, father_name, department_id, work_type_id,
                      rate_per_1000, employment_type, daily_wage, monthly_salary, status
               FROM workers WHERE status = 'active' ORDER BY full_name LIMIT 500`
        );
      }

      // Work types
      const workTypes = all<any>(
        db, `SELECT id, name, code, department_id, default_rate_per_1000, is_active
             FROM work_types WHERE is_active = 1 ORDER BY name`
      );

      // Kilns (for transport + unloading)
      const kilns = all<any>(
        db, `SELECT id, name, code, status FROM kilns ORDER BY name`
      );

      // Brick categories (for unloading)
      const brickCategories = all<any>(
        db, `SELECT id, name, code, default_selling_rate FROM brick_categories WHERE is_active = 1 ORDER BY sort_order`
      );

      // User's last 20 production entries
      const recentEntries = all<any>(
        db, `SELECT pe.id, pe.stage, pe.date, pe.quantity, pe.rate_per_1000, pe.labour_amount,
                    pe.worker_id, w.full_name AS worker_name, w.worker_code,
                    pe.department_id, d.name AS department_name,
                    pe.work_type_id, wt.name AS work_type_name,
                    pe.batch_id, pe.kiln_id, k.name AS kiln_name,
                    pe.notes, pe.created_at
             FROM production_entries pe
             LEFT JOIN workers w ON pe.worker_id = w.id
             LEFT JOIN departments d ON pe.department_id = d.id
             LEFT JOIN work_types wt ON pe.work_type_id = wt.id
             LEFT JOIN kilns k ON pe.kiln_id = k.id
             WHERE pe.entered_by = ?
             ORDER BY pe.created_at DESC LIMIT 20`,
        session.userId
      );

      // Today's totals for the user (their dashboard cards)
      const todayStats = get<{ total_qty: number; total_labour: number; entry_count: number }>(
        db, `SELECT COALESCE(SUM(quantity),0) AS total_qty,
                    COALESCE(SUM(labour_amount),0) AS total_labour,
                    COUNT(*) AS entry_count
             FROM production_entries
             WHERE entered_by = ? AND date = date('now')`,
        session.userId
      );

      return {
        user: {
          id: session.userId,
          username: session.username,
          fullName: session.fullName,
          roleId: session.roleId,
          roleName: session.roleName,
          departmentId: session.departmentId,
          departmentName: dept?.name,
          permissions: session.permissions,
        },
        department: dept,
        workers,
        workTypes,
        kilns,
        brickCategories,
        recentEntries,
        todayStats: todayStats || { total_qty: 0, total_labour: 0, entry_count: 0 },
        timestamp: new Date().toISOString(),
      };
    })();
  });

  /**
   * Submit a production entry from mobile.
   * This is the same as production:create but with extra logging so the desktop
   * audit trail shows it came from a mobile device.
   */
  ipcMain.handle('mobile:submit-production', async (_evt, args: {
    token: string;
    stage: string;
    workerId: string;
    quantity: number;
    ratePer1000?: number;       // optional override; default = work type's rate
    workTypeId?: string;
    batchId?: string;
    kilnId?: string;
    categoryId?: string;        // for baked_brick_unloading
    date?: string;              // defaults to today (allows back-dating for offline entries)
    notes?: string;
    /** Client-side generated ID for idempotency (prevents duplicate syncs) */
    clientUuid?: string;
  }): Promise<IpcResult<any>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired. Please log in again.');
      if (!session.permissions.includes('production.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to create production entries.');
      }
      if (!VALID_STAGES.includes(args.stage)) {
        throw new Error(`Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}`);
      }
      if (!args.workerId) throw new Error('Worker is required.');
      if (!args.quantity || args.quantity <= 0) throw new Error('Quantity must be greater than zero.');

      const db = getDb();

      // Look up worker to get their department + default rate
      const worker = get<{ id: string; department_id: string; work_type_id: string | null; rate_per_1000: number }>(
        db, 'SELECT id, department_id, work_type_id, rate_per_1000 FROM workers WHERE id = ?',
        args.workerId
      );
      if (!worker) throw new Error('Worker not found.');

      const workTypeId = args.workTypeId || worker.work_type_id;
      if (!workTypeId) throw new Error('Work type is required (worker has no default work type).');

      // Determine rate: explicit > work type default > worker rate
      let rate = args.ratePer1000 ?? worker.rate_per_1000;
      if (!rate || rate <= 0) {
        const wt = get<{ default_rate_per_1000: number }>(
          db, 'SELECT default_rate_per_1000 FROM work_types WHERE id = ?', workTypeId
        );
        if (wt?.default_rate_per_1000) rate = wt.default_rate_per_1000;
      }
      if (!rate || rate <= 0) throw new Error('Could not determine rate. Please specify ratePer1000.');

      const labourAmount = (args.quantity / 1000) * rate;
      const date = args.date || new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const id = args.clientUuid || uuidv4();

      transaction(db, () => {
        run(
          db,
          `INSERT INTO production_entries (id, stage, date, batch_id, kiln_id, worker_id, department_id,
                                          work_type_id, quantity, rate_per_1000, labour_amount, category_id,
                                          notes, entered_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          id, args.stage, date, args.batchId ?? null, args.kilnId ?? null,
          args.workerId, worker.department_id, workTypeId,
          args.quantity, rate, labourAmount, args.categoryId ?? null,
          args.notes ?? null, session.userId
        );

        // Update stock on baked_brick_unloading
        if (args.stage === 'baked_brick_unloading' && args.categoryId) {
          run(
            db,
            `INSERT INTO stock_movements (id, date, category_id, movement_type, quantity, reference_type, reference_id, batch_id, notes, entered_by, created_at)
             VALUES (?, ?, ?, 'production_in', ?, 'production', ?, ?, ?, ?, datetime('now'))`,
            uuidv4(), date, args.categoryId, args.quantity, id, args.batchId ?? null,
            `Mobile: ${args.stage} by ${session.username}`, session.userId
          );
        }

        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'production',
          entityId: id,
          entityType: 'production_entry',
          description: `[MOBILE] Recorded ${args.stage}: qty=${args.quantity}, labour=${labourAmount.toFixed(2)}, worker=${args.workerId}`,
          newValues: { stage: args.stage, quantity: args.quantity, rate, labour_amount: labourAmount, worker_id: args.workerId, date },
        });
      });

      return {
        id,
        stage: args.stage,
        date,
        quantity: args.quantity,
        ratePer1000: rate,
        labourAmount,
        workerId: args.workerId,
        workTypeId,
        departmentId: worker.department_id,
        batchId: args.batchId ?? null,
        kilnId: args.kilnId ?? null,
        categoryId: args.categoryId ?? null,
        notes: args.notes ?? null,
        enteredBy: session.userId,
        createdAt: new Date().toISOString(),
      };
    })();
  });

  /**
   * Get sync status for the mobile app's sync screen.
   * Returns the count of entries the desktop has received from this mobile user
   * in the last 24 hours (used to verify sync is working).
   */
  ipcMain.handle('mobile:sync-status', async (_evt, args: { token: string }): Promise<IpcResult<any>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');

      const db = getDb();
      const last24h = get<{ count: number; last_at: string | null }>(
        db, `SELECT COUNT(*) AS count, MAX(created_at) AS last_at
             FROM production_entries
             WHERE entered_by = ? AND created_at >= datetime('now', '-1 day')`,
        session.userId
      );
      const todayTotal = get<{ qty: number; labour: number }>(
        db, `SELECT COALESCE(SUM(quantity),0) AS qty, COALESCE(SUM(labour_amount),0) AS labour
             FROM production_entries
             WHERE entered_by = ? AND date = date('now')`,
        session.userId
      );
      return {
        entriesSynced24h: last24h?.count || 0,
        lastSyncAt: last24h?.last_at,
        todayQty: todayTotal?.qty || 0,
        todayLabour: todayTotal?.labour || 0,
        serverTime: new Date().toISOString(),
      };
    })();
  });
}
