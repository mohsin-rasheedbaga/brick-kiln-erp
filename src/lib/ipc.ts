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
  // Phase 2 types
  Batch, Customer, CustomerLedger, SalesInvoice, SalesInvoiceItem,
  CustomerPayment, Expense, ExpenseCategory,
  WorkerAdvance, WorkerPayment, CashMovement, CashBalance, DashboardStats,
  // Phase 3 types
  StockBalance, StockMovement as StockMovementType,
  // Phase 4 types
  DepartmentRate, WorkerFamily, WorkerAccountSummary,
  // Phase A types
  DailyProductionSummary,
  // Phase B types
  PayrollRun, PayrollRunItem,
  // Phase v2.0.0 types
  Investor, InvestorTransaction,
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

  // Build the first argument for ipcMain.handle.
  //
  // All IPC handlers across this app use the signature:
  //   ipcMain.handle('channel', async (evt, args) => { ... args.token ... })
  // i.e. they expect a SINGLE object parameter containing `token` and any
  // additional fields (search, id, etc.). We must therefore MERGE the token
  // into the first argument object — NOT prepend it as a separate argument.
  //
  // Special case: for auth:login we don't have a token yet (it's null),
  // but we still pass `token: null` so the handler signature stays consistent.
  // The auth:login handler ignores args.token and only reads username/password.
  let firstArg: any;
  if (args.length === 0) {
    firstArg = { token };
  } else if (typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
    // Most common case: merge token into the existing args object
    firstArg = { ...args[0], token };
  } else {
    // First arg is a primitive (string/number) — wrap it with token
    firstArg = { token, value: args[0] };
  }

  const restArgs = args.slice(1);
  const result = await window.erp.invoke(channel, firstArg, ...restArgs);
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
    rate_per_1000?: number; employment_type?: 'piece_rate' | 'salary';
    monthly_salary?: number; allowed_leaves?: number; notes?: string;
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
  create: (data: { name: string; code: string; description?: string; defaultSellingRate?: number; minSellingRate?: number; maxSellingRate?: number; sortOrder?: number }) =>
    call<BrickCategory>('brick-categories:create', data),
  update: (id: string, changes: Partial<BrickCategory> & { minSellingRate?: number; maxSellingRate?: number }) =>
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
    custom_permissions?: string[];
  }) => call<User>('users:create', data),
  update: (id: string, changes: {
    full_name?: string;
    email?: string;
    phone?: string;
    role_id?: string;
    department_id?: string;
    must_change_password?: boolean;
    custom_permissions?: string[];
  }) => call<User>('users:update', { id, ...changes }),
  setActive: (id: string, active: boolean) =>
    call<{ success: true }>('users:set-active', { id, active }),
  resetPassword: (id: string, newPassword: string, mustChange = true) =>
    call<{ success: true }>('users:reset-password', { id, newPassword, mustChange }),
  delete: (id: string) => call<{ success: true }>('users:delete', { id }),
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

// =================== Phase 2 APIs ===================

// Batches
export const batches = {
  list: (filters: { status?: string; kilnId?: string; search?: string; limit?: number; offset?: number } = {}) =>
    call<{ items: Batch[]; total: number }>('batches:list', filters),
  get: (id: string) => call<Batch | null>('batches:get', { id }),
  create: (data: { kilnId?: string; startDate?: string; notes?: string }) =>
    call<Batch>('batches:create', data),
  update: (id: string, changes: {
    kilnId?: string | null;
    startDate?: string;
    endDate?: string | null;
    notes?: string;
    fuelCost?: number;
    otherCost?: number;
    brokenQuantity?: number;
  }) => call<Batch>('batches:update', { id, ...changes }),
  setStatus: (id: string, status: string, endDate?: string) =>
    call<{ success: true }>('batches:set-status', { id, status, endDate }),
  delete: (id: string) => call<{ success: true }>('batches:delete', { id }),
  costSummary: (id: string) =>
    call<{ batch: Batch; production_by_stage: any[]; expense_breakdown: any[]; sales_count: number; sales_total: number }>('batches:cost-summary', { id }),
};

// Customers
export const customers = {
  list: (filters: { search?: string; includeInactive?: boolean; limit?: number; offset?: number } = {}) =>
    call<{ items: Customer[]; total: number }>('customers:list', filters),
  get: (id: string) => call<Customer | null>('customers:get', { id }),
  create: (data: {
    name: string; mobile?: string; phone?: string; address?: string;
    cnic?: string; openingBalance?: number; creditLimit?: number; notes?: string;
  }) => call<Customer>('customers:create', data),
  update: (id: string, changes: Partial<Customer>) =>
    call<Customer>('customers:update', { id, ...changes }),
  setActive: (id: string, active: boolean) =>
    call<{ success: true }>('customers:set-active', { id, active }),
  delete: (id: string) => call<{ success: true }>('customers:delete', { id }),
  ledger: (id: string, from?: string, to?: string) =>
    call<CustomerLedger>('customers:ledger', { id, from, to }),
  lookupByCode: (code: string) => call<Customer | null>('customers:lookup-by-code', { code }),
};

// Sales invoices
export const sales = {
  list: (filters: {
    customerId?: string; batchId?: string; status?: string;
    from?: string; to?: string; search?: string; includeVoid?: boolean;
    limit?: number; offset?: number;
  } = {}) => call<{ items: SalesInvoice[]; total: number }>('sales:list', filters),
  get: (id: string) => call<SalesInvoice | null>('sales:get', { id }),
  create: (data: {
    date?: string; customerId: string; batchId?: string;
    items: Array<{ category_id: string; quantity: number; rate: number }>;
    discount?: number; paid?: number; paymentMethod?: string; notes?: string;
  }) => call<SalesInvoice>('sales:create', data),
  void: (id: string, reason: string) => call<{ success: true }>('sales:void', { id, reason }),
};

// Customer payments
export const customerPayments = {
  list: (filters: {
    customerId?: string; invoiceId?: string; from?: string; to?: string;
    search?: string; includeVoid?: boolean; limit?: number; offset?: number;
  } = {}) => call<{ items: CustomerPayment[]; total: number }>('customer-payments:list', filters),
  create: (data: {
    date?: string; customerId: string; invoiceId?: string; amount: number;
    paymentMethod?: string; referenceNo?: string; notes?: string;
  }) => call<CustomerPayment>('customer-payments:create', data),
  void: (id: string, reason: string) => call<{ success: true }>('customer-payments:void', { id, reason }),
};

// Expenses
export const expenses = {
  list: (filters: {
    categoryId?: string; departmentId?: string; batchId?: string;
    from?: string; to?: string; search?: string; includeVoid?: boolean;
    limit?: number; offset?: number;
  } = {}) => call<{ items: Expense[]; total: number; totalAmount: number }>('expenses:list', filters),
  create: (data: {
    date?: string; categoryId: string; departmentId?: string; batchId?: string;
    amount: number; paymentMethod?: string; referenceNo?: string;
    paidTo?: string; description?: string;
  }) => call<Expense>('expenses:create', data),
  void: (id: string, reason: string) => call<{ success: true }>('expenses:void', { id, reason }),
};

// Expense categories
export const expenseCategories = {
  list: (includeInactive = false) => call<ExpenseCategory[]>('expense-categories:list', { includeInactive }),
  create: (data: { name: string; code: string; description?: string }) =>
    call<ExpenseCategory>('expense-categories:create', data),
  setActive: (id: string, active: boolean) =>
    call<{ success: true }>('expense-categories:set-active', { id, active }),
};

// Worker advances
export const workerAdvances = {
  list: (filters: { workerId?: string; from?: string; to?: string; includeVoid?: boolean; limit?: number; offset?: number } = {}) =>
    call<{ items: WorkerAdvance[]; total: number; totalAmount: number }>('worker-advances:list', filters),
  create: (data: {
    date?: string; workerId: string; amount: number;
    paymentMethod?: string; referenceNo?: string; description?: string;
  }) => call<WorkerAdvance>('worker-advances:create', data),
  void: (id: string, reason: string) => call<{ success: true }>('worker-advances:void', { id, reason }),
};

// Worker payments
export const workerPayments = {
  list: (filters: { workerId?: string; from?: string; to?: string; includeVoid?: boolean; limit?: number; offset?: number } = {}) =>
    call<{ items: WorkerPayment[]; total: number; totalAmount: number }>('worker-payments:list', filters),
  create: (data: {
    date?: string; workerId: string; amount: number;
    paymentMethod?: string; referenceNo?: string; description?: string;
  }) => call<WorkerPayment>('worker-payments:create', data),
  void: (id: string, reason: string) => call<{ success: true }>('worker-payments:void', { id, reason }),
};

// Cash register
export const cash = {
  balance: (asOf?: string) => call<CashBalance>('cash:balance', { asOf }),
  movements: (filters: { movementType?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) =>
    call<{ items: CashMovement[]; total: number; runningBalance: number }>('cash:movements', filters),
  adjustment: (data: {
    date?: string;
    movementType: 'opening' | 'income_in' | 'adjustment_in' | 'adjustment_out' | 'transfer';
    amount: number;
    description: string;
  }) => call<CashMovement>('cash:adjustment', data),
};

// Dashboard
export const dashboard = {
  stats: () => call<DashboardStats>('dashboard:stats'),
};

// =================== Phase 3 APIs ===================

// Stock adjustments
export const stock = {
  balance: (includeInactive = false) => call<StockBalance[]>('stock:balance', { includeInactive }),
  movements: (filters: { categoryId?: string; movementType?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) =>
    call<{ items: StockMovementType[]; total: number }>('stock:movements', filters),
  adjustment: (data: {
    date?: string;
    categoryId: string;
    direction: 'in' | 'out';
    quantity: number;
    reason: string;
    batchId?: string;
    notes?: string;
  }) => call<StockMovementType>('stock:adjustment', data),
  adjustmentsList: (filters: { categoryId?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) =>
    call<{ items: StockMovementType[]; total: number }>('stock:adjustments:list', filters),
};

// Reports
export const reports = {
  production: (filters: { from?: string; to?: string; stage?: string; workerId?: string; departmentId?: string; batchId?: string; groupBy?: 'stage' | 'worker' | 'department' | 'day' } = {}) =>
    call<{ summary: any; rows: any[]; entries: any[] }>('reports:production', filters),
  sales: (filters: { from?: string; to?: string; customerId?: string; batchId?: string; status?: string; groupBy?: 'customer' | 'day' | 'status' } = {}) =>
    call<{ summary: any; rows: any[]; invoices: any[] }>('reports:sales', filters),
  expenses: (filters: { from?: string; to?: string; categoryId?: string; departmentId?: string; batchId?: string; groupBy?: 'category' | 'department' | 'batch' | 'day' } = {}) =>
    call<{ summary: any; rows: any[]; expenses: any[] }>('reports:expenses', filters),
  customers: (includeInactive = false) =>
    call<{ summary: any; customers: any[] }>('reports:customers', { includeInactive }),
  workers: (filters: { from?: string; to?: string; departmentId?: string; workerId?: string } = {}) =>
    call<{ summary: any; workers: any[] }>('reports:workers', filters),
  batchCosting: (filters: { batchId?: string; status?: string } = {}) =>
    call<{ summary: any; batches: any[] }>('reports:batch-costing', filters),
  profitLoss: (filters: { from?: string; to?: string } = {}) =>
    call<{ revenue: any; costs: any; profit_loss: number; margin_pct: number }>('reports:profit-loss', filters),
  cashFlow: (filters: { from?: string; to?: string } = {}) =>
    call<{ summary: any; by_type: any[]; movements: any[] }>('reports:cash-flow', filters),
  stock: (filters: { from?: string; to?: string; categoryId?: string } = {}) =>
    call<{ summary: any; categories: any[]; movements_summary: any[] }>('reports:stock', filters),
};

// =================== Phase 4 APIs ===================

// Department rates
export const departmentRates = {
  list: (filters: { departmentId?: string; workTypeId?: string; brickCategoryId?: string | null; includeInactive?: boolean } = {}) =>
    call<DepartmentRate[]>('department-rates:list', filters),
  getByContext: (departmentId: string, workTypeId: string, brickCategoryId?: string) =>
    call<{ rate_per_1000: number; source: string; rate_id: string | null }>('department-rates:get-by-context', { departmentId, workTypeId, brickCategoryId }),
  upsert: (data: {
    departmentId: string;
    workTypeId: string;
    brickCategoryId?: string | null;
    ratePer1000: number;
    notes?: string;
  }) => call<DepartmentRate>('department-rates:upsert', data),
  delete: (id: string) => call<{ success: true }>('department-rates:delete', { id }),
  matrix: (departmentId?: string) =>
    call<{ departments: any[]; work_types: any[]; categories: any[]; rates: DepartmentRate[] }>('department-rates:matrix', { departmentId }),
};

// Worker family + account summary (Phase 4 additions to workers)
export const workerFamily = {
  get: (workerId: string) => call<WorkerFamily | null>('workers:get-family', { workerId }),
  set: (workerId: string, data: {
    familyNumber?: string;
    familyContactName?: string;
    relation?: string;
    altNumber?: string;
  }) => call<{ success: true }>('workers:set-family', { workerId, ...data }),
};

export const workerAccount = {
  summary: (workerId: string) => call<WorkerAccountSummary>('workers:account-summary', { workerId }),
};

// =================== Phase A APIs ===================

// Daily production summary (today or any date)
export const dailySummary = {
  get: (date?: string) => call<DailyProductionSummary>('reports:daily-summary', { date }),
};

// =================== Phase B APIs (Payroll) ===================

export const payroll = {
  createRun: (data: {
    cycleType: 'weekly' | 'monthly' | 'daily' | 'custom';
    periodStart: string;
    periodEnd: string;
    paymentMethod?: string;
    departmentId?: string;
    cycleFilter?: 'weekly' | 'monthly' | 'daily' | 'all';
    notes?: string;
  }) => call<PayrollRun>('payroll:create-run', data),
  getRun: (id: string) => call<{ run: PayrollRun; items: PayrollRunItem[] }>('payroll:get-run', { id }),
  listRuns: (filters: { status?: string; cycleType?: string; limit?: number; offset?: number } = {}) =>
    call<{ items: PayrollRun[]; total: number }>('payroll:list-runs', filters),
  updateItem: (itemId: string, changes: {
    paymentAmount?: number;
    isSelected?: boolean;
    notes?: string;
  }) => call<{ success: true }>('payroll:update-item', { itemId, ...changes }),
  postRun: (id: string) => call<{ posted_count: number; total_paid: number }>('payroll:post-run', { id }),
  voidRun: (id: string, reason: string) => call<{ success: true; voided_count: number }>('payroll:void-run', { id, reason }),
  deleteRun: (id: string) => call<{ success: true }>('payroll:delete-run', { id }),
  setWorkerCycle: (workerId: string, cycle: 'weekly' | 'monthly' | 'daily', dailyWage?: number) =>
    call<{ success: true }>('payroll:set-worker-cycle', { workerId, cycle, dailyWage }),
};

// =================== Phase C APIs (Cloud Sync) ===================

export const cloud = {
  status: () => call<{
    supabase: { enabled: boolean; url: string | null; lastSync: string | null };
    gdrive: { configured: boolean; connected: boolean; email: string | null; autoBackup: boolean; lastBackup: string | null };
  }>('cloud:status'),
  supabase: {
    configure: (data: { enabled: boolean; url?: string; anonKey?: string }) =>
      call<{ success: true }>('cloud:supabase-configure', data),
    test: () => call<{ success: boolean; message: string }>('cloud:supabase-test'),
    sync: () => call<{
      success: boolean; total_pushed: number; total_pulled: number; errors: string[]; results: any[];
    }>('cloud:supabase-sync'),
    syncStatus: () => call<any[]>('cloud:supabase-sync-status'),
  },
  gdrive: {
    setConfig: (data: { clientId?: string; clientSecret?: string; folderId?: string; autoBackup?: boolean }) =>
      call<{ success: true }>('cloud:gdrive-set-config', data),
    authUrl: () => call<{ url: string; error?: string }>('cloud:gdrive-auth-url'),
    exchangeCode: (code: string) => call<{ success: boolean; email?: string; error?: string }>('cloud:gdrive-exchange-code', { code }),
    disconnect: () => call<{ success: true }>('cloud:gdrive-disconnect'),
    status: () => call<any>('cloud:gdrive-status'),
    backup: () => call<{
      success: boolean; fileId?: string; fileLink?: string; fileName?: string; fileSize?: number; error?: string;
    }>('cloud:gdrive-backup'),
    listBackups: () => call<any[]>('cloud:gdrive-list-backups'),
    openLink: (url: string) => call<{ success: true }>('cloud:open-link', { url }),
  },
};

// =================== Phase v2.0.0 APIs (Investors) ===================

export const investors = {
  list: (filters: { search?: string; includeInactive?: boolean } = {}) =>
    call<Investor[]>('investors:list', filters),
  get: (id: string) => call<{ investor: Investor; transactions: InvestorTransaction[] }>('investors:get', { id }),
  create: (data: {
    name: string; mobile?: string; address?: string; cnic?: string;
    profit_share_pct?: number; initial_investment?: number; notes?: string;
  }) => call<Investor>('investors:create', data),
  update: (id: string, changes: any) => call<Investor>('investors:update', { id, ...changes }),
  setStatus: (id: string, status: string) => call<{ success: true }>('investors:set-status', { id, status }),
  delete: (id: string) => call<{ success: true }>('investors:delete', { id }),
  addTransaction: (data: {
    investorId: string; type: 'investment_in' | 'profit_paid' | 'capital_withdraw' | 'adjustment';
    amount: number; date?: string; paymentMethod?: string; referenceNo?: string; description?: string;
  }) => call<InvestorTransaction>('investors:add-transaction', data),
  monthlyProfit: (month: string) => call<{
    total_monthly_profit: number;
    investors: Array<{ id: string; name: string; investor_code: string; profit_share_pct: number; profit_amount: number; current_balance: number }>;
  }>('investors:monthly-profit', { month }),
};

// =================== Phase v2.1.0 APIs (Withdraw) ===================

export const withdraw = {
  earnings: (data: {
    workerId: string;
    payAmount: number;
    deductFromAdvance: boolean;
    deductionAmount: number;
    description?: string;
  }) => call<{
    payment_number: string;
    advance_number: string | null;
    payAmount: number;
    deductionAmount: number;
    newBalance: number;
  }>('workers:withdraw-earnings', data),
  weeklySummary: (workerId: string) => call<{
    earned_this_week: number;
    advances_this_week: number;
    payments_this_week: number;
    total_earned: number;
    total_advances: number;
    total_payments: number;
    balance: number;
    week_start: string;
    week_end: string;
  }>('workers:weekly-summary', { workerId }),
};

// =================== Phase v2.2.0 APIs (Production Cost Report) ===================

export const productionCostReport = {
  get: (from: string, to: string) => call<any>('reports:production-cost', { from, to }),
};
