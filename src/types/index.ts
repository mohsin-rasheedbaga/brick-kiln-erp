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
  mustChangePassword: boolean;
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
