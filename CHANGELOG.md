# Changelog

All notable changes to Brick Kiln ERP will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned for v1.1.0
- Sales invoice creation with multi-line items
- Customer management + ledger
- Customer payment receipts
- Automatic stock deduction on sale
- Cash register view
- Worker advance & payment recording
- Expense management
- Batch management with costing

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
