/**
 * Preload script - exposes a safe IPC bridge to the renderer.
 *
 * In STANDALONE/SERVER mode, calls go through the local Electron ipcRenderer.
 * In CLIENT mode, all calls are proxied over HTTP to the server PC's RPC endpoint.
 *
 * Channel names follow the pattern: <module>.<action>
 */

import { contextBridge, ipcRenderer } from 'electron';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const ALLOWED_CHANNELS = new Set<string>([
  // auth
  'auth:login', 'auth:logout', 'auth:me', 'auth:change-password', 'auth:check-permission', 'auth:has-any-permission',
  // departments
  'departments:list', 'departments:get', 'departments:create', 'departments:update', 'departments:set-active', 'departments:delete',
  // workers
  'workers:list', 'workers:get', 'workers:create', 'workers:update', 'workers:set-status', 'workers:delete', 'workers:ledger', 'workers:lookup-by-code', 'workers:generate-codes',
  // work types
  'work-types:list', 'work-types:create', 'work-types:update', 'work-types:set-active',
  // brick categories
  'brick-categories:list', 'brick-categories:create', 'brick-categories:update', 'brick-categories:set-active',
  // kilns
  'kilns:list', 'kilns:get', 'kilns:create', 'kilns:update', 'kilns:set-status',
  // production
  'production:create', 'production:list', 'production:update', 'production:delete',
  // users
  'users:list', 'users:get', 'users:create', 'users:update', 'users:set-active', 'users:reset-password', 'users:delete',
  // roles
  'roles:list', 'roles:get', 'roles:create', 'roles:update', 'roles:delete', 'roles:list-permissions', 'roles:set-permissions',
  // audit
  'audit:list', 'audit:stats',
  // settings
  'settings:get', 'settings:update', 'settings:test',
  // backup
  'backup:create', 'backup:restore', 'backup:list', 'backup:delete',
  // updates
  'update:check', 'update:download', 'update:install', 'update:get-info',
  // batches
  'batches:list', 'batches:get', 'batches:create', 'batches:update', 'batches:set-status', 'batches:delete', 'batches:cost-summary',
  // customers
  'customers:list', 'customers:get', 'customers:create', 'customers:update', 'customers:set-active', 'customers:delete', 'customers:ledger', 'customers:lookup-by-code',
  // sales
  'sales:list', 'sales:get', 'sales:create', 'sales:void',
  // customer payments
  'customer-payments:list', 'customer-payments:create', 'customer-payments:void',
  // expenses
  'expenses:list', 'expenses:create', 'expenses:void', 'expense-categories:list', 'expense-categories:create', 'expense-categories:set-active',
  // worker advances & payments
  'worker-advances:list', 'worker-advances:create', 'worker-advances:void',
  'worker-payments:list', 'worker-payments:create', 'worker-payments:void',
  // cash register
  'cash:balance', 'cash:movements', 'cash:adjustment',
  // dashboard
  'dashboard:stats',
  // stock
  'stock:balance', 'stock:movements', 'stock:adjustment', 'stock:adjustments:list',
  // reports
  'reports:production', 'reports:sales', 'reports:expenses', 'reports:customers', 'reports:workers',
  'reports:batch-costing', 'reports:profit-loss', 'reports:cash-flow', 'reports:stock',
  'reports:daily-summary', 'reports:production-cost',
  // department rates
  'department-rates:list', 'department-rates:get-by-context', 'department-rates:upsert', 'department-rates:delete', 'department-rates:matrix',
  // worker family + account
  'workers:get-family', 'workers:set-family', 'workers:account-summary', 'workers:withdraw-earnings', 'workers:weekly-summary',
  // payroll
  'payroll:create-run', 'payroll:get-run', 'payroll:list-runs', 'payroll:update-item', 'payroll:post-run', 'payroll:void-run', 'payroll:delete-run', 'payroll:set-worker-cycle',
  // cloud sync
  'cloud:status', 'cloud:supabase-configure', 'cloud:supabase-test', 'cloud:supabase-sync', 'cloud:supabase-sync-status',
  'cloud:gdrive-set-config', 'cloud:gdrive-auth-url', 'cloud:gdrive-exchange-code', 'cloud:gdrive-disconnect',
  'cloud:gdrive-status', 'cloud:gdrive-backup', 'cloud:gdrive-list-backups', 'cloud:open-link',
  // investors
  'investors:list', 'investors:get', 'investors:create', 'investors:update', 'investors:set-status', 'investors:delete', 'investors:add-transaction', 'investors:monthly-profit',
  // network (local-only — never proxied)
  'network:get-config', 'network:save-config', 'network:get-status', 'network:get-ips', 'network:test-connection', 'network:add-firewall', 'network:check-firewall', 'network:remove-firewall',
  // mobile API (used by Android app over HTTP)
  'mobile:context', 'mobile:submit-production', 'mobile:sync-status',
]);

function readNetworkMode(): { mode: string; host: string; port: number; accessCode: string } {
  try {
    const fp = path.join(app.getPath('userData'), 'network.json');
    if (fs.existsSync(fp)) {
      const cfg = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      return { mode: cfg.mode || 'standalone', host: cfg.host || '', port: cfg.port || 8765, accessCode: cfg.accessCode || '' };
    }
  } catch { /* ignore */ }
  return { mode: 'standalone', host: '', port: 8765, accessCode: '' };
}

const NET = readNetworkMode();
const IS_CLIENT = NET.mode === 'client' && !!NET.host;
const SERVER_URL = IS_CLIENT ? `http://${NET.host}:${NET.port}/rpc` : '';

const LOCAL_ONLY_CHANNELS = new Set<string>([
  'network:get-config', 'network:save-config', 'network:get-status', 'network:get-ips',
  'network:test-connection', 'network:add-firewall', 'network:check-firewall', 'network:remove-firewall',
  'update:check', 'update:download', 'update:install', 'update:get-info',
  'backup:create', 'backup:restore', 'backup:list', 'backup:delete',
  'cloud:status', 'cloud:supabase-configure', 'cloud:supabase-test', 'cloud:supabase-sync', 'cloud:supabase-sync-status',
  'cloud:gdrive-set-config', 'cloud:gdrive-auth-url', 'cloud:gdrive-exchange-code', 'cloud:gdrive-disconnect',
  'cloud:gdrive-status', 'cloud:gdrive-backup', 'cloud:gdrive-list-backups', 'cloud:open-link',
]);

contextBridge.exposeInMainWorld('erp', {
  invoke: async (channel: string, ...args: any[]): Promise<any> => {
    if (!ALLOWED_CHANNELS.has(channel)) {
      throw new Error(`IPC channel not allowed: ${channel}`);
    }

    if (LOCAL_ONLY_CHANNELS.has(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }

    if (IS_CLIENT) {
      let bodyArgs: any;
      if (args.length === 0) bodyArgs = {};
      else if (args.length === 1) bodyArgs = args[0];
      else bodyArgs = { args };
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (NET.accessCode) headers['X-Access-Code'] = NET.accessCode;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const res = await fetch(SERVER_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({ channel, args: bodyArgs }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Server responded ${res.status}: ${txt}`);
        }
        return await res.json();
      } catch (err: any) {
        let msg = err?.message || String(err);
        if (err?.name === 'AbortError') msg = 'Request timed out. Server may be unreachable.';
        if (msg.includes('Failed to fetch')) {
          msg = `Cannot reach server at ${NET.host}:${NET.port}. Make sure the server PC is running in Server mode and you are on the same Wi-Fi.`;
        }
        throw new Error(msg);
      }
    }

    return ipcRenderer.invoke(channel, ...args);
  },

  on: (channel: string, callback: (data: any) => void): (() => void) => {
    const wrapped = (_event: any, data: any) => callback(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  info: {
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    networkMode: NET.mode,
    serverHost: NET.host,
    serverPort: NET.port,
    isClient: IS_CLIENT,
  },
});

export type ErpApi = {
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  on: (channel: string, callback: (data: any) => void) => (() => void);
  info: {
    platform: string;
    versions: { electron: string; chrome: string; node: string };
    networkMode: string;
    serverHost: string;
    serverPort: number;
    isClient: boolean;
  };
};
