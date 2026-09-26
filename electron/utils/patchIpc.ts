/**
 * IPC handler patcher.
 *
 * Patches `ipcMain.handle` so every handler registration is ALSO registered
 * with the RPC server. This means a single `ipcMain.handle(channel, ...)`
 * call makes the handler available to:
 *   1. Local renderer (via ipcRenderer.invoke)
 *   2. Remote clients over HTTP (via the network RPC server)
 *
 * Existing handler files do NOT need any changes.
 */

import { ipcMain } from 'electron';
import log from 'electron-log';
import { registerRpcHandler } from '../services/networkServer';

let patched = false;

export function applyIpcPatching(): void {
  if (patched) return;
  patched = true;

  const originalHandle = ipcMain.handle.bind(ipcMain);

  ipcMain.handle = (channel: string, listener: (event: any, ...args: any[]) => any) => {
    registerRpcHandler(channel, (args) => {
      // Original listener expects (event, args). RPC callers send a single args object.
      return listener({} as any, args);
    });
    return originalHandle(channel, listener);
  };

  log.info('[ipc-patch] Patched ipcMain.handle for RPC bridging.');
}
