/**
 * Network configuration IPC handlers.
 *
 * Channels:
 *   - network:get-config
 *   - network:save-config
 *   - network:get-status
 *   - network:get-ips
 *   - network:test-connection
 *   - network:add-firewall
 *   - network:check-firewall
 *   - network:remove-firewall
 */

import { ipcMain } from 'electron';
import log from 'electron-log';
import { getNetworkConfig, saveNetworkConfig } from '../services/networkConfig';
import { startNetworkServer, stopNetworkServer, isServerRunning, getServerPort, getLocalIpAddresses } from '../services/networkServer';
import { startBeacon, stopBeacon } from '../services/beacon';
import { checkFirewallRule, addFirewallRule, removeFirewallRule, isWindows } from '../services/firewall';
import { wrap, type IpcResult } from '../utils/ipc';

export function registerNetworkHandlers(): void {
  ipcMain.handle('network:get-config', async (_evt, _args: { token: string }): Promise<IpcResult<any>> => {
    return wrap(async () => {
      const cfg = getNetworkConfig();
      return {
        mode: cfg.mode,
        host: cfg.host,
        port: cfg.port,
        accessCode: cfg.accessCode,
        machineName: cfg.machineName,
        updatedAt: cfg.updatedAt,
        isWindows: isWindows(),
      };
    })();
  });

  ipcMain.handle('network:save-config', async (_evt, args: {
    token: string;
    mode: 'standalone' | 'server' | 'client';
    host?: string;
    port?: number;
    accessCode?: string;
    machineName?: string;
    autoFirewall?: boolean;
  }): Promise<IpcResult<any>> => {
    return wrap(async () => {
      const patch: any = { mode: args.mode };
      if (args.host !== undefined) patch.host = args.host.trim();
      if (args.port !== undefined) patch.port = Number(args.port) || 8765;
      if (args.accessCode !== undefined) patch.accessCode = args.accessCode;
      if (args.machineName !== undefined) patch.machineName = args.machineName;
      const saved = saveNetworkConfig(patch);

      if (saved.mode === 'server') {
        if (isServerRunning()) await stopNetworkServer();
        await startNetworkServer(saved.port);
        // Start broadcasting our presence so mobile apps auto-discover us.
        startBeacon();
        if (args.autoFirewall) {
          const result = await addFirewallRule(saved.port);
          log.info('[network] Firewall result:', result);
          return { config: saved, serverStarted: true, port: getServerPort(), ips: getLocalIpAddresses(), firewall: result };
        }
        return { config: saved, serverStarted: true, port: getServerPort(), ips: getLocalIpAddresses(), firewall: { success: false, message: 'Skipped.' } };
      }

      if (isServerRunning()) await stopNetworkServer();
      // Stop broadcasting when switching away from Server mode.
      stopBeacon();
      return { config: saved, serverStarted: false, port: 0, ips: getLocalIpAddresses(), firewall: { success: false, message: '' } };
    })();
  });

  ipcMain.handle('network:get-status', async (_evt, _args: { token: string }): Promise<IpcResult<any>> => {
    return wrap(async () => {
      const cfg = getNetworkConfig();
      return {
        mode: cfg.mode,
        host: cfg.host,
        port: cfg.port,
        serverRunning: isServerRunning(),
        serverPort: getServerPort(),
        ips: getLocalIpAddresses(),
        isWindows: isWindows(),
      };
    })();
  });

  ipcMain.handle('network:get-ips', async (_evt, _args: { token: string }): Promise<IpcResult<string[]>> => {
    return wrap(async () => getLocalIpAddresses())();
  });

  ipcMain.handle('network:test-connection', async (_evt, args: { token: string; host: string; port?: number }): Promise<IpcResult<any>> => {
    return wrap(async () => {
      const host = args.host?.trim();
      if (!host) throw new Error('Host is required.');
      const port = args.port || 8765;
      const url = `http://${host}:${port}/health`;
      log.info(`[network] Testing connection to ${url}...`);
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return { reachable: false, message: `Server responded with status ${res.status}` };
        const data: any = await res.json();
        return { reachable: true, message: `Connected successfully to ${data.machineName || 'server'}.`, serverInfo: data };
      } catch (err: any) {
        let msg = err?.message || String(err);
        if (err?.name === 'AbortError') msg = 'Connection timed out (5s). Server may not be running, or firewall is blocking it.';
        return { reachable: false, message: msg };
      }
    })();
  });

  ipcMain.handle('network:add-firewall', async (_evt, args: { token: string; port?: number }): Promise<IpcResult<any>> => {
    return wrap(async () => {
      const cfg = getNetworkConfig();
      const port = args.port || cfg.port || 8765;
      return await addFirewallRule(port);
    })();
  });

  ipcMain.handle('network:check-firewall', async (_evt, args: { token: string; port?: number }): Promise<IpcResult<any>> => {
    return wrap(async () => {
      const cfg = getNetworkConfig();
      const port = args.port || cfg.port || 8765;
      const exists = await checkFirewallRule(port);
      return { exists, port };
    })();
  });

  ipcMain.handle('network:remove-firewall', async (_evt, _args: { token: string }): Promise<IpcResult<any>> => {
    return wrap(async () => await removeFirewallRule())();
  });
}
