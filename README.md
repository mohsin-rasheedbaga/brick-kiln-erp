# Brick Kiln ERP

A complete **Windows Desktop ERP** for brick kiln management — covering production, labour, departments, workers, sales, accounts, and reporting. Built with Electron + React + TypeScript + SQLite (better-sqlite3).

**Offline-first. Real database. Real permissions. Real auto-update.**

---

## Features (Phase 1 — current release)

- **Authentication** with bcrypt password hashing, session tokens, brute-force lockout
- **Role-based access control (RBAC)** with 10 default roles and 40+ granular permissions
- **Department Management** — full CRUD + enable/disable (system departments preserved)
- **Worker Management** — CRUD with auto-generated Worker Code, Barcode (CODE128), QR token
- **Worker ID Card** — printable card with barcode + QR (CR80 card size)
- **Worker Ledger** — derived entirely from transactions (no duplicate balances)
- **Production Entry** — 4 stages: Raw Brick Making, Raw Brick Transport, Kiln Loading, Baked Brick Unloading
- **Automatic Labour Calculation** — quantity / 1000 × rate
- **Settings** — kiln name, currency, date format, timezone, auto-logout, backup, update channel
- **Users & Roles** management UI with permission matrix editor
- **Audit Log** — every significant action recorded
- **Backup & Restore** — manual + automatic backups with safety checks
- **Auto-Update** — via GitHub Releases (electron-updater with differential downloads)
- **GitHub Actions** CI/CD pipeline (lint + type-check + Windows build & release)
- **Offline-first** — all daily operations work without internet

---

## Tech Stack

| Layer | Technology |
|------|------------|
| Desktop shell | Electron 32 |
| Renderer | React 18 + Vite 5 + TypeScript 5 |
| Database | SQLite via better-sqlite3 (embedded, no server) |
| Styling | Tailwind CSS 3 |
| State | Zustand 4 |
| Routing | React Router 6 (HashRouter for file:// safety) |
| Packaging | electron-builder 25 (NSIS installer for Windows) |
| Auto-update | electron-updater 6 |
| Logging | electron-log |
| Barcode | JsBarcode |
| QR Code | qrcode |
| Password hashing | bcryptjs |
| CI/CD | GitHub Actions |

---

## Project Structure

```
brick-kiln-erp/
├── .github/workflows/        # CI + release workflows
├── docs/                     # Architecture & design docs
├── electron/                 # Electron main process
│   ├── main.ts               # App entry, window, lifecycle
│   ├── preload.ts           # IPC bridge (security boundary)
│   ├── database/
│   │   ├── schema.sql        # All tables & indexes
│   │   ├── seed.sql          # Default departments, roles, permissions, etc.
│   │   ├── connection.ts     # better-sqlite3 singleton
│   │   └── init.ts           # Initialization & migrations
│   ├── ipc/                  # IPC handlers (one file per module)
│   │   ├── auth.ts
│   │   ├── departments.ts
│   │   ├── workers.ts
│   │   ├── users.ts
│   │   ├── roles.ts
│   │   ├── settings.ts
│   │   ├── production.ts
│   │   ├── backup.ts
│   │   ├── updates.ts
│   │   └── ...
│   ├── utils/                # Shared utilities (audit, session, validation)
│   └── tsconfig.json
├── src/                      # React renderer
│   ├── components/           # Reusable UI (Modal, Toast, Spinner, etc.)
│   ├── pages/                # Route-level pages
│   ├── stores/               # Zustand stores (auth, toast)
│   ├── lib/                  # IPC client, formatters
│   ├── types/                # TypeScript domain types
│   ├── styles/               # Tailwind + global CSS
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── README.md
```

---

## Quick Start (Development)

### Prerequisites
- Node.js 20+
- npm 10+

### Install & Run

```bash
# 1. Install dependencies
npm install

# 2. Rebuild native modules for Electron
npm run rebuild

# 3. Start dev (Vite + Electron concurrently)
npm run dev
```

The app opens with Vite dev server (hot reload) + Electron window attached.

### Default Login
- Username: `admin`
- Password: `admin123`
- You will be prompted to change this on first login.

---

## Build Windows Installer

```bash
# Build the production .exe installer (NSIS)
npm run build:win
```

Output is in `release/` directory:
- `Brick Kiln ERP Setup x.y.z.exe` — installer
- `latest.yml` — auto-update metadata
- `*.blockmap` — differential update files

---

## Auto-Update System

The app uses `electron-updater` which checks `https://github.com/mohsin-rasheedbaga/brick-kiln-erp/releases/latest` for new versions.

**To release a new version:**

1. Update `version` in `package.json` (semantic versioning: `MAJOR.MINOR.PATCH`)
2. Update `CHANGELOG.md`
3. Commit & tag:
   ```bash
   git commit -am "release: v1.0.1"
   git tag v1.0.1
   git push origin main --tags
   ```
4. GitHub Actions will:
   - Build the Windows installer
   - Create a GitHub Release with the `.exe` and update metadata
   - Users running v1.0.0 will see "Version 1.0.1 is available" in the Updates page

**User flow on existing installation:**
- Settings → Updates → "Check for Updates"
- If newer version exists → "Download Update" → progress bar
- After download → "Install & Restart" → app closes, updates, relaunches
- User data is preserved (SQLite database is never touched by updates)

---

## Database Schema

See [`electron/database/schema.sql`](electron/database/schema.sql) for the complete schema. Key tables:

| Table | Purpose |
|------|---------|
| `users`, `roles`, `permissions`, `role_permissions` | RBAC |
| `sessions` | Active login tokens |
| `departments` | Operating departments |
| `workers` | Worker master with barcode + QR token |
| `work_types` | Configurable labour types with rates |
| `kilns`, `batches` | Kiln & batch tracking |
| `production_entries` | Unified production transactions (4 stages) |
| `stock`, `stock_movements` | Inventory ledger (no negative stock by default) |
| `sales_invoices`, `sales_invoice_items` | Sales (Phase 2) |
| `customers`, `customer_payments` | Customers & receipts (Phase 2) |
| `expenses`, `expense_categories` | Expense tracking (Phase 2) |
| `worker_advances`, `worker_payments` | Worker payables |
| `cash_movements` | Cash register ledger |
| `audit_log` | Every significant action |
| `backup_history`, `settings`, `settings_history`, `app_meta` | System |

All money values stored as REAL. All timestamps as ISO 8601 TEXT (UTC). All IDs as TEXT UUIDs (where appropriate) or sequential human-readable codes (WKR-0001, BATCH-2026-0001).

**Data integrity rule**: balances are NEVER manually entered. They are always derived from transaction records (e.g. `worker_balance = SUM(labour) - SUM(advances) - SUM(payments)`).

---

## Security

- Passwords hashed with bcrypt (10 rounds)
- Session tokens are random UUIDs; only the hash is stored in DB
- Brute-force protection: 5 failed attempts → 15-minute lockout
- Context isolation in Electron (renderer has no Node access)
- Preload script whitelists allowed IPC channels
- No tokens or secrets in source code
- `.gitignore` excludes `.env`, `*.db`, `*.pem`, `token.txt`
- Audit log records every Create / Update / Delete / Void / Login / Logout / Settings change

---

## Roadmap (Phases 2–10)

| Phase | Status | Scope |
|------|--------|-------|
| 1. Architecture + Auth + RBAC + Departments + Workers + Production | ✅ Done | This release |
| 2. Sales + Customers + Invoices + Stock auto-deduction | 🚧 Next | Invoices, customer ledger, payment receipts |
| 3. Expenses + Cash Management + Worker Payments + Advances | 🚧 Next | Expense CRUD, cash register, worker payables |
| 4. Kilns + Batches + Firing + Grading + Stock | 🚧 Next | Full kiln cycle, batch costing |
| 5. Reports + Dashboard charts + PDF/Excel exports | 🚧 Next | All standard reports |
| 6. Backup automation + Audit dashboard + Security hardening | 🚧 Next | Auto-backup scheduler, security review |
| 7. Production testing + bug fixes | 🚧 Next | Real-world validation |
| 8. Localization (Urdu) + multi-language UI | Future | i18n with t() keys (already structured) |
| 9. Mobile companion app | Future | Read-only dashboards + production entry |
| 10. Cloud sync (optional) | Future | Encrypted backup to cloud, multi-kiln sync |

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [CHANGELOG](CHANGELOG.md)
- [Database Schema](electron/database/schema.sql)
- [Seed Data](electron/database/seed.sql)

---

## License

MIT. See [LICENSE](LICENSE).

---

## Security Note for Developers

- **NEVER commit** secrets, tokens, or passwords to this repository.
- Use GitHub Secrets (Settings → Secrets and variables → Actions) for any CI/CD credentials.
- The `GH_TOKEN` used in GitHub Actions is automatically provided by GitHub — no manual setup needed.
- If a Personal Access Token is leaked, **revoke it immediately** at https://github.com/settings/tokens.

---

Built for brick kiln operators. Stay productive.
