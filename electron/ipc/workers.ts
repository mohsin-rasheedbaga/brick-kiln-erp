/**
 * Worker IPC handlers.
 * Channels:
 *   - workers:list              -> paginated list with filters
 *   - workers:get               -> single worker
 *   - workers:create            -> create new worker (auto-generates code, barcode, QR token)
 *   - workers:update            -> update worker
 *   - workers:set-status        -> active | inactive | left
 *   - workers:delete           -> delete (only if no transactions)
 *   - workers:ledger            -> complete ledger (production, advances, payments, balance)
 *   - workers:lookup-by-code    -> quick lookup by worker_code or barcode
 *   - workers:generate-codes    -> internal helper: regenerate barcode/QR (admin only)
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { ok, wrap, type IpcResult } from '../utils/ipc';

export interface Worker {
  id: string;
  worker_code: string;
  full_name: string;
  father_name: string | null;
  mobile: string | null;
  address: string | null;
  cnic: string | null;
  joining_date: string;
  department_id: string;
  department_name?: string;
  work_type_id: string | null;
  work_type_name?: string;
  rate_per_1000: number;
  status: 'active' | 'inactive' | 'left';
  photo_path: string | null;
  barcode: string;
  qr_token: string;
  notes: string | null;
  left_date: string | null;
  employment_type: 'piece_rate' | 'salary';
  monthly_salary: number;
  allowed_leaves: number;
  payroll_cycle: string;
  daily_wage: number;
  created_at: string;
  updated_at: string;
}

interface CreateWorkerArgs {
  token: string;
  full_name: string;
  father_name?: string;
  mobile?: string;
  address?: string;
  cnic?: string;
  joining_date?: string;
  department_id: string;
  work_type_id?: string;
  rate_per_1000?: number;
  employment_type?: 'piece_rate' | 'salary';
  monthly_salary?: number;
  allowed_leaves?: number;
  notes?: string;
}

interface ListWorkersArgs {
  token: string;
  search?: string;
  departmentId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

interface WorkerLedgerResponse {
  worker: Worker;
  production: Array<{
    id: string;
    stage: string;
    date: string;
    batch_id: string | null;
    quantity: number;
    rate_per_1000: number;
    labour_amount: number;
  }>;
  advances: Array<{
    id: string;
    date: string;
    amount: number;
    description: string | null;
  }>;
  payments: Array<{
    id: string;
    date: string;
    amount: number;
    description: string | null;
  }>;
  totals: {
    total_production_quantity: number;
    total_labour_earned: number;
    total_advances: number;
    total_payments: number;
    remaining_balance: number; // earned - advances - payments
  };
}

function rowToWorker(row: any): Worker {
  return {
    id: row.id,
    worker_code: row.worker_code,
    full_name: row.full_name,
    father_name: row.father_name,
    mobile: row.mobile,
    address: row.address,
    cnic: row.cnic,
    joining_date: row.joining_date,
    department_id: row.department_id,
    department_name: row.department_name,
    work_type_id: row.work_type_id,
    work_type_name: row.work_type_name,
    rate_per_1000: row.rate_per_1000,
    status: row.status,
    photo_path: row.photo_path,
    barcode: row.barcode,
    qr_token: row.qr_token,
    notes: row.notes,
    left_date: row.left_date,
    employment_type: row.employment_type || 'piece_rate',
    monthly_salary: row.monthly_salary ?? 0,
    allowed_leaves: row.allowed_leaves ?? 4,
    payroll_cycle: row.payroll_cycle || 'weekly',
    daily_wage: row.daily_wage ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const WORKER_SELECT = `
  SELECT w.*,
         d.name  AS department_name,
         wt.name AS work_type_name
  FROM workers w
  LEFT JOIN departments d ON w.department_id = d.id
  LEFT JOIN work_types  wt ON w.work_type_id  = wt.id
`;

/**
 * Generate the next worker code like WKR-0001.
 */
function generateWorkerCode(db: any): string {
  const row = get<{ worker_code: string }>(db, "SELECT worker_code FROM workers WHERE worker_code LIKE 'WKR-%' ORDER BY worker_code DESC LIMIT 1");
  let next = 1;
  if (row && row.worker_code) {
    const match = row.worker_code.match(/WKR-(\d+)/);
    if (match) next = parseInt(match[1], 10) + 1;
  }
  return `WKR-${String(next).padStart(4, '0')}`;
}

/**
 * Generate a unique barcode (numeric, EAN-13 compatible length).
 */
function generateBarcode(): string {
  // 12-digit random numeric string; collisions are very unlikely for a single kiln
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += Math.floor(Math.random() * 10).toString();
  }
  return s;
}

/**
 * Generate a QR token (random URL-safe string; mapped to worker_id at scan time).
 */
function generateQrToken(): string {
  return uuidv4().replace(/-/g, '');
}

export function registerWorkerHandlers(): void {
  ipcMain.handle('workers:list', async (_evt, args: ListWorkersArgs): Promise<IpcResult<{ items: Worker[]; total: number }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');

      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];

      // Phase v1.9.0: Department-scoped access — if user has a department_id and
      // is not super-admin, force-filter to their department only.
      // This means supervisors only see their own department's workers.
      if (session.departmentId && session.roleId !== 'role-super-admin') {
        where.push('w.department_id = ?');
        params.push(session.departmentId);
      }

      if (args.search) {
        where.push('(w.full_name LIKE ? OR w.worker_code LIKE ? OR w.barcode LIKE ? OR w.mobile LIKE ?)');
        const q = `%${args.search}%`;
        params.push(q, q, q, q);
      }
      if (args.departmentId) {
        where.push('w.department_id = ?');
        params.push(args.departmentId);
      }
      if (args.status) {
        where.push('w.status = ?');
        params.push(args.status);
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const limit = Math.min(args.limit ?? 50, 500);
      const offset = Math.max(args.offset ?? 0, 0);

      const countRow = get<{ c: number }>(db, `SELECT COUNT(*) as c FROM workers w ${whereSql}`, ...params);
      const rows = all<any>(
        db,
        `${WORKER_SELECT} ${whereSql} ORDER BY w.worker_code ASC LIMIT ? OFFSET ?`,
        ...params, limit, offset
      );

      return {
        items: rows.map(rowToWorker),
        total: countRow?.c ?? 0,
      };
    })();
  });

  ipcMain.handle('workers:get', async (_evt, args: { token: string; id: string }): Promise<IpcResult<Worker | null>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      const row = get<any>(db, `${WORKER_SELECT} WHERE w.id = ?`, args.id);
      return row ? rowToWorker(row) : null;
    })();
  });

  ipcMain.handle('workers:create', async (_evt, args: CreateWorkerArgs): Promise<IpcResult<Worker>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('workers.create') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to create workers.');
      }

      const fullName = args.full_name?.trim();
      if (!fullName) throw new Error('Worker name is required.');
      if (fullName.length > 200) throw new Error('Worker name is too long.');

      if (!args.department_id) throw new Error('Department is required.');

      const db = getDb();
      // Validate department exists
      const dept = get<{ id: string; is_active: number }>(db, 'SELECT id, is_active FROM departments WHERE id = ?', args.department_id);
      if (!dept) throw new Error('Selected department does not exist.');
      if (!dept.is_active) throw new Error('Selected department is inactive. Please choose an active department.');

      // Validate work type if provided
      if (args.work_type_id) {
        const wt = get<{ id: string }>(db, 'SELECT id FROM work_types WHERE id = ?', args.work_type_id);
        if (!wt) throw new Error('Selected work type does not exist.');
      }

      const rate = Number(args.rate_per_1000 ?? 0);
      if (isNaN(rate) || rate < 0) throw new Error('Rate must be a non-negative number.');

      const id = uuidv4();
      const workerCode = generateWorkerCode(db);
      const barcode = generateBarcode();
      const qrToken = generateQrToken();
      const joiningDate = args.joining_date || new Date().toISOString().slice(0, 10);

      transaction(db, () => {
        const employmentType = args.employment_type || 'piece_rate';
        const monthlySalary = args.monthly_salary ? Number(args.monthly_salary) : 0;
        const allowedLeaves = args.allowed_leaves !== undefined ? Number(args.allowed_leaves) : 4;
        run(
          db,
          `INSERT INTO workers
            (id, worker_code, full_name, father_name, mobile, address, cnic, joining_date,
             department_id, work_type_id, rate_per_1000, status, photo_path, barcode, qr_token,
             notes, left_date, employment_type, monthly_salary, allowed_leaves,
             created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, NULL, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          id, workerCode, fullName, args.father_name ?? null, args.mobile ?? null, args.address ?? null,
          args.cnic ?? null, joiningDate, args.department_id, args.work_type_id ?? null, rate,
          barcode, qrToken, args.notes ?? null,
          employmentType, monthlySalary, allowedLeaves,
          session.userId
        );
        audit({
          userId: session.userId,
          username: session.username,
          action: 'create',
          module: 'workers',
          entityId: id,
          entityType: 'worker',
          description: `Created worker ${fullName} (${workerCode})`,
          newValues: { name: fullName, code: workerCode, department_id: args.department_id },
        });
      });

      const row = get<any>(db, `${WORKER_SELECT} WHERE w.id = ?`, id);
      return rowToWorker(row!);
    })();
  });

  ipcMain.handle('workers:update', async (_evt, args: {
    token: string;
    id: string;
    full_name?: string;
    father_name?: string;
    mobile?: string;
    address?: string;
    cnic?: string;
    department_id?: string;
    work_type_id?: string;
    rate_per_1000?: number;
    employment_type?: 'piece_rate' | 'salary';
    monthly_salary?: number;
    allowed_leaves?: number;
    notes?: string;
  }): Promise<IpcResult<Worker>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('workers.edit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to edit workers.');
      }

      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM workers WHERE id = ?', args.id);
      if (!existing) throw new Error('Worker not found.');

      const updates: string[] = [];
      const params: any[] = [];

      if (args.full_name !== undefined) {
        const v = args.full_name.trim();
        if (!v) throw new Error('Worker name cannot be empty.');
        updates.push('full_name = ?'); params.push(v);
      }
      if (args.father_name !== undefined) { updates.push('father_name = ?'); params.push(args.father_name || null); }
      if (args.mobile !== undefined) { updates.push('mobile = ?'); params.push(args.mobile || null); }
      if (args.address !== undefined) { updates.push('address = ?'); params.push(args.address || null); }
      if (args.cnic !== undefined) { updates.push('cnic = ?'); params.push(args.cnic || null); }
      if (args.department_id !== undefined) {
        const dept = get<{ id: string; is_active: number }>(db, 'SELECT id, is_active FROM departments WHERE id = ?', args.department_id);
        if (!dept) throw new Error('Selected department does not exist.');
        if (!dept.is_active) throw new Error('Selected department is inactive.');
        updates.push('department_id = ?'); params.push(args.department_id);
      }
      if (args.work_type_id !== undefined) {
        if (args.work_type_id) {
          const wt = get<{ id: string }>(db, 'SELECT id FROM work_types WHERE id = ?', args.work_type_id);
          if (!wt) throw new Error('Selected work type does not exist.');
        }
        updates.push('work_type_id = ?'); params.push(args.work_type_id || null);
      }
      if (args.rate_per_1000 !== undefined) {
        const v = Number(args.rate_per_1000);
        if (isNaN(v) || v < 0) throw new Error('Rate must be a non-negative number.');
        updates.push('rate_per_1000 = ?'); params.push(v);
      }
      if (args.employment_type !== undefined) {
        if (!['piece_rate', 'salary'].includes(args.employment_type)) throw new Error('Invalid employment type.');
        updates.push('employment_type = ?'); params.push(args.employment_type);
      }
      if (args.monthly_salary !== undefined) {
        const v = Number(args.monthly_salary);
        if (isNaN(v) || v < 0) throw new Error('Monthly salary must be non-negative.');
        updates.push('monthly_salary = ?'); params.push(v);
      }
      if (args.allowed_leaves !== undefined) {
        const v = Number(args.allowed_leaves);
        if (!Number.isInteger(v) || v < 0) throw new Error('Allowed leaves must be a non-negative integer.');
        updates.push('allowed_leaves = ?'); params.push(v);
      }
      if (args.notes !== undefined) { updates.push('notes = ?'); params.push(args.notes || null); }

      if (updates.length === 0) throw new Error('No fields to update.');

      updates.push("updated_at = datetime('now')");
      params.push(args.id);

      transaction(db, () => {
        run(db, `UPDATE workers SET ${updates.join(', ')} WHERE id = ?`, ...params);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'update',
          module: 'workers',
          entityId: args.id,
          entityType: 'worker',
          description: `Updated worker ${existing.full_name}`,
          oldValues: { full_name: existing.full_name, mobile: existing.mobile, department_id: existing.department_id },
          newValues: args,
        });
      });

      const row = get<any>(db, `${WORKER_SELECT} WHERE w.id = ?`, args.id);
      return rowToWorker(row!);
    })();
  });

  ipcMain.handle('workers:set-status', async (_evt, args: {
    token: string;
    id: string;
    status: 'active' | 'inactive' | 'left';
  }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('workers.edit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to update workers.');
      }

      const db = getDb();
      const existing = get<{ full_name: string }>(db, 'SELECT full_name FROM workers WHERE id = ?', args.id);
      if (!existing) throw new Error('Worker not found.');

      const leftDate = args.status === 'left' ? new Date().toISOString().slice(0, 10) : null;

      transaction(db, () => {
        run(db, "UPDATE workers SET status = ?, left_date = ?, updated_at = datetime('now') WHERE id = ?", args.status, leftDate, args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'status_change',
          module: 'workers',
          entityId: args.id,
          entityType: 'worker',
          description: `Set worker ${existing.full_name} status to ${args.status}`,
        });
      });
      return { success: true } as const;
    })();
  });

  ipcMain.handle('workers:delete', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('workers.delete') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to delete workers.');
      }

      const db = getDb();
      const existing = get<{ full_name: string; worker_code: string }>(db, 'SELECT full_name, worker_code FROM workers WHERE id = ?', args.id);
      if (!existing) throw new Error('Worker not found.');

      // Check for transactions
      const prodCount = get<{ c: number }>(db, 'SELECT COUNT(*) as c FROM production_entries WHERE worker_id = ?', args.id);
      const advCount = get<{ c: number }>(db, 'SELECT COUNT(*) as c FROM worker_advances WHERE worker_id = ?', args.id);
      const payCount = get<{ c: number }>(db, 'SELECT COUNT(*) as c FROM worker_payments WHERE worker_id = ?', args.id);

      const totalTrans = (prodCount?.c ?? 0) + (advCount?.c ?? 0) + (payCount?.c ?? 0);
      if (totalTrans > 0) {
        throw new Error(`Cannot delete worker: ${totalTrans} transaction(s) exist. Set status to "left" instead to preserve history.`);
      }

      transaction(db, () => {
        run(db, 'DELETE FROM workers WHERE id = ?', args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'delete',
          module: 'workers',
          entityId: args.id,
          entityType: 'worker',
          description: `Deleted worker ${existing.full_name} (${existing.worker_code})`,
        });
      });
      return { success: true } as const;
    })();
  });

  ipcMain.handle('workers:ledger', async (_evt, args: { token: string; id: string; from?: string; to?: string }): Promise<IpcResult<WorkerLedgerResponse>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('workers.ledger') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view worker ledgers.');
      }

      const db = getDb();
      const worker = get<any>(db, `${WORKER_SELECT} WHERE w.id = ?`, args.id);
      if (!worker) throw new Error('Worker not found.');

      const dateFilter: string[] = [];
      const dateParams: any[] = [];
      if (args.from) { dateFilter.push('date >= ?'); dateParams.push(args.from); }
      if (args.to)   { dateFilter.push('date <= ?'); dateParams.push(args.to); }
      const dateSql = dateFilter.length ? `AND ${dateFilter.join(' AND ')}` : '';

      const production = all<any>(db,
        `SELECT id, stage, date, batch_id, quantity, rate_per_1000, labour_amount
         FROM production_entries WHERE worker_id = ? ${dateSql}
         ORDER BY date ASC, created_at ASC`, args.id, ...dateParams);

      // Advances & payments don't use stage column - they have their own tables
      const advances = all<any>(db,
        `SELECT id, date, amount, description FROM worker_advances
         WHERE worker_id = ? AND is_void = 0 ${dateSql}
         ORDER BY date ASC, created_at ASC`, args.id, ...dateParams);

      const payments = all<any>(db,
        `SELECT id, date, amount, description FROM worker_payments
         WHERE worker_id = ? AND is_void = 0 ${dateSql}
         ORDER BY date ASC, created_at ASC`, args.id, ...dateParams);

      const totalQty = production.reduce((s, p) => s + p.quantity, 0);
      const totalEarned = production.reduce((s, p) => s + p.labour_amount, 0);
      const totalAdvances = advances.reduce((s, a) => s + a.amount, 0);
      const totalPayments = payments.reduce((s, p) => s + p.amount, 0);

      return {
        worker: rowToWorker(worker),
        production,
        advances,
        payments,
        totals: {
          total_production_quantity: totalQty,
          total_labour_earned: totalEarned,
          total_advances: totalAdvances,
          total_payments: totalPayments,
          remaining_balance: totalEarned - totalAdvances - totalPayments,
        },
      };
    })();
  });

  ipcMain.handle('workers:lookup-by-code', async (_evt, args: { token: string; code: string }): Promise<IpcResult<Worker | null>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();
      // Try worker_code, then barcode, then qr_token
      const row = get<any>(
        db,
        `${WORKER_SELECT} WHERE w.worker_code = ? OR w.barcode = ? OR w.qr_token = ? LIMIT 1`,
        args.code, args.code, args.code
      );
      return row ? rowToWorker(row) : null;
    })();
  });

  // ============== Phase 4: Worker Family Contact ==============

  ipcMain.handle('workers:get-family', async (_evt, args: { token: string; workerId: string }): Promise<IpcResult<{
    family_number: string | null;
    family_contact_name: string | null;
    relation: string | null;
    alt_number: string | null;
  } | null>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('workers.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view workers.');
      }
      const db = getDb();
      const row = get<any>(db, 'SELECT * FROM worker_family WHERE worker_id = ?', args.workerId);
      if (!row) return null;
      return {
        family_number: row.family_number,
        family_contact_name: row.family_contact_name,
        relation: row.relation,
        alt_number: row.alt_number,
      };
    })();
  });

  ipcMain.handle('workers:set-family', async (_evt, args: {
    token: string;
    workerId: string;
    familyNumber?: string;
    familyContactName?: string;
    relation?: string;
    altNumber?: string;
  }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('workers.edit') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to edit workers.');
      }
      const db = getDb();
      const w = get<{ id: string }>(db, 'SELECT id FROM workers WHERE id = ?', args.workerId);
      if (!w) throw new Error('Worker not found.');
      transaction(db, () => {
        run(
          db,
          `INSERT INTO worker_family (id, worker_id, family_number, family_contact_name, relation, alt_number, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(worker_id) DO UPDATE SET
             family_number = excluded.family_number,
             family_contact_name = excluded.family_contact_name,
             relation = excluded.relation,
             alt_number = excluded.alt_number,
             updated_at = datetime('now')`,
          uuidv4(), args.workerId,
          args.familyNumber ?? null,
          args.familyContactName ?? null,
          args.relation ?? null,
          args.altNumber ?? null
        );
        audit({
          userId: session.userId,
          username: session.username,
          action: 'update',
          module: 'workers',
          entityId: args.workerId,
          entityType: 'worker_family',
          description: `Updated family contact for worker`,
          newValues: { family_number: args.familyNumber, family_contact_name: args.familyContactName, relation: args.relation },
        });
      });
      return { success: true } as const;
    })();
  });

  // ============== Phase 4: Worker Account Summary (card-style) ==============
  // Returns the live worker account for printing on a card or showing in UI.
  ipcMain.handle('workers:account-summary', async (_evt, args: { token: string; workerId: string }): Promise<IpcResult<{
    worker: Worker;
    family: { family_number: string | null; family_contact_name: string | null; relation: string | null; alt_number: string | null; } | null;
    earned: number;
    advances_total: number;
    payments_total: number;
    balance: number;             // earned - advances - payments (positive = payable to worker)
    last_activity_date: string | null;
    last_advance_amount: number;
    last_advance_date: string | null;
    last_payment_amount: number;
    last_payment_date: string | null;
    total_production_qty: number;
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('workers.view') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to view workers.');
      }
      const db = getDb();
      const workerRow = get<any>(db, `${WORKER_SELECT} WHERE w.id = ?`, args.workerId);
      if (!workerRow) throw new Error('Worker not found.');

      const earnedRow = get<{ total: number; qty: number }>(
        db,
        `SELECT COALESCE(SUM(labour_amount), 0) AS total, COALESCE(SUM(quantity), 0) AS qty FROM production_entries WHERE worker_id = ?`,
        args.workerId
      );
      const advRow = get<{ total: number; last_amount: number; last_date: string }>(
        db,
        `SELECT COALESCE(SUM(amount), 0) AS total,
                (SELECT amount FROM worker_advances WHERE worker_id = ? AND is_void = 0 ORDER BY date DESC LIMIT 1) AS last_amount,
                (SELECT date FROM worker_advances WHERE worker_id = ? AND is_void = 0 ORDER BY date DESC LIMIT 1) AS last_date
         FROM worker_advances WHERE worker_id = ? AND is_void = 0`,
        args.workerId, args.workerId, args.workerId
      );
      const payRow = get<{ total: number; last_amount: number; last_date: string }>(
        db,
        `SELECT COALESCE(SUM(amount), 0) AS total,
                (SELECT amount FROM worker_payments WHERE worker_id = ? AND is_void = 0 ORDER BY date DESC LIMIT 1) AS last_amount,
                (SELECT date FROM worker_payments WHERE worker_id = ? AND is_void = 0 ORDER BY date DESC LIMIT 1) AS last_date
         FROM worker_payments WHERE worker_id = ? AND is_void = 0`,
        args.workerId, args.workerId, args.workerId
      );
      const lastActRow = get<{ d: string }>(
        db,
        `SELECT MAX(d) AS d FROM (
          SELECT date AS d FROM production_entries WHERE worker_id = ?
          UNION ALL
          SELECT date FROM worker_advances WHERE worker_id = ? AND is_void = 0
          UNION ALL
          SELECT date FROM worker_payments WHERE worker_id = ? AND is_void = 0
        )`,
        args.workerId, args.workerId, args.workerId
      );
      const fam = get<any>(db, 'SELECT * FROM worker_family WHERE worker_id = ?', args.workerId);

      const earned = earnedRow?.total ?? 0;
      const advances = advRow?.total ?? 0;
      const payments = payRow?.total ?? 0;

      return {
        worker: rowToWorker(workerRow),
        family: fam ? {
          family_number: fam.family_number,
          family_contact_name: fam.family_contact_name,
          relation: fam.relation,
          alt_number: fam.alt_number,
        } : null,
        earned,
        advances_total: advances,
        payments_total: payments,
        balance: earned - advances - payments,
        last_activity_date: lastActRow?.d ?? null,
        last_advance_amount: advRow?.last_amount ?? 0,
        last_advance_date: advRow?.last_date ?? null,
        last_payment_amount: payRow?.last_amount ?? 0,
        last_payment_date: payRow?.last_date ?? null,
        total_production_qty: earnedRow?.qty ?? 0,
      };
    })();
  });
}
