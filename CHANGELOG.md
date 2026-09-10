# Changelog

All notable changes to Brick Kiln ERP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for v1.3.0
- Print templates: sales invoice, payment receipt, customer statement, batch costing report
- Settings UI for managing expense categories + brick categories (currently in reports only)
- Auto-backup scheduler implementation (currently config-only)
- Code signing for Windows installer (currently unsigned)
- Localization framework (i18n with t() keys for Urdu support)

## [1.2.0] — 2026-09-10

### Added — Phase 3 (Reports + Stock Adjustments + Charts + Exports)

**Reports Module (9 report types)**
- Production Report: by stage, worker, department, or day; with KPIs + chart + entry list
- Sales Report: by customer, day, or status; with totals + bar chart + invoice list
- Expenses Report: by category, department, batch, or day; with donut chart + payment method breakdown
- Customers Report: balances summary with opening, sales, paid, current balance
- Workers Report: labour earnings, advances, payments, payable per worker
- Batch Costing Report: per-batch costs, revenue, profit/loss, cost per 1000 bricks
- Profit & Loss Report: revenue vs costs breakdown with margin %
- Cash Flow Report: opening/closing balance, in/out by movement type
- Stock Report: current levels + value + movement summary by type

**Report Features**
- Date range filter (defaults to current month)
- Per-report-type filters (customer, worker, department, batch, status, category, etc.)
- Group-by selector for production/sales/expenses reports
- KPI cards at the top of each report
- Visualizations: bar chart, donut chart, horizontal bar chart
- Full entry-level detail tables
- CSV export (with BOM for Excel UTF-8 compatibility)
- Print / PDF export (browser print dialog with "Save as PDF")
- Professional print layout with header (kiln name, report title, date range)

**Stock Adjustments Module**
- Three-tab view: Stock Levels / Adjustments / Movement History
- Current stock with value calculation per category
- Manual adjustments (IN or OUT) with required reason
- Optional batch linking for adjustments
- Negative stock protection (configurable via settings)
- Full movement history (sales + production + adjustments combined)
- Color-coded direction indicators (green IN, red OUT)

**Chart Components (custom SVG, no external library)**
- `BarChart`: vertical bars with values and labels
- `HorizontalBarChart`: horizontal bars (good for ranked lists)
- `DonutChart`: donut with center total + legend with percentages
- `LineChart`: line with area gradient + grid lines + axis labels
- `Sparkline`: tiny inline trend indicator
- `KpiCard`: stat card with label, value, sublabel, trend indicator

**Export Utilities**
- `arrayToCsv`: convert any array of objects to CSV string
- `downloadCsv`: trigger CSV download with BOM for Excel
- `exportToCsv`: convenience wrapper
- `printHtml`: open print window with custom HTML + CSS
- `buildTableHtml`: build HTML table from rows + columns
- `reportHeader`: standard report header (kiln name + title + date range)

**Dashboard Enhancements**
- Today's production by stage as bar chart (was previously a list)
- Stock by category as donut chart (was previously a list)
- 30-day production trend bar chart (new)
- KPI cards with consistent styling via `KpiCard` component

**IPC Infrastructure**
- New: `stock.ts` (4 channels: balance, movements, adjustment, adjustments:list)
- New: `reports.ts` (9 channels: production, sales, expenses, customers, workers, batch-costing, profit-loss, cash-flow, stock)
- 13 new IPC channels whitelisted in preload
- All reports enforce `reports.view` permission
- Stock adjustments enforce `stock.adjust` permission
- Manual adjustments recorded in audit log with old + new quantities

**Sidebar Update**
- New "Reports" group added
- Stock moved under "Accounts" group
- Cleaner navigation for end users

### Files Changed
- New: 2 IPC handlers (stock.ts, reports.ts)
- New: 3 React pages (StockPage, ReportsPage)
- New: 2 components (Charts.tsx, export.ts utility)
- Modified: main.ts, preload.ts, lib/ipc.ts, types/index.ts, App.tsx, MainLayout.tsx, DashboardPage.tsx, package.json, CHANGELOG.md

### Security
- All reports require `reports.view` permission
- Stock adjustments require `stock.adjust` permission (separate from view)
- Negative stock protected by default (configurable override)
- Every stock adjustment audited with reason, old/new quantity, and user

### Known Limitations
- Print templates for invoices/receipts not yet built (Phase 4)
- Auto-backup scheduler not yet wired up (config-only)
- No code signing for Windows installer (Phase 4)

## [1.1.0] — 2026-09-10

### Added — Phase 2 (Sales + Customers + Cash + Expenses + Worker Payments + Batches)

**Batches Module**
- Full CRUD with auto-generated batch numbers (BATCH-2026-0001)
- Status workflow: open → firing → completed → closed → cancelled
- Auto-tracking of raw bricks loaded & baked bricks unloaded (from production entries)
- Cost aggregation: labour (auto), transport (auto), fuel (manual), other (manual)
- Total cost recomputed on every production/expense change
- Sales revenue tracking per batch
- Profit/loss = total_cost − sales_revenue (live calculation)
- Batch cost summary endpoint (production by stage + expense breakdown)

**Customers Module**
- Full CRUD with auto-generated codes (CUST-0001)
- Opening balance tracking
- Credit limit (optional)
- Customer ledger derived from transactions:
  - Opening balance + SUM(invoice totals) − SUM(payments) = Current balance
- Customer detail page with invoices + payments tables
- Lookup by code, mobile, or CNIC
- Activate/deactivate (preserves history)

**Sales Invoices Module**
- Multi-line invoice creation (multiple brick categories per invoice)
- Auto-generated invoice numbers (INV-2026-00001)
- Subtotal / Discount / Total / Paid / Remaining calculations
- Payment status: unpaid / partial / paid / overpaid
- Automatic stock deduction on sale (per line item)
- Stock movement recorded with reference_type='sale'
- Negative stock protection (configurable via settings)
- Optional batch linking (tracks sales per batch)
- Inline customer payment + cash movement on creation
- Void invoices with reason (reverses stock, payments, cash, batch totals)
- Invoice view modal with full line items and totals
- Search by invoice #, customer name, or code

**Customer Payments Module**
- Receipt creation (RCP-2026-00001)
- Optional invoice linking (auto-updates invoice paid/remaining/status)
- Payment methods: cash, bank, cheque, other
- Reference number tracking (cheque #, txn id)
- Cash register update (for cash payments)
- Void payments (reverses invoice and cash impacts)

**Expenses Module**
- Full CRUD with auto-generated numbers (EXP-2026-00001)
- 12 default expense categories (Coal, Wood, Diesel, Electricity, Water, Labour, Transport, Repairs, Maintenance, Machinery, Food, Miscellaneous)
- Custom category creation
- Optional department & batch linking
- Payment methods: cash, bank, cheque, credit, other
- Cash register deduction (for cash payments)
- Batch totals update (other_cost) when batch linked
- Void expenses (reverses cash and batch impacts)
- Search and filter by category, department, batch, date range

**Worker Advances & Payments Module**
- Two separate tabs: Advances (ADV-2026-00001) and Payments (WPAY-2026-00001)
- Worker selection with department display
- Payment methods: cash, bank, cheque, other
- Cash register deduction (for cash payments)
- Worker ledger auto-updates (visible in worker detail page)
- Void with reason (reverses cash impact)
- Filter by worker, search by worker name/code/number

**Cash Register Module**
- Live cash balance (SUM of all movements)
- Total in / Total out summary cards
- Movement types: opening, sale, customer_payment, expense_out, worker_payment_out, advance_out, income_in, adjustment_in, adjustment_out, transfer
- Filter by movement type
- Manual adjustments (opening balance, income, corrections)
- Full movement history with date, type, description, entered by, amount
- Color-coded: green for IN, red for OUT

**Dashboard Overhaul**
- Real stats endpoint (no more placeholders)
- Today's production by stage with totals
- Today's sales count + total + cash received
- Today's expenses count + total
- Current cash balance
- Active/inactive/left worker counts
- Active batches + firing batches
- Open invoices count
- Customer receivables (sum of outstanding balances)
- Worker payable (sum of remaining balances)
- Stock by category breakdown
- Kiln status breakdown
- Quick action grid

**Sidebar Restructure**
- Grouped navigation: Operations / Sales & Finance / Accounts / Administration
- Cleaner visual hierarchy with section headers

**IPC Infrastructure**
- 8 new IPC handler files (batches, customers, sales, customerPayments, expenses, workerPayments, cash, dashboard)
- 33 new IPC channels whitelisted in preload
- Auto-generated sequential codes for all transaction types (BATCH, CUST, INV, RCP, EXP, ADV, WPAY)
- Transaction-based accounting: balances never manually entered
- Void (instead of delete) for all monetary transactions — preserves audit trail
- Automatic cash register updates from sales, payments, expenses, advances, worker payments
- Automatic stock adjustments from sales and production unloading
- Automatic batch cost recomputation on every related transaction

**Documentation**
- CHANGELOG updated with Phase 2 details
- README will be updated in next iteration

### Security
- All Phase 2 modules enforce permission checks at IPC layer
- Cash adjustments require `cash.manage` permission
- Sales void requires `sales.void` permission (separate from create)
- Expense void requires `expenses.void` permission
- Worker payment void requires `worker_payments.create` permission
- Every monetary action audited with old/new values

### Known Limitations
- Reports module not yet built (Phase 3)
- No PDF/Excel exports yet (Phase 3)
- No print templates for invoices/receipts yet (Phase 3)
- Dashboard has no charts yet (Phase 3)

## [1.0.0] — 2026-09-10

### Added — Phase 1 (Foundation)

**Architecture & Infrastructure**
- Electron 32 + Vite 5 + React 18 + TypeScript 5 project scaffolding
- better-sqlite3 embedded database with WAL mode, foreign keys, and proper pragmas
- Database initialization with forward-only migration framework
- Hash-based routing (HashRouter) for `file://` safety in production builds
- Tailwind CSS 3 design system with custom brand palette
- Zustand state management (auth, toast)
- electron-log for structured logging
- Context isolation + preload IPC bridge with whitelisted channels

**Authentication & Authorization**
- bcrypt password hashing (10 rounds)
- Session tokens (random UUIDs, hashed at rest)
- Brute-force protection (5 attempts → 15-minute lockout)
- Auto-logout (configurable, default 30 minutes)
- 10 default roles (Super Admin, Admin, Manager, Accountant, Cashier, Raw Brick Maker Operator, Raw Brick Transport Operator, Kiln Loading Operator, Kiln Unloading Operator, Sales User)
- 45 granular permissions across 15 modules
- Permission matrix editor in Roles page
- Department-specific user assignment

**Departments**
- 9 default system departments (Raw Brick Making, Transport, Kiln Loading, Kiln Firing, Baked Brick Unloading, Sorting/Grading, Sales, Accounts, Management)
- Full CRUD with enable/disable (system departments cannot be deleted)
- Code uniqueness enforcement
- Department-dependent record protection (can't delete if workers assigned)

**Workers**
- Full CRUD with auto-generated sequential codes (WKR-0001)
- Auto-generated CODE128 barcode (12-digit numeric)
- Auto-generated QR token (UUID; mapped to worker_id at scan time — no PII embedded)
- Printable worker ID card (CR80 size, 8.5cm × 5.4cm) with QR + barcode
- Worker ledger derived entirely from transactions:
  - Production entries (all 4 stages)
  - Advances
  - Payments
  - Remaining balance = Earned − Advances − Payments
- Lookup by worker code, barcode, or QR token
- Status management (Active / Inactive / Left)

**Work Types & Labour Rates**
- 6 default work types with department associations and default rates
- Configurable rates per 1000 bricks
- Rate hierarchy: explicit entry > worker's rate > work type default
- Auto labour calculation: quantity / 1000 × rate

**Brick Categories (Grades)**
- 6 default categories (A Grade, B Grade, C Grade, Broken, Reject, Special)
- Configurable default selling rates
- Stock tracking via stock + stock_movements tables
- No negative stock allowed (configurable override in settings)

**Kilns**
- Full CRUD
- Status tracking (empty, loading, loaded, firing, ready, unloading, completed)
- Capacity tracking

**Production Entries**
- Unified table for 4 stages:
  - `raw_brick_making`
  - `raw_brick_transport`
  - `kiln_loading`
  - `baked_brick_unloading`
- Per-entry: date, batch, kiln, worker, department, work type, quantity, rate, auto-computed labour amount
- Baked brick unloading automatically creates stock movement + updates inventory
- Batch totals (labour cost, transport cost, quantities) auto-recomputed on every change

**Settings**
- General: kiln name, address, phone, email, currency, date format, timezone
- Operational: allow negative stock, allow overpayment, auto-logout minutes
- Backup: enable/disable, interval, location
- Updates: enable/disable, channel (latest/beta)
- Settings history table tracks every change

**Audit Log**
- Every significant action logged with timestamp, user, action, module, entity, old/new values (JSON)
- Filterable by date, user, action, module
- Available to Super Admin and users with `system.audit` permission

**Backup & Restore**
- Manual backup creation (timestamped file copy with WAL checkpoint)
- Restore with confirmation dialog and pre-restore safety backup
- Backup history table
- Auto-backup scheduler (configurable interval)
- Delete old backups (record + file)

**Auto-Update**
- electron-updater integrated with GitHub Releases
- Check for updates (manual + automatic)
- Download progress bar
- Install & restart flow
- Differential updates via blockmap
- User data preserved across updates (SQLite database never touched)

**GitHub Actions CI/CD**
- `ci.yml`: lint + type-check on push/PR
- `build-release.yml`: triggered on `v*` tag push
  - Builds Windows x64 NSIS installer
  - Generates update metadata (latest.yml, blockmap)
  - Publishes to GitHub Releases
  - Uploads build artifacts

**Documentation**
- Comprehensive README
- This CHANGELOG
- Architecture document
- Inline code comments throughout

### Security
- No plaintext passwords stored (bcrypt only)
- No tokens or secrets committed to repository
- `.gitignore` excludes `.env`, `*.db`, `*.pem`, `token.txt`
- Context isolation enforced (renderer has no direct Node access)
- IPC channels whitelisted in preload script
- Session tokens hashed before storage

### Known Limitations (Phase 1)
- Dashboard shows placeholder stats (real stats coming in Phase 5)
- Sales, customers, expenses, worker payments UI not yet built (Phase 2-3)
- No reports export yet (Phase 5)
- No mobile companion (Phase 9)
- UI is English-only (localization hooks are structured for future Urdu support)
