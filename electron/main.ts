/**
 * Electron Main Process - Brick Kiln ERP
 *
 * Responsibilities:
 *  - Create the BrowserWindow
 *  - Load the renderer (dev server in development, built HTML in production)
 *  - Initialize the database
 *  - Register all IPC handlers (auth, workers, departments, etc.)
 *  - Configure auto-update
 *  - Handle app lifecycle (ready, window-all-closed, will-quit)
 *  - Logging
 */

import { app, BrowserWindow, ipcMain, Menu, shell, dialog } from 'electron';
import path from 'path';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import { initDatabase } from './database/init';
import { closeDb } from './database/connection';
import { registerAuthHandlers } from './ipc/auth';
import { registerDepartmentHandlers } from './ipc/departments';
import { registerWorkerHandlers } from './ipc/workers';
import { registerSettingsHandlers } from './ipc/settings';
import { registerUserHandlers } from './ipc/users';
import { registerRoleHandlers } from './ipc/roles';
import { registerAuditHandlers } from './ipc/audit';
import { registerWorkTypeHandlers } from './ipc/workTypes';
import { registerBrickCategoryHandlers } from './ipc/brickCategories';
import { registerKilnHandlers } from './ipc/kilns';
import { registerProductionHandlers } from './ipc/production';
import { registerBackupHandlers } from './ipc/backup';
import { registerUpdateHandlers } from './ipc/updates';
// Phase 2 modules
import { registerBatchHandlers } from './ipc/batches';
import { registerCustomerHandlers } from './ipc/customers';
import { registerSalesHandlers } from './ipc/sales';
import { registerCustomerPaymentHandlers } from './ipc/customerPayments';
import { registerExpenseHandlers } from './ipc/expenses';
import { registerWorkerPaymentHandlers } from './ipc/workerPayments';
import { registerCashHandlers } from './ipc/cash';
import { registerDashboardHandlers } from './ipc/dashboard';
// Phase 3 modules
import { registerStockHandlers } from './ipc/stock';
import { registerReportHandlers } from './ipc/reports';
// Phase 4 modules
import { registerDepartmentRateHandlers } from './ipc/departmentRates';
import { registerDailySummaryHandlers } from './ipc/dailySummary';
// Phase B modules
import { registerPayrollHandlers } from './ipc/payroll';
// Phase C modules
import { registerCloudSyncHandlers } from './ipc/cloudSync';
import * as gdriveService from './services/gdrive';
// Phase v2.0.0 modules
import { registerInvestorHandlers } from './ipc/investors';

// Configure logging
log.transports.file.level = 'info';
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'info';
log.info('=== Brick Kiln ERP starting ===');
log.info(`App version: ${app.getVersion()}`);
log.info(`Electron: ${process.versions.electron}`);
log.info(`Node: ${process.versions.node}`);
log.info(`Platform: ${process.platform} ${process.arch}`);

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
  log.info('[main] Creating main window...');
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f8fafc',
    title: 'Brick Kiln ERP',
    icon: path.join(__dirname, '..', 'build-resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for better-sqlite3 IPC patterns
      spellcheck: false,
    },
  });

  // Show window when ready (prevents flicker)
  win.once('ready-to-show', () => {
    win.show();
    log.info('[main] Main window shown.');
  });

  // Handle external links in default browser (not in app window)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Load dev server in development, built HTML in production
  if (process.env.NODE_ENV === 'development' && !app.isPackaged) {
    log.info('[main] Loading dev server: http://localhost:5173');
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const htmlPath = path.join(__dirname, '..', 'dist', 'index.html');
    log.info(`[main] Loading production HTML: ${htmlPath}`);
    win.loadFile(htmlPath);
  }

  // Build application menu
  const template = buildMenuTemplate();
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  return win;
}

function buildMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  const isDev = process.env.NODE_ENV === 'development' && !app.isPackaged;
  return [
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createMainWindow() },
        { type: 'separator' },
        { label: 'Backup Database...', click: () => mainWindow?.webContents.send('menu:backup') },
        { label: 'Restore Database...', click: () => mainWindow?.webContents.send('menu:restore') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About Brick Kiln ERP', click: () => showAbout() },
        { label: 'Check for Updates...', click: () => mainWindow?.webContents.send('menu:check-updates') },
        { type: 'separator' },
        { label: 'Documentation', click: () => shell.openExternal('https://github.com/mohsin-rasheedbaga/brick-kiln-erp') },
      ],
    },
  ];
}

function showAbout(): void {
  dialog.showMessageBox({
    type: 'info',
    title: 'About',
    message: 'Brick Kiln ERP',
    detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}\n\nA complete ERP for brick kiln management.\n\nCopyright © 2026`,
    buttons: ['OK'],
  });
}

/**
 * Register all IPC handlers.
 */
function registerIpcHandlers(): void {
  log.info('[main] Registering IPC handlers...');
  registerAuthHandlers();
  registerDepartmentHandlers();
  registerWorkerHandlers();
  registerSettingsHandlers();
  registerUserHandlers();
  registerRoleHandlers();
  registerAuditHandlers();
  registerWorkTypeHandlers();
  registerBrickCategoryHandlers();
  registerKilnHandlers();
  registerProductionHandlers();
  registerBackupHandlers();
  registerUpdateHandlers();
  // Phase 2 modules
  registerBatchHandlers();
  registerCustomerHandlers();
  registerSalesHandlers();
  registerCustomerPaymentHandlers();
  registerExpenseHandlers();
  registerWorkerPaymentHandlers();
  registerCashHandlers();
  registerDashboardHandlers();
  // Phase 3 modules
  registerStockHandlers();
  registerReportHandlers();
  // Phase 4 modules
  registerDepartmentRateHandlers();
  registerDailySummaryHandlers();
  // Phase B modules
  registerPayrollHandlers();
  // Phase C modules
  registerCloudSyncHandlers();
  // Phase v2.0.0 modules
  registerInvestorHandlers();
  log.info('[main] All IPC handlers registered.');
}

/**
 * Configure electron-updater.
 */
function configureAutoUpdater(): void {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;          // require user action
  autoUpdater.autoInstallOnAppQuit = true;  // install on quit if downloaded
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('update-available', (info) => {
    log.info('[updater] Update available:', info.version);
    mainWindow?.webContents.send('update:available', info);
  });
  autoUpdater.on('update-not-available', (info) => {
    log.info('[updater] No update available.');
    mainWindow?.webContents.send('update:not-available', info);
  });
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:download-progress', progress);
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] Update downloaded:', info.version);
    mainWindow?.webContents.send('update:downloaded', info);
  });
  autoUpdater.on('error', (err) => {
    log.error('[updater] Error:', err);
    mainWindow?.webContents.send('update:error', err?.message || String(err));
  });
}

// ============== App Lifecycle ==============

app.whenReady().then(() => {
  log.info('[main] App ready. Initializing...');

  try {
    initDatabase();
  } catch (err) {
    log.error('[main] Database initialization failed:', err);
    dialog.showErrorBox(
      'Database Initialization Failed',
      `Could not initialize the database.\n\nError: ${err instanceof Error ? err.message : String(err)}\n\nThe application will now quit.`
    );
    app.quit();
    return;
  }

  registerIpcHandlers();
  configureAutoUpdater();

  mainWindow = createMainWindow();

  // Check for updates after window loads (only in production)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        log.warn('[updater] Check failed:', err?.message);
      });
    }, 5000);
  }

  // Phase C: Auto-backup scheduler — checks every hour if 24h passed since last backup
  // If yes, uploads the database to Google Drive automatically.
  setInterval(async () => {
    try {
      if (gdriveService.shouldAutoBackup()) {
        log.info('[auto-backup] 24h elapsed — starting Google Drive backup...');
        const result = await gdriveService.uploadBackup();
        if (result.success) {
          log.info(`[auto-backup] Success: ${result.fileName} (${result.fileSize} bytes)`);
        } else {
          log.warn('[auto-backup] Failed:', result.error);
        }
      }
    } catch (err) {
      log.error('[auto-backup] Error:', err);
    }
  }, 60 * 60 * 1000); // every 1 hour
});

app.on('window-all-closed', () => {
  log.info('[main] All windows closed.');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
});

app.on('before-quit', () => {
  log.info('[main] App quitting. Closing database...');
  closeDb();
});

app.on('will-quit', (event) => {
  log.info('=== Brick Kiln ERP quitting ===');
});

// Prevent uncaught errors from killing the process silently
process.on('uncaughtException', (err) => {
  log.error('[main] Uncaught exception:', err);
});
process.on('unhandledRejection', (err) => {
  log.error('[main] Unhandled rejection:', err);
});
