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
