/**
 * Type definitions for IPC results.
 * Mirror the structure returned by the main process.
 */

export interface IpcSuccess<T = any> {
  ok: true;
  data: T;
}
export interface IpcError {
  ok: false;
  error: { code: string; message: string; details?: any };
}
export type IpcResult<T = any> = IpcSuccess<T> | IpcError;

declare global {
  interface Window {
    erp: {
      invoke: (channel: string, ...args: any[]) => Promise<any>;
      on: (channel: string, callback: (data: any) => void) => (() => void);
      info: {
        platform: string;
        versions: { electron: string; chrome: string; node: string };
      };
    };
  }
}

// Domain types
export interface User {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  roleId: string;
  roleName: string;
  departmentId?: string;
  departmentName?: string;
  mustChangePassword: boolean;
  isActive?: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  permissions: string[];
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
}

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
  payroll_cycle?: 'weekly' | 'monthly' | 'daily';
  daily_wage?: number;
  employment_type?: 'piece_rate' | 'salary';
  monthly_salary?: number;
  allowed_leaves?: number;
  created_at: string;
  updated_at: string;
}

export interface WorkType {
  id: string;
  name: string;
  code: string;
  department_id: string | null;
  default_rate_per_1000: number;
  description: string | null;
  is_active: boolean;
}

export interface BrickCategory {
  id: string;
  name: string;
  code: string;
  description: string | null;
  default_selling_rate: number;
  is_active: boolean;
  sort_order: number;
  current_stock?: number;
}

export interface Kiln {
  id: string;
  name: string;
  code: string;
  capacity: number | null;
  status: string;
  notes: string | null;
  is_active: boolean;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  user_count?: number;
  userCount?: number;
  permission_codes?: string[];
}

export interface Permission {
  id: string;
  code: string;
  name: string;
  module: string;
  description: string | null;
}

export interface Settings {
  kiln_name: string;
  address: string;
  phone: string;
  email: string | null;
  currency: string;
  currency_symbol: string;
  date_format: string;
  timezone: string;
  logo_path: string | null;
  allow_negative_stock: boolean;
  allow_overpayment: boolean;
  auto_logout_minutes: number;
  auto_backup_enabled: boolean;
  auto_backup_interval_hours: number;
  backup_location: string | null;
  auto_update_enabled: boolean;
  update_channel: string;
  last_update_check: string | null;
  app_version: string;
  schema_version: string;
}

export interface ProductionEntry {
  id: string;
  stage: string;
  date: string;
  batch_id: string | null;
  batch_number?: string;
  kiln_id: string | null;
  kiln_name?: string;
  worker_id: string;
  worker_name?: string;
  worker_code?: string;
  department_id: string;
  department_name?: string;
  work_type_id: string;
  work_type_name?: string;
  quantity: number;
  rate_per_1000: number;
  labour_amount: number;
  transport_method: string | null;
  notes: string | null;
  entered_by: string;
  entered_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkerLedger {
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
  advances: Array<{ id: string; date: string; amount: number; description: string | null; }>;
  payments: Array<{ id: string; date: string; amount: number; description: string | null; }>;
  totals: {
    total_production_quantity: number;
    total_labour_earned: number;
    total_advances: number;
    total_payments: number;
    remaining_balance: number;
  };
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  user_id: string | null;
  username: string | null;
  action: string;
  module: string | null;
  entity_id: string | null;
  entity_type: string | null;
  description: string | null;
}

export interface BackupRecord {
  id: number;
  backup_date: string;
  file_path: string;
  file_size_bytes: number | null;
  backup_type: string;
  initiated_by: string | null;
  status: string;
  notes: string | null;
}

// ============== Phase 2 types ==============

export interface Batch {
  id: string;
  batch_number: string;
  kiln_id: string | null;
  kiln_name?: string;
  start_date: string;
  end_date: string | null;
  status: 'open' | 'firing' | 'completed' | 'closed' | 'cancelled';
  notes: string | null;
  labour_cost: number;
  fuel_cost: number;
  transport_cost: number;
  other_cost: number;
  total_cost: number;
  raw_bricks_loaded: number;
  baked_bricks_unloaded: number;
  broken_quantity: number;
  sales_revenue: number;
  profit_loss: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  customer_code: string;
  name: string;
  mobile: string | null;
  phone: string | null;
  address: string | null;
  cnic: string | null;
  opening_balance: number;
  credit_limit: number | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  total_sales?: number;
  total_paid?: number;
  current_balance?: number;
}

export interface CustomerLedger {
  customer: Customer;
  invoices: Array<{
    id: string;
    invoice_number: string;
    date: string;
    subtotal: number;
    discount: number;
    total: number;
    paid: number;
    remaining: number;
    payment_status: string;
    is_void: boolean;
  }>;
  payments: Array<{
    id: string;
    receipt_number: string;
    date: string;
    amount: number;
    payment_method: string;
    reference_no: string | null;
  }>;
  totals: {
    opening_balance: number;
    total_sales: number;
    total_paid: number;
    current_balance: number;
  };
}

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

export interface CustomerPayment {
  id: string;
  receipt_number: string;
  date: string;
  customer_id: string;
  customer_name?: string;
  customer_code?: string;
  invoice_id: string | null;
  invoice_number?: string;
  amount: number;
  payment_method: 'cash' | 'bank' | 'cheque' | 'other';
  reference_no: string | null;
  received_by: string;
  received_by_name?: string;
  notes: string | null;
  is_void: boolean;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
}

export interface Expense {
  id: string;
  expense_number: string;
  date: string;
  category_id: string;
  category_name?: string;
  department_id: string | null;
  department_name?: string;
  batch_id: string | null;
  batch_number?: string;
  amount: number;
  payment_method: 'cash' | 'bank' | 'cheque' | 'credit' | 'other';
  reference_no: string | null;
  paid_to: string | null;
  paid_by: string;
  paid_by_name?: string;
  description: string | null;
  is_void: boolean;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_at: string;
}

export interface WorkerAdvance {
  id: string;
  advance_number: string;
  date: string;
  worker_id: string;
  worker_name?: string;
  worker_code?: string;
  amount: number;
  payment_method: 'cash' | 'bank' | 'cheque' | 'other';
  reference_no: string | null;
  description: string | null;
  given_by: string;
  given_by_name?: string;
  is_void: boolean;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_at: string;
}

export interface WorkerPayment {
  id: string;
  payment_number: string;
  date: string;
  worker_id: string;
  worker_name?: string;
  worker_code?: string;
  amount: number;
  payment_method: 'cash' | 'bank' | 'cheque' | 'other';
  reference_no: string | null;
  description: string | null;
  paid_by: string;
  paid_by_name?: string;
  is_void: boolean;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: string | null;
  created_at: string;
}

export interface CashMovement {
  id: string;
  date: string;
  movement_type: string;
  amount: number;
  reference_type: string | null;
  reference_id: string | null;
  description: string | null;
  entered_by: string | null;
  entered_by_name?: string;
  created_at: string;
}

export interface CashBalance {
  balance: number;
  total_in: number;
  total_out: number;
  movements_count: number;
}

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

// ============== Phase 3 types ==============

export interface StockBalance {
  category_id: string;
  category_name: string;
  category_code: string;
  quantity: number;
  default_selling_rate: number;
  is_active: boolean;
}

export interface StockMovement {
  id: string;
  date: string;
  category_id: string;
  category_name?: string;
  movement_type: string;
  quantity: number;
  reference_type: string | null;
  reference_id: string | null;
  batch_id: string | null;
  batch_number?: string;
  notes: string | null;
  entered_by: string;
  entered_by_name?: string;
  created_at: string;
}

// ============== Phase 4 types ==============

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

export interface WorkerFamily {
  family_number: string | null;
  family_contact_name: string | null;
  relation: string | null;
  alt_number: string | null;
}

export interface WorkerAccountSummary {
  worker: Worker;
  family: WorkerFamily | null;
  earned: number;
  advances_total: number;
  payments_total: number;
  balance: number;
  last_activity_date: string | null;
  last_advance_amount: number;
  last_advance_date: string | null;
  last_payment_amount: number;
  last_payment_date: string | null;
  total_production_qty: number;
}

// ============== Phase A (v1.4.0) types ==============

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
  stock_snapshot: Array<{
    category_id: string;
    category_name: string;
    quantity: number;
  }>;
  active_batches: number;
  firing_batches: number;
  by_department: Array<{
    department_id: string;
    department_name: string;
    total_qty: number;
    total_labour: number;
    entries_count: number;
  }>;
}

// ============== Phase B (v1.5.0) types ==============

export interface PayrollRun {
  id: string;
  run_number: string;
  cycle_type: 'weekly' | 'monthly' | 'daily' | 'custom';
  period_start: string;
  period_end: string;
  status: 'draft' | 'posted' | 'void';
  total_earned: number;
  total_advances: number;
  total_previous_balance: number;
  total_net_payable: number;
  total_paid: number;
  workers_count: number;
  payment_method: string;
  notes: string | null;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  posted_at: string | null;
  posted_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}

export interface PayrollRunItem {
  id: string;
  run_id: string;
  worker_id: string;
  worker_code?: string;
  worker_name?: string;
  department_name?: string;
  payroll_cycle?: string;
  days_worked: number;
  total_qty: number;
  earned_in_period: number;
  advances_in_period: number;
  previous_balance: number;
  net_payable: number;
  payment_amount: number;
  is_selected: boolean;
  notes: string | null;
  worker_payment_id: string | null;
  payment_number?: string;
}

// ============== Phase v2.0.0 types ==============

export interface Investor {
  id: string;
  investor_code: string;
  name: string;
  mobile: string | null;
  address: string | null;
  cnic: string | null;
  joining_date: string;
  total_investment: number;
  profit_share_pct: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  current_balance?: number;
  total_profit_paid?: number;
}

export interface InvestorTransaction {
  id: string;
  transaction_number: string;
  date: string;
  investor_id: string;
  type: 'investment_in' | 'profit_paid' | 'capital_withdraw' | 'adjustment';
  amount: number;
  reference_no: string | null;
  payment_method: string;
  description: string | null;
  is_void: boolean;
  created_at: string;
}
