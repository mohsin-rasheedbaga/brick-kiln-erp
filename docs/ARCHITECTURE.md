# Architecture — Brick Kiln ERP

This document describes the architecture of the Brick Kiln ERP desktop application.

## Overview

A Windows desktop ERP built with **Electron + React + TypeScript + SQLite**. Designed to be offline-first, modular, and production-ready for real brick kiln operations.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Electron Main Process                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │  Window    │  │ AutoUpdate │  │   Logging   │  │   Menu     │  │
│  │ Management │  │  (updater) │  │ (electron-  │  │            │  │
│  │            │  │            │  │   log)      │  │            │  │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                     IPC Handler Layer                       │ │
│  │  auth │ departments │ workers │ users │ roles │ production │ │
│  │  settings │ audit │ backup │ updates │ workTypes │ kilns   │ │
│  │  brickCategories                                            │ │
│  └─────────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
│  │     Session Manager     │  │       Audit Logger            │ │
│  │  (token cache, expiry)  │  │  (every action to DB)        │ │
│  └──────────────────────────┘  └──────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Database Layer (better-sqlite3)                │ │
│  │   ┌────────────┐  ┌────────────┐  ┌────────────┐           │ │
│  │   │ Connection │  │  Schema    │  │   Init &    │           │ │
│  │   │  (WAL,FK)  │  │  (20+ tbls)│  │ Migrations │           │ │
│  │   └────────────┘  └────────────┘  └────────────┘           │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              ▲ IPC (preload bridge)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     React Renderer (sandboxed)                   │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │  Pages     │  │ Components │  │  Stores    │  │ IPC Client │ │
│  │  (routes)  │  │  (UI kit)  │  │ (Zustand)  │  │  (typed)   │ │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘ │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Tailwind CSS + Lucide Icons                    │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Security Boundaries

```
┌─────────────────┐         preload.ts          ┌─────────────────┐
│   Renderer      │  ←── contextBridge ────→    │   Main Process  │
│   (untrusted)   │   only `window.erp.invoke`  │   (trusted)     │
│   no Node APIs  │   + whitelisted channels    │   full Node     │
└─────────────────┘                             └─────────────────┘
```

The renderer CANNOT:
- `require()` anything
- Access the filesystem
- Talk to the database directly
- Spawn child processes
- Make arbitrary network requests (CSP-restricted)

Every IPC call goes through `window.erp.invoke(channel, ...args)`. The preload script checks the channel against a whitelist. The main process verifies the session token (passed as the first argument) before performing any privileged action.

## Database Design Principles

1. **Single source of truth for balances.** No `balance` column is ever manually edited. Balances are always derived:
   - Worker balance = `SUM(labour_amount FROM production_entries) − SUM(amount FROM worker_advances) − SUM(amount FROM worker_payments)`
   - Customer balance = `opening_balance + SUM(invoice totals) − SUM(payments)`
   - Stock = `SUM(quantity FROM stock_movements)`

2. **Audit trail for everything monetary.** Every stock change creates a `stock_movements` row. Every cash movement creates a `cash_movements` row. Voids (instead of deletes) preserve history for financial records.

3. **Foreign keys enforced** (`PRAGMA foreign_keys = ON`). Cascade deletes only where safe (e.g., `role_permissions` cascades when a role is deleted; `workers` does NOT cascade — you must reassign or set status='left' instead).

4. **Idempotent migrations.** Schema uses `CREATE TABLE IF NOT EXISTS`. Seed uses `INSERT OR IGNORE`. The `init.ts` runs schema + seed + migrations in a single transaction on every startup — safe to run repeatedly.

5. **WAL mode** for concurrent reads during writes. The app never locks the database for long periods.

## IPC Pattern

All IPC handlers follow a uniform pattern:

```typescript
ipcMain.handle('module:action', async (_evt, args) => {
  return wrap(async () => {
    // 1. Verify session
    const session = getSession(args.token);
    if (!session) throw new Error('Session expired.');

    // 2. Check permission
    if (!session.permissions.includes('module.action') && session.roleId !== 'role-super-admin') {
      throw new Error('You do not have permission.');
    }

    // 3. Validate inputs
    if (!args.name?.trim()) throw new Error('Name is required.');

    // 4. Execute in transaction
    transaction(db, () => {
      run(db, 'INSERT ...', ...);
      audit({ ... });
    });

    // 5. Return result
    return result;
  })();
});
```

The `wrap()` helper catches errors and converts them to `{ ok: false, error: { code, message } }` for the renderer.

## State Management

Two Zustand stores:

1. **`useAuthStore`** — current user, token, login/logout, permission checks
2. **`useToastStore`** — toast notifications (success/error/warning/info)

Session token is persisted in `localStorage` so refreshes don't force re-login. The main process also keeps an in-memory session cache for performance (avoids DB lookup on every IPC call).

## Auto-Update Flow

```
1. User opens Updates page
2. Click "Check for Updates"
3. Main process calls autoUpdater.checkForUpdates()
4. autoUpdater queries GitHub Releases API:
   GET /repos/mohsin-rasheedbaga/brick-kiln-erp/releases/latest
5. Compares latest release version to app.getVersion()
6. If newer:
   - Renderer shows version + release notes
   - User clicks "Download Update"
   - Main process calls autoUpdater.downloadUpdate()
   - Progress events flow to renderer (progress bar)
   - On completion: "Install & Restart" button appears
7. User clicks "Install & Restart"
   - Main process calls autoUpdater.quitAndInstall()
   - App quits, NSIS installer runs, app relaunches
   - SQLite database is untouched (lives in userData)
```

Differential updates via blockmap are supported automatically — only changed file blocks are downloaded.

## Build & Release Flow

```
1. Developer bumps version in package.json
2. Developer updates CHANGELOG.md
3. git tag v1.0.1 && git push --tags
4. GitHub Actions triggers build-release.yml:
   a. Checkout code
   b. Setup Node 20
   c. npm ci
   d. Rebuild better-sqlite3 for Electron
   e. Type-check both electron & renderer
   f. Build Vite + TypeScript
   g. Run electron-builder with --publish always
   h. electron-builder:
      - Packages the app into NSIS installer
      - Generates latest.yml (update metadata)
      - Generates *.blockmap (differential update files)
      - Uploads all artifacts to a new GitHub Release
5. Users running v1.0.0 detect v1.0.1 via auto-update
6. They download & install — user data preserved
```

## File Layout Decisions

- **`electron/database/*.sql`** are kept as plain SQL files (not TypeScript). This makes them readable, diffable, and reviewable. They're bundled via `extraResources` in `electron-builder` config so they ship with the installer.

- **IPC handlers are split per module** (one file each). This keeps each handler file focused and prevents the main process from becoming a giant monolith.

- **Renderer uses HashRouter** (not BrowserRouter) because in production the renderer loads from `file://`, which doesn't play well with HTML5 history API.

- **Tailwind for styling** — utility-first, no separate CSS files to maintain. Custom `brand` color palette defined in `tailwind.config.js`.

## Future Extensibility

The architecture is designed so new modules can be added without rewriting the core:

1. Add tables to `schema.sql` (idempotent — safe to re-run)
2. Add a new IPC handler file in `electron/ipc/`
3. Register it in `electron/main.ts → registerIpcHandlers()`
4. Add the channel to `ALLOWED_CHANNELS` in `electron/preload.ts`
5. Add domain types to `src/types/index.ts`
6. Add typed API methods to `src/lib/ipc.ts`
7. Build the renderer page in `src/pages/`
8. Add the route to `src/App.tsx`
9. Add a permission entry in `seed.sql` (under permissions + role_permissions)
10. Add a sidebar entry in `src/pages/MainLayout.tsx`

No other parts of the system need to change.

## What's NOT in Phase 1 (and why)

- **Sales/Customers/Expenses UI** — schema is ready, IPC handlers and pages will follow in Phase 2-3.
- **Reports** — depends on sales/expense data being populated first.
- **Attendance/Payroll** — explicitly deferred to Phase 9 per the spec.
- **Cloud sync** — explicitly optional per the spec.
- **Urdu localization** — i18n structure (t() keys) will be introduced when adding the second language; UI strings are currently plain English.

## Testing Strategy (Phase 8)

Planned test layers:
1. **Unit tests** (vitest) — pure functions: labour calc, validation, stock math
2. **Integration tests** — IPC handlers with a temporary SQLite DB
3. **End-to-end tests** (Playwright with Electron) — full user flows
4. **Smoke tests in CI** — verify build artifact launches without crashing

## Critical Path for Production Deployment

1. ✅ Build pipeline works on Windows
2. ✅ Auto-update mechanism is functional (not fake)
3. ✅ Database migrations are forward-only and idempotent
4. ✅ Backups work and restore preserves data
5. ✅ Permissions are enforced at the IPC layer (not just UI hiding)
6. ✅ Audit log captures every privileged action
7. ⏳ Real-world validation with a kiln operator (Phase 8)
8. ⏳ Code signing (currently unsigned — Windows SmartScreen will warn)
