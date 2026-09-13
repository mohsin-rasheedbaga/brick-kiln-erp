-- ============================================================
-- Brick Kiln ERP - Complete Database Schema
-- Version: 1.0.0
-- Engine: SQLite (better-sqlite3)
-- ============================================================
-- All money/decimal values stored as REAL (SQLite FLOAT)
-- All timestamps stored as ISO 8601 TEXT (UTC) for portability
-- All IDs use TEXT UUIDs for unique cross-table identification
-- ============================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
-- 1. SETTINGS (single-row configuration table)
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  kiln_name       TEXT NOT NULL DEFAULT 'My Brick Kiln',
  address         TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  email           TEXT,
  currency        TEXT NOT NULL DEFAULT 'PKR',
  currency_symbol TEXT NOT NULL DEFAULT 'Rs.',
  date_format     TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
  timezone        TEXT NOT NULL DEFAULT 'Asia/Karachi',
  logo_path       TEXT,
  allow_negative_stock     INTEGER NOT NULL DEFAULT 0,
  allow_overpayment        INTEGER NOT NULL DEFAULT 0,
  auto_logout_minutes      INTEGER NOT NULL DEFAULT 30,
  auto_backup_enabled      INTEGER NOT NULL DEFAULT 0,
  auto_backup_interval_hours INTEGER NOT NULL DEFAULT 24,
  backup_location          TEXT,
  auto_update_enabled      INTEGER NOT NULL DEFAULT 1,
  update_channel           TEXT NOT NULL DEFAULT 'latest',
  last_update_check       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Always ensure exactly one settings row exists
INSERT OR IGNORE INTO settings (id) VALUES (1);

-- ============================================================
-- 2. ROLES & PERMISSIONS (RBAC)
-- ============================================================
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,  -- system roles cannot be deleted
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,        -- e.g. 'workers.create'
  name        TEXT NOT NULL,
  module      TEXT NOT NULL,               -- e.g. 'workers', 'sales', 'accounts'
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- ============================================================
-- 3. USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  role_id       TEXT NOT NULL,
  department_id TEXT,                       -- nullable: admin/manager may not belong to single dept
  is_active     INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (role_id) REFERENCES roles(id),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);

-- ============================================================
-- 4. SESSIONS (active login tokens)
-- ============================================================
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ============================================================
-- 5. DEPARTMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS departments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  code        TEXT NOT NULL UNIQUE,        -- e.g. 'RAW', 'KILN', 'SALES'
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 6. WORKERS
-- ============================================================
CREATE TABLE IF NOT EXISTS workers (
  id              TEXT PRIMARY KEY,         -- UUID
  worker_code     TEXT NOT NULL UNIQUE,     -- e.g. 'WKR-0001' (human-readable)
  full_name       TEXT NOT NULL,
  father_name     TEXT,
  mobile          TEXT,
  address         TEXT,
  cnic            TEXT,                      -- Pakistan national ID
  joining_date    TEXT NOT NULL DEFAULT (date('now')),
  department_id   TEXT NOT NULL,
  work_type_id    TEXT,                      -- references work_types table
  rate_per_1000   REAL NOT NULL DEFAULT 0,
  custom_permissions TEXT,                   -- JSON array of permission codes (overrides role permissions if set)
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','inactive','left')),
  photo_path      TEXT,
  barcode         TEXT NOT NULL UNIQUE,     -- barcode string (numeric or alphanumeric)
  qr_token        TEXT NOT NULL UNIQUE,     -- token used inside QR (mapped to worker_id at scan)
  notes           TEXT,
  left_date       TEXT,
  employment_type TEXT NOT NULL DEFAULT 'piece_rate'
                    CHECK (employment_type IN ('piece_rate','salary')),
  monthly_salary  REAL NOT NULL DEFAULT 0,     -- fixed monthly salary (if employment_type='salary')
  allowed_leaves  INTEGER NOT NULL DEFAULT 4,  -- allowed leave days per month (salary workers)
  payroll_cycle   TEXT NOT NULL DEFAULT 'weekly'
                    CHECK (payroll_cycle IN ('weekly','monthly','daily')),
  daily_wage      REAL NOT NULL DEFAULT 0,       -- optional fixed daily wage (if not piece-rate)
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (work_type_id) REFERENCES work_types(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workers_department ON workers(department_id);
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);
CREATE INDEX IF NOT EXISTS idx_workers_barcode ON workers(barcode);
CREATE INDEX IF NOT EXISTS idx_workers_qr ON workers(qr_token);

-- ============================================================
-- 7. WORK TYPES & LABOUR RATES
-- ============================================================
CREATE TABLE IF NOT EXISTS work_types (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  code          TEXT NOT NULL UNIQUE,       -- e.g. 'RAW_BRICK', 'KILN_LOAD', 'UNLOAD'
  department_id TEXT,                        -- optional: typical dept for this work type
  default_rate_per_1000 REAL NOT NULL DEFAULT 0,
  description    TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
);

-- ============================================================
-- 7B. DEPARTMENT RATES (configurable per department × brick grade × work type)
-- ============================================================
CREATE TABLE IF NOT EXISTS department_rates (
  id                TEXT PRIMARY KEY,
  department_id     TEXT NOT NULL,
  work_type_id      TEXT NOT NULL,
  brick_category_id TEXT,                    -- nullable: if NULL, rate applies to all grades
  rate_per_1000     REAL NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  notes             TEXT,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (work_type_id) REFERENCES work_types(id) ON DELETE CASCADE,
  FOREIGN KEY (brick_category_id) REFERENCES brick_categories(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (department_id, work_type_id, brick_category_id)
);

CREATE INDEX IF NOT EXISTS idx_dept_rates_dept ON department_rates(department_id);
CREATE INDEX IF NOT EXISTS idx_dept_rates_work ON department_rates(work_type_id);

-- ============================================================
-- 7C. WORKER FAMILY CONTACT (Phase 4 addition)
-- ============================================================
CREATE TABLE IF NOT EXISTS worker_family (
  id              TEXT PRIMARY KEY,
  worker_id       TEXT NOT NULL UNIQUE,
  family_number   TEXT,                      -- emergency contact phone (gharana number)
  family_contact_name TEXT,                  -- name of the contact person
  relation        TEXT,                      -- e.g. 'Father', 'Brother', 'Spouse'
  alt_number      TEXT,                      -- alternative phone
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

-- ============================================================
-- 8. KILNS
-- ============================================================
CREATE TABLE IF NOT EXISTS kilns (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,         -- e.g. 'Kiln 01'
  code        TEXT NOT NULL UNIQUE,
  capacity    INTEGER,                      -- raw brick capacity
  status      TEXT NOT NULL DEFAULT 'empty'
                CHECK (status IN ('empty','loading','loaded','firing','ready','unloading','completed')),
  notes       TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 9. BRICK CATEGORIES (Grades)
-- ============================================================
CREATE TABLE IF NOT EXISTS brick_categories (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,       -- 'A Grade', 'B Grade', 'C Grade', 'Broken', 'Reject'
  code            TEXT NOT NULL UNIQUE,
  description     TEXT,
  default_selling_rate REAL NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 10. BATCHES
-- ============================================================
CREATE TABLE IF NOT EXISTS batches (
  id              TEXT PRIMARY KEY,
  batch_number    TEXT NOT NULL UNIQUE,        -- e.g. 'BATCH-2026-0001'
  kiln_id         TEXT,
  start_date      TEXT NOT NULL DEFAULT (date('now')),
  end_date        TEXT,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','firing','completed','closed','cancelled')),
  notes           TEXT,
  -- Cost aggregation columns (kept denormalized for performance; recomputed on every change)
  labour_cost     REAL NOT NULL DEFAULT 0,
  fuel_cost        REAL NOT NULL DEFAULT 0,
  transport_cost  REAL NOT NULL DEFAULT 0,
  other_cost      REAL NOT NULL DEFAULT 0,
  total_cost      REAL NOT NULL DEFAULT 0,
  -- Quantities tracked through batches
  raw_bricks_loaded     INTEGER NOT NULL DEFAULT 0,
  baked_bricks_unloaded INTEGER NOT NULL DEFAULT 0,
  broken_quantity       INTEGER NOT NULL DEFAULT 0,
  -- Sales rollup
  sales_revenue   REAL NOT NULL DEFAULT 0,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (kiln_id) REFERENCES kilns(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_kiln ON batches(kiln_id);

-- ============================================================
-- 11. PRODUCTION STAGES (unified transaction table)
-- ============================================================
-- Stores entries for: raw_brick_making, raw_brick_transport,
-- kiln_loading, baked_brick_unloading
CREATE TABLE IF NOT EXISTS production_entries (
  id              TEXT PRIMARY KEY,
  stage           TEXT NOT NULL
                    CHECK (stage IN ('raw_brick_making','raw_brick_transport','kiln_loading','baked_brick_unloading')),
  date            TEXT NOT NULL DEFAULT (date('now')),
  batch_id        TEXT,
  kiln_id         TEXT,
  worker_id       TEXT NOT NULL,
  department_id   TEXT NOT NULL,
  work_type_id    TEXT NOT NULL,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  rate_per_1000   REAL NOT NULL CHECK (rate_per_1000 >= 0),
  labour_amount   REAL NOT NULL DEFAULT 0,        -- computed: quantity/1000 * rate
  transport_method TEXT,                            -- only for raw_brick_transport
  notes           TEXT,
  entered_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL,
  FOREIGN KEY (kiln_id) REFERENCES kilns(id) ON DELETE SET NULL,
  FOREIGN KEY (worker_id) REFERENCES workers(id),
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (work_type_id) REFERENCES work_types(id),
  FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_production_stage ON production_entries(stage);
CREATE INDEX IF NOT EXISTS idx_production_date ON production_entries(date);
CREATE INDEX IF NOT EXISTS idx_production_worker ON production_entries(worker_id);
CREATE INDEX IF NOT EXISTS idx_production_batch ON production_entries(batch_id);
CREATE INDEX IF NOT EXISTS idx_production_department ON production_entries(department_id);

-- ============================================================
-- 12. STOCK (current on-hand by brick category)
-- ============================================================
CREATE TABLE IF NOT EXISTS stock (
  category_id     TEXT PRIMARY KEY,
  quantity        INTEGER NOT NULL DEFAULT 0,
  last_updated    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES brick_categories(id) ON DELETE CASCADE
);

-- Stock movements ledger (audit trail of every stock change)
CREATE TABLE IF NOT EXISTS stock_movements (
  id              TEXT PRIMARY KEY,
  date            TEXT NOT NULL DEFAULT (date('now')),
  category_id     TEXT NOT NULL,
  movement_type   TEXT NOT NULL
                    CHECK (movement_type IN ('production_in','sale_out','adjustment_in','adjustment_out','waste_out','transfer_in','transfer_out','opening')),
  quantity        INTEGER NOT NULL,         -- positive = in, negative = out
  reference_type  TEXT,                    -- 'sale', 'production', 'adjustment'
  reference_id    TEXT,                    -- FK to source record
  batch_id        TEXT,
  notes           TEXT,
  entered_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES brick_categories(id) ON DELETE RESTRICT,
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL,
  FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_mov_category ON stock_movements(category_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_date ON stock_movements(date);
CREATE INDEX IF NOT EXISTS idx_stock_mov_ref ON stock_movements(reference_type, reference_id);

-- ============================================================
-- 13. CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  customer_code   TEXT NOT NULL UNIQUE,    -- e.g. 'CUST-0001'
  name            TEXT NOT NULL,
  mobile          TEXT,
  phone           TEXT,
  address         TEXT,
  cnic            TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,  -- positive = customer owes us
  credit_limit    REAL,
  notes           TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile);

-- ============================================================
-- 14. SALES INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_invoices (
  id                TEXT PRIMARY KEY,
  invoice_number    TEXT NOT NULL UNIQUE,
  date              TEXT NOT NULL DEFAULT (date('now')),
  customer_id       TEXT NOT NULL,
  batch_id          TEXT,                   -- optional: which batch these bricks came from
  subtotal          REAL NOT NULL DEFAULT 0,
  discount          REAL NOT NULL DEFAULT 0,
  total             REAL NOT NULL DEFAULT 0,
  paid              REAL NOT NULL DEFAULT 0,
  remaining         REAL NOT NULL DEFAULT 0,
  payment_method    TEXT,                   -- 'cash', 'bank', 'cheque', 'credit'
  payment_status    TEXT NOT NULL DEFAULT 'unpaid'
                      CHECK (payment_status IN ('unpaid','partial','paid','overpaid')),
  sales_user_id     TEXT NOT NULL,
  notes             TEXT,
  is_void           INTEGER NOT NULL DEFAULT 0,
  void_reason       TEXT,
  voided_by         TEXT,
  voided_at         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL,
  FOREIGN KEY (sales_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_date ON sales_invoices(date);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales_invoices(payment_status);

-- Sales invoice line items (one invoice can have multiple brick categories)
CREATE TABLE IF NOT EXISTS sales_invoice_items (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL,
  category_id     TEXT NOT NULL,
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  rate            REAL NOT NULL CHECK (rate >= 0),
  amount          REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES brick_categories(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_items_invoice ON sales_invoice_items(invoice_id);

-- ============================================================
-- 15. CUSTOMER PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_payments (
  id              TEXT PRIMARY KEY,
  receipt_number  TEXT NOT NULL UNIQUE,
  date            TEXT NOT NULL DEFAULT (date('now')),
  customer_id     TEXT NOT NULL,
  invoice_id      TEXT,                      -- optional: against specific invoice
  amount          REAL NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL DEFAULT 'cash'
                    CHECK (payment_method IN ('cash','bank','cheque','other')),
  reference_no    TEXT,                     -- cheque no, transaction id, etc.
  received_by     TEXT NOT NULL,
  notes           TEXT,
  is_void         INTEGER NOT NULL DEFAULT 0,
  void_reason     TEXT,
  voided_by       TEXT,
  voided_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE SET NULL,
  FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cust_payments_customer ON customer_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_payments_date ON customer_payments(date);

-- ============================================================
-- 16. EXPENSE CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS expense_categories (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  code            TEXT NOT NULL UNIQUE,
  description     TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 17. EXPENSES
-- ============================================================
CREATE TABLE IF NOT EXISTS expenses (
  id              TEXT PRIMARY KEY,
  expense_number  TEXT NOT NULL UNIQUE,
  date            TEXT NOT NULL DEFAULT (date('now')),
  category_id     TEXT NOT NULL,
  department_id   TEXT,
  batch_id        TEXT,
  amount          REAL NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL DEFAULT 'cash'
                    CHECK (payment_method IN ('cash','bank','cheque','credit','other')),
  reference_no    TEXT,
  paid_to         TEXT,
  paid_by         TEXT,                     -- user who paid (entered by)
  description     TEXT,
  is_void         INTEGER NOT NULL DEFAULT 0,
  void_reason     TEXT,
  voided_by       TEXT,
  voided_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (batch_id) REFERENCES batches(id) ON DELETE SET NULL,
  FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_department ON expenses(department_id);
CREATE INDEX IF NOT EXISTS idx_expenses_batch ON expenses(batch_id);

-- ============================================================
-- 18. WORKER ADVANCES & PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS worker_advances (
  id              TEXT PRIMARY KEY,
  advance_number  TEXT NOT NULL UNIQUE,
  date            TEXT NOT NULL DEFAULT (date('now')),
  worker_id       TEXT NOT NULL,
  amount          REAL NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL DEFAULT 'cash'
                    CHECK (payment_method IN ('cash','bank','cheque','other')),
  reference_no    TEXT,
  description     TEXT,
  given_by         TEXT NOT NULL,
  is_void         INTEGER NOT NULL DEFAULT 0,
  void_reason     TEXT,
  voided_by       TEXT,
  voided_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (worker_id) REFERENCES workers(id),
  FOREIGN KEY (given_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_advances_worker ON worker_advances(worker_id);
CREATE INDEX IF NOT EXISTS idx_advances_date ON worker_advances(date);

CREATE TABLE IF NOT EXISTS worker_payments (
  id              TEXT PRIMARY KEY,
  payment_number  TEXT NOT NULL UNIQUE,
  date            TEXT NOT NULL DEFAULT (date('now')),
  worker_id       TEXT NOT NULL,
  amount          REAL NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL DEFAULT 'cash'
                    CHECK (payment_method IN ('cash','bank','cheque','other')),
  reference_no    TEXT,
  description     TEXT,
  paid_by         TEXT NOT NULL,
  is_void         INTEGER NOT NULL DEFAULT 0,
  void_reason     TEXT,
  voided_by       TEXT,
  voided_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (worker_id) REFERENCES workers(id),
  FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_worker ON worker_payments(worker_id);
CREATE INDEX IF NOT EXISTS idx_payments_date ON worker_payments(date);

-- ============================================================
-- 19. CASH REGISTER (cash movements ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS cash_movements (
  id              TEXT PRIMARY KEY,
  date            TEXT NOT NULL DEFAULT (datetime('now')),
  movement_type   TEXT NOT NULL
                    CHECK (movement_type IN ('opening','sale','customer_payment','expense_out','worker_payment_out','advance_out','income_in','adjustment_in','adjustment_out','transfer')),
  amount          REAL NOT NULL,           -- positive = cash in, negative = cash out
  reference_type  TEXT,
  reference_id    TEXT,
  description     TEXT,
  entered_by      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_movements(date);
CREATE INDEX IF NOT EXISTS idx_cash_type ON cash_movements(movement_type);

-- ============================================================
-- 20. AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
  user_id         TEXT,
  username        TEXT,                      -- denormalized for record stability
  action          TEXT NOT NULL,             -- 'login','logout','create','update','delete','void','backup','restore','settings_change'
  module          TEXT,                      -- 'workers','sales','expenses','settings', etc.
  entity_id       TEXT,
  entity_type     TEXT,
  description     TEXT,
  old_values       TEXT,                     -- JSON
  new_values       TEXT,                     -- JSON
  ip_address      TEXT,
  user_agent      TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_log(module);

-- ============================================================
-- 21. BACKUP HISTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS backup_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_date     TEXT NOT NULL DEFAULT (datetime('now')),
  file_path       TEXT NOT NULL,
  file_size_bytes INTEGER,
  backup_type     TEXT NOT NULL DEFAULT 'manual'
                    CHECK (backup_type IN ('manual','automatic','pre_restore')),
  initiated_by    TEXT,
  status          TEXT NOT NULL DEFAULT 'success'
                    CHECK (status IN ('success','failed','partial')),
  notes           TEXT,
  FOREIGN KEY (initiated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_backup_date ON backup_history(backup_date);

-- ============================================================
-- 22. SETTINGS HISTORY (track settings changes for audit)
-- ============================================================
CREATE TABLE IF NOT EXISTS settings_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  changed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  changed_by      TEXT,
  field_name      TEXT NOT NULL,
  old_value       TEXT,
  new_value       TEXT,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_settings_history ON settings_history(changed_at);

-- ============================================================
-- 23. APP META (versioning & migration tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS app_meta (
  key           TEXT PRIMARY KEY,
  value         TEXT,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema_version', '1.0.0');
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('app_version', '1.0.0');
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('installed_at', datetime('now'));
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('first_run', '1');

-- ============================================================
-- 24. PAYROLL RUNS (Phase B - v1.5.0)
-- ============================================================
-- A payroll run is a batch operation that calculates net payable for
-- multiple workers in one go, then optionally creates worker_payments
-- for each. The accountant can choose weekly or monthly cycle, and
-- can adjust each worker's payment before posting.
CREATE TABLE IF NOT EXISTS payroll_runs (
  id              TEXT PRIMARY KEY,
  run_number      TEXT NOT NULL UNIQUE,          -- e.g. 'PR-2026-0001'
  cycle_type     TEXT NOT NULL
                    CHECK (cycle_type IN ('weekly','monthly','daily','custom')),
  period_start    TEXT NOT NULL,
  period_end      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','posted','void')),
  total_earned    REAL NOT NULL DEFAULT 0,
  total_advances  REAL NOT NULL DEFAULT 0,
  total_previous_balance REAL NOT NULL DEFAULT 0,
  total_net_payable REAL NOT NULL DEFAULT 0,
  total_paid      REAL NOT NULL DEFAULT 0,
  workers_count   INTEGER NOT NULL DEFAULT 0,
  payment_method  TEXT NOT NULL DEFAULT 'cash'
                    CHECK (payment_method IN ('cash','bank','cheque','other')),
  notes           TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  posted_at       TEXT,
  posted_by       TEXT,
  voided_at       TEXT,
  voided_by       TEXT,
  void_reason     TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (voided_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON payroll_runs(status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON payroll_runs(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_cycle ON payroll_runs(cycle_type);

-- Per-worker line items in a payroll run.
-- Each row captures the calculation snapshot at the time of the run:
--   days worked (distinct dates with production entries)
--   total quantity produced
--   earned (sum of labour_amount)
--   advances during the period
--   previous balance (earned − advances − payments BEFORE this run's period)
--   net payable = earned_in_period + previous_balance − advances_in_period
--   payment_amount — what the accountant actually decided to pay
--   worker_payment_id — FK to worker_payments if posted
CREATE TABLE IF NOT EXISTS payroll_run_items (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  worker_id         TEXT NOT NULL,
  days_worked       INTEGER NOT NULL DEFAULT 0,
  total_qty         INTEGER NOT NULL DEFAULT 0,
  earned_in_period  REAL NOT NULL DEFAULT 0,
  advances_in_period REAL NOT NULL DEFAULT 0,
  previous_balance  REAL NOT NULL DEFAULT 0,
  net_payable       REAL NOT NULL DEFAULT 0,
  payment_amount    REAL NOT NULL DEFAULT 0,
  is_selected       INTEGER NOT NULL DEFAULT 1,  -- accountant can deselect workers
  notes             TEXT,
  worker_payment_id TEXT,                        -- set when posted
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
  FOREIGN KEY (worker_payment_id) REFERENCES worker_payments(id) ON DELETE SET NULL,
  UNIQUE (run_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_items_run ON payroll_run_items(run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_worker ON payroll_run_items(worker_id);

-- ============================================================
-- 25. CLOUD SYNC STATE (Phase C - v1.6.0)
-- ============================================================
-- Tracks the last sync timestamp per table for Supabase sync.
-- Used to do incremental sync (only push/pull changes since last sync).
CREATE TABLE IF NOT EXISTS cloud_sync_state (
  table_name      TEXT PRIMARY KEY,
  last_sync_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_sync_direction TEXT,                    -- 'push', 'pull', 'both'
  last_sync_status TEXT,                       -- 'success', 'failed', 'partial'
  records_pushed  INTEGER NOT NULL DEFAULT 0,
  records_pulled  INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 26. CLOUD BACKUP HISTORY (Phase C - v1.6.0)
-- ============================================================
-- Tracks Google Drive backups (separate from local backup_history).
CREATE TABLE IF NOT EXISTS cloud_backup_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_date     TEXT NOT NULL DEFAULT (datetime('now')),
  provider        TEXT NOT NULL DEFAULT 'gdrive'
                    CHECK (provider IN ('gdrive','supabase','other')),
  file_name       TEXT NOT NULL,
  file_size_bytes INTEGER,
  drive_file_id   TEXT,                        -- Google Drive file ID
  drive_link      TEXT,                        -- shareable link
  backup_type     TEXT NOT NULL DEFAULT 'auto'
                    CHECK (backup_type IN ('auto','manual','pre_restore')),
  status          TEXT NOT NULL DEFAULT 'success'
                    CHECK (status IN ('success','failed','partial')),
  error_message   TEXT,
  initiated_by    TEXT,
  FOREIGN KEY (initiated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_backup_date ON cloud_backup_history(backup_date);
