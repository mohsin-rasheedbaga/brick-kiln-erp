/**
 * Network configuration storage.
 *
 * Stores the network mode (standalone | server | client), host IP, and port
 * in a JSON file OUTSIDE the database, so client mode can read it before
 * establishing a connection to the server.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import log from 'electron-log';

export type NetworkMode = 'standalone' | 'server' | 'client';

export interface NetworkConfig {
  mode: NetworkMode;
  host: string;
  port: number;
  accessCode?: string;
  machineName?: string;
  updatedAt?: string;
}

const DEFAULT_CONFIG: NetworkConfig = {
  mode: 'standalone',
  host: '',
  port: 8765,
  accessCode: '',
  machineName: '',
};

let cachedConfig: NetworkConfig | null = null;

function configFilePath(): string {
  return path.join(app.getPath('userData'), 'network.json');
}

export function getNetworkConfig(): NetworkConfig {
  if (cachedConfig) return cachedConfig;
  const fp = configFilePath();
  try {
    if (fs.existsSync(fp)) {
      const parsed = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Partial<NetworkConfig>;
      cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
    } else {
      cachedConfig = { ...DEFAULT_CONFIG };
    }
  } catch (err) {
    log.warn('[network-config] Failed to read, using defaults:', err);
    cachedConfig = { ...DEFAULT_CONFIG };
  }
  if (!cachedConfig.machineName) {
    try { cachedConfig.machineName = require('os').hostname(); } catch { cachedConfig.machineName = 'PC'; }
  }
  return cachedConfig;
}

export function saveNetworkConfig(patch: Partial<NetworkConfig>): NetworkConfig {
  const next: NetworkConfig = {
    ...getNetworkConfig(),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const fp = configFilePath();
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, JSON.stringify(next, null, 2), 'utf-8');
    cachedConfig = next;
    log.info('[network-config] Saved:', next);
  } catch (err) {
    log.error('[network-config] Failed to save:', err);
    throw err;
  }
  return next;
}

export function isServerMode(): boolean { return getNetworkConfig().mode === 'server'; }
export function isClientMode(): boolean { return getNetworkConfig().mode === 'client'; }
export function isStandaloneMode(): boolean { return getNetworkConfig().mode === 'standalone'; }
