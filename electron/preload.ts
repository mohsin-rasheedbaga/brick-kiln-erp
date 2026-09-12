/**
 * Preload script - exposes a safe IPC bridge to the renderer.
 *
 * All IPC is funneled through a single `invoke` function so the renderer
 * never touches `require` or Node APIs directly.
 *
 * Channel names follow the pattern: <module>.<action>
 * Examples: 'auth:login', 'workers:list', 'departments:create'
 */

import { contextBridge, ipcRenderer } from 'electron';

const ALLOWED_CHANNELS = new Set<string>([
  // auth
  'auth:login', 'auth:logout', 'auth:me', 'auth:change-password', 'auth:check-permission',
  'auth:has-any-permission',
  // departments
  'departments:list', 'departments:get', 'departments:create', 'departments:update',
  'departments:set-active', 'departments:delete',
  // workers
  'workers:list', 'workers:get', 'workers:create', 'workers:update', 'workers:set-status',
  'workers:delete', 'workers:ledger', 'workers:lookup-by-code', 'workers:generate-codes',
  // work types
  'work-types:list', 'work-types:create', 'work-types:update', 'work-types:set-active',
  // brick categories
  'brick-categories:list', 'brick-categories:create', 'brick-categories:update', 'brick-categories:set-active',
  // kilns
  'kilns:list', 'kilns:get', 'kilns:create', 'kilns:update', 'kilns:set-status',
  // production
  'production:create', 'production:list', 'production:update', 'production:delete',
  // users
  'users:list', 'users:get', 'users:create', 'users:update', 'users:set-active',
  'users:reset-password',
  // roles
  'roles:list', 'roles:get', 'roles:create', 'roles:update', 'roles:delete',
  'roles:list-permissions', 'roles:set-permissions',
  // audit
  'audit:list', 'audit:stats',
  // settings
  'settings:get', 'settings:update', 'settings:test',
  // backup
  'backup:create', 'backup:restore', 'backup:list', 'backup:delete',
  // updates
  'update:check', 'update:download', 'update:install', 'update:get-info',
  // batches (Phase 2)
  'batches:list', 'batches:get', 'batches:create', 'batches:update',
  'batches:set-status', 'batches:delete', 'batches:cost-summary',
  // customers (Phase 2)
  'customers:list', 'customers:get', 'customers:create', 'customers:update',
  'customers:set-active', 'customers:delete', 'customers:ledger', 'customers:lookup-by-code',
  // sales (Phase 2)
  'sales:list', 'sales:get', 'sales:create', 'sales:void',
  // customer payments (Phase 2)
  'customer-payments:list', 'customer-payments:create', 'customer-payments:void',
  // expenses (Phase 2)
  'expenses:list', 'expenses:create', 'expenses:void',
  'expense-categories:list', 'expense-categories:create', 'expense-categories:set-active',
  // worker advances & payments (Phase 2)
  'worker-advances:list', 'worker-advances:create', 'worker-advances:void',
  'worker-payments:list', 'worker-payments:create', 'worker-payments:void',
  // cash register (Phase 2)
  'cash:balance', 'cash:movements', 'cash:adjustment',
  // dashboard (Phase 2)
  'dashboard:stats',
  // stock adjustments (Phase 3)
  'stock:balance', 'stock:movements', 'stock:adjustment', 'stock:adjustments:list',
  // reports (Phase 3)
  'reports:production', 'reports:sales', 'reports:expenses', 'reports:customers',
  'reports:workers', 'reports:batch-costing', 'reports:profit-loss',
  'reports:cash-flow', 'reports:stock',
  // department rates (Phase 4)
  'department-rates:list', 'department-rates:get-by-context', 'department-rates:upsert',
  'department-rates:delete', 'department-rates:matrix',
  // worker family + account summary (Phase 4)
  'workers:get-family', 'workers:set-family', 'workers:account-summary',
  // daily production summary (Phase A)
  'reports:daily-summary',
]);

contextBridge.exposeInMainWorld('erp', {
  /**
   * Invoke an IPC handler with the given channel and args.
   * @throws if the channel is not whitelisted.
   */
  invoke: async (channel: string, ...args: any[]): Promise<any> => {
    if (!ALLOWED_CHANNELS.has(channel)) {
      throw new Error(`IPC channel not allowed: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  /**
   * Subscribe to a main-process event (updates, menu actions, etc.).
   */
  on: (channel: string, callback: (data: any) => void): (() => void) => {
    const wrapped = (_event: any, data: any) => callback(data);
    ipcRenderer.on(channel, wrapped);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  /**
   * App metadata exposed to the renderer.
   */
  info: {
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  },
});

// Type definition for the global window.erp object
export type ErpApi = {
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  on: (channel: string, callback: (data: any) => void) => (() => void);
  info: {
    platform: string;
    versions: { electron: string; chrome: string; node: string };
  };
};
