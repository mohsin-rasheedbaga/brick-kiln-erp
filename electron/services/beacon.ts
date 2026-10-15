/**
 * UDP Beacon — broadcasts the desktop ERP's presence on the local Wi-Fi
 * subnet every 2 seconds so mobile apps can auto-discover it without
 * the user typing the server IP.
 *
 * The beacon sends a small JSON packet to UDP port 8766 (broadcast address
 * 255.255.255.255) with the server's IP + RPC port + machine name.
 *
 * Mobile app listens on UDP port 8766; when it receives a valid packet
 * from a Brick Kiln ERP server, it auto-saves the server IP to settings
 * and tries to connect immediately.
 *
 * This is the same technique that Chromecast, AirPlay, and Spotify Connect
 * use for device discovery — no manual IP entry, no QR code, no setup.
 *
 * The beacon is started automatically when the RPC server starts (i.e., when
 * the desktop is in Server mode). It uses Node's built-in `dgram` module.
 */

import dgram from 'dgram';
import os from 'os';
import log from 'electron-log';
import { getNetworkConfig } from './networkConfig';

let beaconSocket: dgram.Socket | null = null;
let beaconTimer: NodeJS.Timeout | null = null;
const BROADCAST_PORT = 8766;
const BROADCAST_INTERVAL_MS = 2000;

/**
 * Build the announcement JSON that gets broadcast.
 */
function buildAnnouncement(): Buffer {
  const cfg = getNetworkConfig();
  const ips = getLocalIpAddresses();
  const payload = {
    app: 'brick-kiln-erp',
    type: 'server-announcement',
    version: process.env.npm_package_version || '0.0.0',
    machineName: cfg.machineName || os.hostname(),
    rpcPort: cfg.port || 8765,
    rpcHost: ips[0] || '',            // best-effort primary IP
    allIps: ips,                       // all LAN IPs the server is reachable on
    accessCodeRequired: !!(cfg.accessCode && cfg.accessCode.length > 0),
    timestamp: Date.now(),
  };
  return Buffer.from(JSON.stringify(payload), 'utf-8');
}

/**
 * Get all local IPv4 addresses (excluding loopback and link-local).
 */
export function getLocalIpAddresses(): string[] {
  const result: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const list = ifaces[name];
    if (!list) continue;
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        result.push(iface.address);
      }
    }
  }
  return result;
}

/**
 * Start broadcasting the server announcement every 2 seconds.
 * Safe to call multiple times — it won't double-broadcast.
 */
export function startBeacon(): void {
  if (beaconSocket) {
    log.info('[beacon] Already running.');
    return;
  }

  try {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    socket.on('error', (err) => {
      log.error('[beacon] socket error:', err);
    });

    socket.on('listening', () => {
      const addr = socket.address();
      log.info(`[beacon] Listening on UDP ${addr.address}:${addr.port} — broadcasting every ${BROADCAST_INTERVAL_MS}ms`);

      // Enable broadcast on this socket so we can send to 255.255.255.255
      socket.setBroadcast(true);

      // Send immediately, then every 2 seconds.
      sendBroadcast(socket);
      beaconTimer = setInterval(() => sendBroadcast(socket), BROADCAST_INTERVAL_MS);
    });

    socket.bind(BROADCAST_PORT);
    beaconSocket = socket;
  } catch (err) {
    log.error('[beacon] Failed to start:', err);
  }
}

/**
 * Send a single broadcast announcement.
 */
function sendBroadcast(socket: dgram.Socket): void {
  try {
    const msg = buildAnnouncement();
    // 255.255.255.255 reaches every device on the same Wi-Fi/LAN.
    socket.send(msg, 0, msg.length, BROADCAST_PORT, '255.255.255.255', (err) => {
      if (err) {
        log.warn('[beacon] broadcast send error:', err.message);
      }
    });
  } catch (err) {
    log.warn('[beacon] send error:', err);
  }
}

/**
 * Stop broadcasting and close the socket.
 * Called when the desktop app quits or switches to Standalone/Client mode.
 */
export function stopBeacon(): void {
  if (beaconTimer) {
    clearInterval(beaconTimer);
    beaconTimer = null;
  }
  if (beaconSocket) {
    try {
      beaconSocket.close();
    } catch (err) {
      log.warn('[beacon] close error:', err);
    }
    beaconSocket = null;
    log.info('[beacon] Stopped.');
  }
}

export function isBeaconRunning(): boolean {
  return beaconSocket !== null;
}
