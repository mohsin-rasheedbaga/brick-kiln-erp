/**
 * IPC client - thin wrapper around window.erp.invoke.
 *
 * Every call:
 *  1. Adds the current session token (auto-injected from auth store)
 *  2. Unwraps the IpcResult, throwing on error
 *
 * Usage:
 *   const workers = await ipc.workers.list({ search: 'ali' });
 */

import type {
  Department, Worker, WorkType, BrickCategory, Kiln,
  Role, Permission, Settings, ProductionEntry, WorkerLedger,
  AuditLogEntry, BackupRecord, User,
} from '../types';

const TOKEN_KEY = 'brick-kiln-erp-token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

async function call<T>(channel: string, ...args: any[]): Promise<T> {
  const token = getToken();
  // Inject token at the front of args (most handlers expect it)
  const fullArgs = [token, ...args];
  const result = await window.erp.invoke(channel, ...fullArgs);
  if (!result || typeof result !== 'object') {
    throw new Error('Invalid IPC response');
  }
  if (result.ok === false) {
    const errMsg = result.error?.message || 'Unknown error';
    const err = new Error(errMsg) as Error & { code?: string };
    err.code = result.error?.code;
    throw err;
  }
  return result.data as T;
}

// Auth API
export const auth = {
  login: (username: string, password: string) =>
    call<{ token: string; user: User }>('auth:login', { username, password }),
  logout: () => call<{ success: true }>('auth:logout'),
  me: () => call<User | null>('auth:me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<{ success: true }>('auth:change-password', { currentPassword, newPassword }),
  hasPermission: (permission: string) => call<boolean>('auth:check-permission', { permission }),
  hasAnyPermission: (permissions: string[]) => call<boolean>('auth:has-any-permission', { permissions }),
};

// Departments API
export const departments = {
  list: (includeInactive = false) => call<Department[]>('departments:list', { includeInactive }),
  get: (id: string) => call<Department | null>('departments:get', { id }),
  create: (data: { name: string; code: string; description?: string; sortOrder?: number }) =>
    call<Department>('departments:create', data),
  update: (id: string, changes: Partial<Department>) =>
    call<Department>('departments:update', { id, ...changes }),
  setActive: (id: string, active: boolean) =>
    call<{ success: true }>('departments:set-active', { id, active }),
  delete: (id: string) => call<{ success: true }>('departments:delete', { id }),
};

// Workers API
export const workers = {
  list: (filters: { search?: string; departmentId?: string; status?: string; limit?: number; offset?: number } = {}) =>
    call<{ items: Worker[]; total: number }>('workers:list', filters),
  get: (id: string) => call<Worker | null>('workers:get', { id }),
  create: (data: {
    full_name: string; father_name?: string; mobile?: string; address?: string;
    cnic?: string; joining_date?: string; department_id: string; work_type_id?: string;
    rate_per_1000?: number; notes?: string;
  }) => call<Worker>('workers:create', data),
  update: (id: string, changes: Partial<Worker>) =>
    call<Worker>('workers:update', { id, ...changes }),
  setStatus: (id: string, status: 'active' | 'inactive' | 'left') =>
    call<{ success: true }>('workers:set-status', { id, status }),
  delete: (id: string) => call<{ success: true }>('workers:delete', { id }),
  ledger: (id: string, from?: string, to?: string) =>
    call<WorkerLedger>('workers:ledger', { id, from, to }),
  lookupByCode: (code: string) => call<Worker | null>('workers:lookup-by-code', { code }),
};

// Work types
export const workTypes = {
  list: (includeInactive = false) => call<WorkType[]>('work-types:list', { includeInactive }),
  create: (data: { name: string; code: string; departmentId?: string; defaultRatePer1000?: number; description?: string }) =>
    call<WorkType>('work-types:create', data),
  update: (id: string, changes: Partial<WorkType>) =>
    call<WorkType>('work-types:update', { id, ...changes }),
  setActive: (id: string, active: boolean) =>
    call<{ success: true }>('work-types:set-active', { id, active }),
};

// Brick categories
export const brickCategories = {
  list: (includeInactive = false, includeStock = false) =>
    call<BrickCategory[]>('brick-categories:list', { includeInactive, includeStock }),
  create: (data: { name: string; code: string; description?: string; defaultSellingRate?: number; sortOrder?: number }) =>
    call<BrickCategory>('brick-categories:create', data),
  update: (id: string, changes: Partial<BrickCategory>) =>
    call<BrickCategory>('brick-categories:update', { id, ...changes }),
  setActive: (id: string, active: boolean) =>
    call<{ success: true }>('brick-categories:set-active', { id, active }),
};

// Kilns
export const kilns = {
  list: (includeInactive = false) => call<Kiln[]>('kilns:list', { includeInactive }),
  get: (id: string) => call<Kiln | null>('kilns:get', { id }),
  create: (data: { name: string; code: string; capacity?: number; notes?: string }) =>
    call<Kiln>('kilns:create', data),
  update: (id: string, changes: Partial<Kiln>) =>
    call<Kiln>('kilns:update', { id, ...changes }),
  setStatus: (id: string, status: string) =>
    call<{ success: true }>('kilns:set-status', { id, status }),
};

// Users
export const users = {
  list: (search?: string, includeInactive = false) =>
    call<User[]>('users:list', { search, includeInactive }),
  get: (id: string) => call<User | null>('users:get', { id }),
  create: (data: {
    username: string; password: string; full_name: string; email?: string; phone?: string;
    role_id: string; department_id?: string; must_change_password?: boolean;
  }) => call<User>('users:create', data),
  update: (id: string, changes: Partial<User>) =>
    call<User>('users:update', { id, ...changes }),
  setActive: (id: string, active: boolean) =>
    call<{ success: true }>('users:set-active', { id, active }),
  resetPassword: (id: string, newPassword: string, mustChange = true) =>
    call<{ success: true }>('users:reset-password', { id, newPassword, mustChange }),
};

// Roles
export const roles = {
  list: (includeInactive = false) => call<Role[]>('roles:list', { includeInactive }),
  get: (id: string) => call<Role | null>('roles:get', { id }),
  listPermissions: () => call<Permission[]>('roles:list-permissions'),
  create: (data: { name: string; description?: string }) => call<Role>('roles:create', data),
  update: (id: string, changes: { name?: string; description?: string; isActive?: boolean }) =>
    call<Role>('roles:update', { id, ...changes }),
  delete: (id: string) => call<{ success: true }>('roles:delete', { id }),
  setPermissions: (roleId: string, permissionIds: string[]) =>
    call<{ success: true }>('roles:set-permissions', { roleId, permissionIds }),
};

// Settings
export const settings = {
  get: () => call<Settings>('settings:get'),
  update: (changes: Partial<Settings>) => call<Settings>('settings:update', { changes }),
};

// Production
export const production = {
  create: (data: {
    stage: string; date?: string; batchId?: string; kilnId?: string; workerId: string;
    departmentId: string; workTypeId: string; quantity: number; ratePer1000?: number;
    transportMethod?: string; notes?: string; categoryId?: string;
  }) => call<ProductionEntry>('production:create', data),
  list: (filters: {
    stage?: string; workerId?: string; departmentId?: string; batchId?: string;
    kilnId?: string; from?: string; to?: string; limit?: number; offset?: number;
  } = {}) => call<{ items: ProductionEntry[]; total: number }>('production:list', filters),
  update: (id: string, changes: any) => call<ProductionEntry>('production:update', { id, ...changes }),
  delete: (id: string) => call<{ success: true }>('production:delete', { id }),
};

// Audit log
export const audit = {
  list: (filters: { from?: string; to?: string; userId?: string; action?: string; module?: string; limit?: number; offset?: number } = {}) =>
    call<{ items: AuditLogEntry[]; total: number }>('audit:list', filters),
  stats: (days = 30) =>
    call<{ byAction: Array<{ action: string; count: number }>; byModule: Array<{ module: string; count: number }>; total: number }>('audit:stats', { days }),
};

// Backup
export const backup = {
  create: (note?: string) =>
    call<{ filePath: string; sizeBytes: number; backupId: number }>('backup:create', { note }),
  restore: (backupId: number) =>
    call<{ success: true; restartRequired: true }>('backup:restore', { backupId }),
  list: (limit = 50) => call<BackupRecord[]>('backup:list', { limit }),
  delete: (id: number, deleteFile = false) =>
    call<{ success: true }>('backup:delete', { id, deleteFile }),
};

// Updates
export const updates = {
  getInfo: () => call<{ currentVersion: string; autoUpdateEnabled: boolean; lastChecked: string | null; channel: string }>('update:get-info'),
  check: () => call<{ available: boolean; version?: string; releaseNotes?: string; releaseDate?: string }>('update:check'),
  download: () => call<{ started: true }>('update:download'),
  install: () => call<{ started: true }>('update:install'),
};
