/**
 * Department Rates IPC handlers.
 *
 * Manages configurable rates per department × work_type × brick_category.
 * Used by production entry to look up the applicable rate automatically.
 *
 * Channels:
 *   - department-rates:list           -> all rates with filters
 *   - department-rates:get-by-context -> lookup rate for a specific dept+work_type+category combo
 *   - department-rates:upsert        -> insert or update a rate
 *   - department-rates:delete        -> remove a rate
 *   - department-rates:matrix        -> structured view: department × work_type × category
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { getDb, get, all, run, transaction } from '../database/connection';
import { getSession } from '../utils/session';
import { audit } from '../utils/audit';
import { wrap, type IpcResult } from '../utils/ipc';

export interface DepartmentRate {
  id: string;
  department_id: string;
  department_name?: string;
  work_type_id: string;
  work_type_name?: string;
  brick_category_id: string | null;
  brick_category_name?: string | null;
  rate_per_1000: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const RATE_SELECT = `
  SELECT dr.*,
         d.name AS department_name,
         wt.name AS work_type_name,
         bc.name AS brick_category_name
  FROM department_rates dr
  LEFT JOIN departments d ON dr.department_id = d.id
  LEFT JOIN work_types wt ON dr.work_type_id = wt.id
  LEFT JOIN brick_categories bc ON dr.brick_category_id = bc.id
`;

function rowToRate(row: any): DepartmentRate {
  return {
    id: row.id,
    department_id: row.department_id,
    department_name: row.department_name,
    work_type_id: row.work_type_id,
    work_type_name: row.work_type_name,
    brick_category_id: row.brick_category_id,
    brick_category_name: row.brick_category_name,
    rate_per_1000: row.rate_per_1000 ?? 0,
    is_active: !!row.is_active,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function registerDepartmentRateHandlers(): void {
  // List rates with optional filters
  ipcMain.handle('department-rates:list', async (_evt, args: {
    token: string;
    departmentId?: string;
    workTypeId?: string;
    brickCategoryId?: string | null;
    includeInactive?: boolean;
  }): Promise<IpcResult<DepartmentRate[]>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');

      const db = getDb();
      const where: string[] = [];
      const params: any[] = [];
      if (args.departmentId) { where.push('dr.department_id = ?'); params.push(args.departmentId); }
      if (args.workTypeId) { where.push('dr.work_type_id = ?'); params.push(args.workTypeId); }
      if (args.brickCategoryId !== undefined) {
        if (args.brickCategoryId === null) {
          where.push('dr.brick_category_id IS NULL');
        } else {
          where.push('(dr.brick_category_id = ? OR dr.brick_category_id IS NULL)');
          params.push(args.brickCategoryId);
        }
      }
      if (!args.includeInactive) where.push('dr.is_active = 1');
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = all<any>(
        db,
        `${RATE_SELECT} ${whereSql} ORDER BY d.name, wt.name, bc.sort_order`,
        ...params
      );
      return rows.map(rowToRate);
    })();
  });

  // Lookup the applicable rate for a specific context.
  // Priority: exact match (dept + work_type + category) > general (dept + work_type, category NULL)
  ipcMain.handle('department-rates:get-by-context', async (_evt, args: {
    token: string;
    departmentId: string;
    workTypeId: string;
    brickCategoryId?: string;
  }): Promise<IpcResult<{ rate_per_1000: number; source: string; rate_id: string | null }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');

      const db = getDb();
      // 1. Try exact match
      if (args.brickCategoryId) {
        const exact = get<{ id: string; rate_per_1000: number }>(
          db,
          `SELECT id, rate_per_1000 FROM department_rates
           WHERE department_id = ? AND work_type_id = ? AND brick_category_id = ? AND is_active = 1`,
          args.departmentId, args.workTypeId, args.brickCategoryId
        );
        if (exact) return { rate_per_1000: exact.rate_per_1000, source: 'department_rate_specific', rate_id: exact.id };
      }
      // 2. Try general (no category)
      const general = get<{ id: string; rate_per_1000: number }>(
        db,
        `SELECT id, rate_per_1000 FROM department_rates
         WHERE department_id = ? AND work_type_id = ? AND brick_category_id IS NULL AND is_active = 1`,
        args.departmentId, args.workTypeId
      );
      if (general) return { rate_per_1000: general.rate_per_1000, source: 'department_rate_general', rate_id: general.id };

      // 3. Fall back to work type's default
      const wt = get<{ default_rate_per_1000: number }>(db, 'SELECT default_rate_per_1000 FROM work_types WHERE id = ?', args.workTypeId);
      if (wt) return { rate_per_1000: wt.default_rate_per_1000, source: 'work_type_default', rate_id: null };

      return { rate_per_1000: 0, source: 'none', rate_id: null };
    })();
  });

  // Upsert: insert or update a rate
  ipcMain.handle('department-rates:upsert', async (_evt, args: {
    token: string;
    departmentId: string;
    workTypeId: string;
    brickCategoryId?: string | null;
    ratePer1000: number;
    notes?: string;
  }): Promise<IpcResult<DepartmentRate>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage rates.');
      }
      if (!args.departmentId) throw new Error('Department is required.');
      if (!args.workTypeId) throw new Error('Work type is required.');
      const rate = Number(args.ratePer1000);
      if (isNaN(rate) || rate < 0) throw new Error('Rate must be a non-negative number.');

      const db = getDb();
      // Validate references
      const dept = get<{ id: string }>(db, 'SELECT id FROM departments WHERE id = ?', args.departmentId);
      if (!dept) throw new Error('Department not found.');
      const wt = get<{ id: string }>(db, 'SELECT id FROM work_types WHERE id = ?', args.workTypeId);
      if (!wt) throw new Error('Work type not found.');
      if (args.brickCategoryId) {
        const cat = get<{ id: string }>(db, 'SELECT id FROM brick_categories WHERE id = ?', args.brickCategoryId);
        if (!cat) throw new Error('Brick category not found.');
      }

      const categoryId = args.brickCategoryId ?? null;
      const id = uuidv4();

      transaction(db, () => {
        // Insert or update via UPSERT (ON CONFLICT)
        run(
          db,
          `INSERT INTO department_rates (id, department_id, work_type_id, brick_category_id, rate_per_1000, is_active, notes, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(department_id, work_type_id, brick_category_id) DO UPDATE SET
             rate_per_1000 = excluded.rate_per_1000,
             notes = excluded.notes,
             updated_at = datetime('now')`,
          id, args.departmentId, args.workTypeId, categoryId, rate,
          args.notes ?? null, session.userId
        );
        audit({
          userId: session.userId,
          username: session.username,
          action: 'upsert',
          module: 'department_rates',
          description: `Set rate ${rate} for dept=${args.departmentId} work=${args.workTypeId} category=${categoryId || '*'}`,
          newValues: { department_id: args.departmentId, work_type_id: args.workTypeId, brick_category_id: categoryId, rate_per_1000: rate },
        });
      });

      // Fetch the row (might be the existing one after upsert)
      const row = get<any>(
        db,
        `${RATE_SELECT} WHERE dr.department_id = ? AND dr.work_type_id = ? AND ${categoryId ? 'dr.brick_category_id = ?' : 'dr.brick_category_id IS NULL'}`,
        args.departmentId, args.workTypeId, ...(categoryId ? [categoryId] : [])
      );
      return rowToRate(row!);
    })();
  });

  // Delete a rate
  ipcMain.handle('department-rates:delete', async (_evt, args: { token: string; id: string }): Promise<IpcResult<{ success: true }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      if (!session.permissions.includes('settings.manage') && session.roleId !== 'role-super-admin') {
        throw new Error('You do not have permission to manage rates.');
      }
      const db = getDb();
      const existing = get<any>(db, 'SELECT * FROM department_rates WHERE id = ?', args.id);
      if (!existing) throw new Error('Rate not found.');
      transaction(db, () => {
        run(db, 'DELETE FROM department_rates WHERE id = ?', args.id);
        audit({
          userId: session.userId,
          username: session.username,
          action: 'delete',
          module: 'department_rates',
          entityId: args.id,
          description: `Deleted rate for dept=${existing.department_id} work=${existing.work_type_id}`,
        });
      });
      return { success: true } as const;
    })();
  });

  // Matrix view: returns a structured array suitable for the UI table
  ipcMain.handle('department-rates:matrix', async (_evt, args: { token: string; departmentId?: string }): Promise<IpcResult<{
    departments: Array<{ id: string; name: string; code: string }>;
    work_types: Array<{ id: string; name: string; code: string }>;
    categories: Array<{ id: string; name: string; code: string; sort_order: number }>;
    rates: DepartmentRate[];
  }>> => {
    return wrap(async () => {
      const session = getSession(args.token);
      if (!session) throw new Error('Session expired.');
      const db = getDb();

      const deptWhere = args.departmentId ? 'WHERE is_active = 1 AND id = ?' : 'WHERE is_active = 1';
      const deptParams = args.departmentId ? [args.departmentId] : [];
      const departments = all<any>(db, `SELECT id, name, code FROM departments ${deptWhere} ORDER BY sort_order, name`, ...deptParams);
      const work_types = all<any>(db, 'SELECT id, name, code FROM work_types WHERE is_active = 1 ORDER BY name');
      const categories = all<any>(db, 'SELECT id, name, code, sort_order FROM brick_categories WHERE is_active = 1 ORDER BY sort_order, name');
      const ratesRows = all<any>(
        db,
        `${RATE_SELECT} ${args.departmentId ? 'WHERE dr.department_id = ?' : ''} ORDER BY d.name, wt.name, bc.sort_order`,
        ...(args.departmentId ? [args.departmentId] : [])
      );
      return {
        departments,
        work_types,
        categories,
        rates: ratesRows.map(rowToRate),
      };
    })();
  });
}
