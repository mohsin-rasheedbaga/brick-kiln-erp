-- ============================================================
-- Brick Kiln ERP - Seed Data
-- Default departments, roles, permissions, brick categories,
-- expense categories, work types, default admin user
-- ============================================================

-- ============================================================
-- 1. DEFAULT DEPARTMENTS
-- ============================================================
INSERT OR IGNORE INTO departments (id, name, code, description, is_system, is_active, sort_order) VALUES
  ('dept-raw-brick',     'Raw Brick Making',       'RAW',    'Production of raw bricks from clay',     1, 1, 1),
  ('dept-transport',     'Raw Brick Transportation','TRNS',  'Transport of raw bricks to kiln',         1, 1, 2),
  ('dept-kiln-loading',  'Kiln Loading',           'LOAD',   'Loading/placement of bricks into kiln',  1, 1, 3),
  ('dept-kiln-firing',   'Kiln Firing',            'FIRE',   'Kiln firing/burning operations',        1, 1, 4),
  ('dept-kiln-unloading','Baked Brick Unloading',  'UNLD',   'Unloading baked bricks from kiln',       1, 1, 5),
  ('dept-grading',       'Brick Sorting / Grading', 'GRAD',  'Sorting & grading baked bricks',         1, 1, 6),
  ('dept-sales',         'Sales',                   'SALE',  'Sales & customer relations',             1, 1, 7),
  ('dept-accounts',      'Accounts',                'ACCT',  'Financial records & expenses',          1, 1, 8),
  ('dept-management',    'Management',              'MNGT',  'Overall kiln management',               1, 1, 9);

-- ============================================================
-- 2. WORK TYPES (with default rates per 1000 bricks)
-- ============================================================
INSERT OR IGNORE INTO work_types (id, name, code, department_id, default_rate_per_1000, description, is_active) VALUES
  ('wt-raw-making',   'Raw Brick Making',         'RAW_BRICK',    'dept-raw-brick',     1200, 'Making raw bricks from clay/mud', 1),
  ('wt-transport',    'Raw Brick Transportation', 'TRANSPORT',   'dept-transport',     800,  'Transporting raw bricks to kiln', 1),
  ('wt-kiln-loading', 'Kiln Loading / Placement', 'KILN_LOAD',   'dept-kiln-loading',  900,  'Loading bricks into kiln',        1),
  ('wt-kiln-firing',  'Kiln Firing',              'KILN_FIRE',   'dept-kiln-firing',   500,  'Firing / burning kiln',           1),
  ('wt-unloading',    'Baked Brick Unloading',    'BAKED_UNLD',  'dept-kiln-unloading',1000, 'Unloading baked bricks',          1),
  ('wt-grading',      'Brick Sorting / Grading',  'GRADING',     'dept-grading',       400,  'Sorting & grading baked bricks', 1);

-- ============================================================
-- 3. BRICK CATEGORIES (Grades)
-- ============================================================
INSERT OR IGNORE INTO brick_categories (id, name, code, description, default_selling_rate, is_active, sort_order) VALUES
  ('cat-a',       'A Grade',       'A',     'Premium quality first-class bricks',    18, 1, 1),
  ('cat-b',       'B Grade',       'B',     'Second-class bricks, minor defects',    15, 1, 2),
  ('cat-c',       'C Grade',       'C',     'Third-class bricks',                    12, 1, 3),
  ('cat-broken',  'Broken',        'BRK',   'Broken pieces (used for filling)',       6,  1, 4),
  ('cat-reject',  'Reject',        'RJT',   'Rejected / unusable bricks',             3,  1, 5),
  ('cat-special', 'Special Grade', 'SP',    'Custom premium / oversized bricks',      22, 1, 6);

-- ============================================================
-- 4. EXPENSE CATEGORIES
-- ============================================================
INSERT OR IGNORE INTO expense_categories (id, name, code, description, is_active) VALUES
  ('exp-coal',       'Coal',         'COAL', 'Coal/fuel for kiln firing',         1),
  ('exp-wood',       'Wood',         'WOOD', 'Wood fuel',                         1),
  ('exp-diesel',     'Diesel',       'DIESL','Diesel for generators/transport',    1),
  ('exp-electricity','Electricity',  'ELEC', 'Electricity bills',                 1),
  ('exp-water',      'Water',        'WATER','Water supply',                      1),
  ('exp-labour',     'Labour',       'LAB',  'Direct labour payments',            1),
  ('exp-transport',  'Transport',    'TRNS', 'Transport costs',                   1),
  ('exp-repairs',    'Repairs',      'REPR', 'Repair & maintenance',              1),
  ('exp-maintenance','Maintenance',  'MAINT','Routine maintenance',               1),
  ('exp-machinery',  'Machinery',    'MACH', 'Machinery purchase/lease',          1),
  ('exp-food',       'Food',         'FOOD', 'Worker food / refreshments',        1),
  ('exp-misc',       'Miscellaneous','MISC', 'Other unspecified expenses',        1);

-- ============================================================
-- 5. PERMISSIONS (Granular RBAC)
-- ============================================================
-- Format: module.action
INSERT OR IGNORE INTO permissions (id, code, name, module, description) VALUES
  -- Dashboard
  ('perm-dash-view',           'dashboard.view',          'View Dashboard',         'dashboard',  'Access to main dashboard'),

  -- Production
  ('perm-prod-view',           'production.view',         'View Production',        'production', 'View production records'),
  ('perm-prod-create',         'production.create',       'Create Production',      'production', 'Record new production entries'),
  ('perm-prod-edit',           'production.edit',         'Edit Production',        'production', 'Edit existing production records'),
  ('perm-prod-delete',         'production.delete',       'Delete Production',      'production', 'Delete production records'),

  -- Workers
  ('perm-workers-view',         'workers.view',            'View Workers',           'workers',    'View worker records'),
  ('perm-workers-create',       'workers.create',          'Create Workers',         'workers',    'Create new worker records'),
  ('perm-workers-edit',         'workers.edit',            'Edit Workers',           'workers',    'Edit existing workers'),
  ('perm-workers-delete',       'workers.delete',          'Delete Workers',         'workers',    'Delete worker records'),
  ('perm-workers-print-card',   'workers.print_card',      'Print Worker Card',      'workers',    'Print worker ID cards'),
  ('perm-workers-ledger',       'workers.ledger',          'View Worker Ledger',     'workers',    'View worker ledger & balance'),

  -- Labour
  ('perm-labour-view',          'labour.view',             'View Labour',            'labour',     'View labour entries'),
  ('perm-labour-enter',         'labour.enter',            'Enter Labour Quantity',  'labour',     'Enter labour/production quantities'),

  -- Kilns
  ('perm-kiln-view',            'kilns.view',              'View Kilns',             'kilns',      'View kiln records'),
  ('perm-kiln-manage',          'kilns.manage',            'Manage Kilns',           'kilns',      'Add/edit/delete kilns'),

  -- Batches
  ('perm-batch-view',           'batches.view',            'View Batches',           'batches',    'View batch records'),
  ('perm-batch-create',         'batches.create',          'Create Batches',        'batches',    'Create new batches'),
  ('perm-batch-edit',           'batches.edit',            'Edit Batches',           'batches',    'Edit existing batches'),

  -- Stock
  ('perm-stock-view',           'stock.view',              'View Stock',             'stock',      'View current inventory'),
  ('perm-stock-adjust',         'stock.adjust',            'Adjust Stock',           'stock',      'Manual stock adjustments'),

  -- Sales
  ('perm-sales-view',           'sales.view',              'View Sales',             'sales',      'View sales invoices'),
  ('perm-sales-create',         'sales.create',            'Create Sales',           'sales',      'Create new sales invoices'),
  ('perm-sales-edit',           'sales.edit',              'Edit Sales',             'sales',      'Edit existing sales invoices'),
  ('perm-sales-void',           'sales.void',              'Void Sales',             'sales',      'Void/cancel sales invoices'),

  -- Customers
  ('perm-customers-view',       'customers.view',          'View Customers',         'customers',  'View customer records'),
  ('perm-customers-create',     'customers.create',        'Create Customers',       'customers',  'Create new customers'),
  ('perm-customers-edit',       'customers.edit',          'Edit Customers',         'customers',  'Edit existing customers'),
  ('perm-customers-payment',    'customers.payment',       'Receive Customer Payment','customers', 'Receive customer payments'),
  ('perm-customers-ledger',     'customers.ledger',        'View Customer Ledger',   'customers',  'View customer ledger'),

  -- Expenses
  ('perm-expenses-view',        'expenses.view',           'View Expenses',          'expenses',   'View expense records'),
  ('perm-expenses-create',      'expenses.create',         'Create Expense',         'expenses',   'Create new expenses'),
  ('perm-expenses-edit',        'expenses.edit',            'Edit Expenses',          'expenses',   'Edit existing expenses'),
  ('perm-expenses-void',        'expenses.void',            'Void Expenses',          'expenses',   'Void/cancel expenses'),

  -- Worker Payments
  ('perm-wpay-view',            'worker_payments.view',    'View Worker Payments',   'worker_payments','View worker payment records'),
  ('perm-wpay-create',          'worker_payments.create',  'Create Worker Payment',  'worker_payments','Record worker payments'),
  ('perm-wpay-advance',         'worker_payments.advance',  'Give Worker Advance',    'worker_payments','Record worker advances'),

  -- Accounts
  ('perm-accounts-view',        'accounts.view',           'View Accounts',          'accounts',   'View financial accounts & cash'),
  ('perm-cash-manage',          'cash.manage',             'Manage Cash',            'cash',       'Manage cash register'),

  -- Reports
  ('perm-reports-view',         'reports.view',            'View Reports',           'reports',    'View all reports'),
  ('perm-reports-export',       'reports.export',          'Export Reports',         'reports',    'Export reports to PDF/Excel'),

  -- Settings
  ('perm-settings-view',        'settings.view',           'View Settings',          'settings',   'View application settings'),
  ('perm-settings-manage',      'settings.manage',         'Manage Settings',        'settings',   'Edit application settings'),
  ('perm-departments-manage',   'departments.manage',      'Manage Departments',     'departments','Add/edit/delete departments'),
  ('perm-users-manage',         'users.manage',            'Manage Users',           'users',      'Add/edit/delete users'),
  ('perm-roles-manage',         'roles.manage',            'Manage Roles',           'roles',      'Add/edit/delete roles & permissions'),

  -- System
  ('perm-backup',               'system.backup',           'Backup Database',        'system',     'Create database backups'),
  ('perm-restore',              'system.restore',          'Restore Database',       'system',     'Restore from backups'),
  ('perm-update',               'system.update',           'Update Software',        'system',     'Check & install software updates'),
  ('perm-audit-view',           'system.audit',            'View Audit Log',         'system',     'View audit logs');

-- ============================================================
-- 6. ROLES
-- ============================================================
INSERT OR IGNORE INTO roles (id, name, description, is_system, is_active) VALUES
  ('role-super-admin', 'Super Admin',                 'Full unrestricted system access',          1, 1),
  ('role-admin',       'Admin',                       'Manage most of the system',                1, 1),
  ('role-manager',     'Manager',                     'Operational management',                   1, 1),
  ('role-accountant',  'Accountant',                  'Financial records, expenses, payments',   1, 1),
  ('role-cashier',     'Cashier',                     'Cash sales & customer payments',           1, 1),
  ('role-raw-maker',   'Raw Brick Maker Operator',   'Enter raw brick production',              1, 1),
  ('role-transport',   'Raw Brick Transport Operator','Enter raw brick transportation',           1, 1),
  ('role-kiln-load',   'Kiln Loading Operator',       'Enter kiln loading/placement',            1, 1),
  ('role-kiln-unload', 'Kiln Unloading Operator',    'Enter baked brick unloading',              1, 1),
  ('role-sales',       'Sales User',                  'Create sales and invoices',               1, 1);

-- ============================================================
-- 7. ROLE_PERMISSIONS (Super Admin gets all; others get subsets)
-- ============================================================
-- Super Admin = ALL permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'role-super-admin', id FROM permissions;

-- Admin = all except user/role management
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'role-admin', id FROM permissions
  WHERE code NOT IN ('users.manage','roles.manage','system.update');

-- Manager = operational modules (no admin/finance destructive)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'role-manager', id FROM permissions
  WHERE code IN (
    'dashboard.view','production.view','production.create','production.edit',
    'workers.view','workers.create','workers.edit','workers.print_card','workers.ledger',
    'labour.view','labour.enter',
    'kilns.view','kilns.manage','batches.view','batches.create','batches.edit',
    'stock.view','sales.view','customers.view','customers.ledger',
    'expenses.view','reports.view','reports.export'
  );

-- Accountant = finance + reports
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'role-accountant', id FROM permissions
  WHERE code IN (
    'dashboard.view','workers.view','workers.ledger',
    'labour.view','batches.view','stock.view',
    'customers.view','customers.ledger','customers.payment',
    'expenses.view','expenses.create','expenses.edit','expenses.void',
    'worker_payments.view','worker_payments.create','worker_payments.advance',
    'accounts.view','cash.manage','reports.view','reports.export'
  );

-- Cashier = sales & customer payments
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'role-cashier', id FROM permissions
  WHERE code IN (
    'dashboard.view','sales.view','sales.create','sales.edit',
    'customers.view','customers.create','customers.edit','customers.payment',
    'stock.view','cash.manage','reports.view'
  );

-- Raw Brick Maker Operator
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'role-raw-maker', id FROM permissions
  WHERE code IN (
    'dashboard.view','production.view','production.create','production.edit',
    'workers.view','workers.print_card','labour.view','labour.enter',
    'batches.view'
  );

-- Raw Brick Transport Operator
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'role-transport', id FROM permissions
  WHERE code IN (
    'dashboard.view','production.view','production.create','production.edit',
    'workers.view','workers.print_card','labour.view','labour.enter','batches.view'
  );

-- Kiln Loading Operator
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'role-kiln-load', id FROM permissions
  WHERE code IN (
    'dashboard.view','production.view','production.create','production.edit',
    'workers.view','workers.print_card','labour.view','labour.enter',
    'kilns.view','batches.view','batches.create'
  );

-- Kiln Unloading Operator
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'role-kiln-unload', id FROM permissions
  WHERE code IN (
    'dashboard.view','production.view','production.create','production.edit',
    'workers.view','workers.print_card','labour.view','labour.enter',
    'kilns.view','batches.view','stock.view'
  );

-- Sales User
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT 'role-sales', id FROM permissions
  WHERE code IN (
    'dashboard.view','sales.view','sales.create','sales.edit',
    'customers.view','customers.create','customers.edit',
    'stock.view','reports.view'
  );

-- ============================================================
-- 8. DEFAULT ADMIN USER
-- ============================================================
-- Admin user is created by the application code at first run,
-- NOT in this seed file. This is because bcrypt password hashing
-- must be performed at runtime via bcryptjs, not stored as a static
-- string in SQL.
--
-- Default credentials (created on first run):
--   Username: admin
--   Password: admin123
--   Role:     Super Admin
--   (must_change_password flag set to 1)
--
-- See electron/database/init.ts -> ensureDefaultAdmin()
