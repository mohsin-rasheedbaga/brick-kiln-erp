/**
 * Network RPC server.
 *
 * When this PC is in "server" mode, an HTTP server is started on the
 * configured port. Other PCs on the same Wi-Fi/LAN POST JSON-RPC style
 * requests to /rpc and the server dispatches them to the same IPC handler
 * functions that the local UI uses.
 *
 * Endpoints:
 *   GET  /health  -> { ok, version, machineName, uptime }
 *   GET  /info    -> { machineName, version, port }
 *   POST /rpc     -> { channel, args } -> IpcResult
 */

import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import os from 'os';
import log from 'electron-log';
import { getNetworkConfig } from './networkConfig';

let server: http.Server | null = null;
let currentPort: number = 0;

type HandlerFn = (args: any) => Promise<any> | any;
const handlers = new Map<string, HandlerFn>();

export function registerRpcHandler(channel: string, fn: HandlerFn): void {
  handlers.set(channel, fn);
}

export async function invokeHandler(channel: string, args: any): Promise<any> {
  const fn = handlers.get(channel);
  if (!fn) {
    return { ok: false, error: { code: 'NO_HANDLER', message: `No handler for channel: ${channel}` } };
  }
  try {
    return await fn(args ?? {});
  } catch (err: any) {
    return { ok: false, error: { code: 'INTERNAL', message: err?.message || String(err) } };
  }
}

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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const MAX = 50 * 1024 * 1024;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: any): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') { sendJson(res, 204, {}); return; }
  const url = req.url || '/';

  if (req.method === 'GET' && (url === '/health' || url === '/ping')) {
    const cfg = getNetworkConfig();
    sendJson(res, 200, {
      ok: true,
      version: process.env.npm_package_version || '0.0.0',
      machineName: cfg.machineName || os.hostname(),
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (req.method === 'GET' && url === '/info') {
    const cfg = getNetworkConfig();
    sendJson(res, 200, { machineName: cfg.machineName || os.hostname(), version: process.env.npm_package_version || '0.0.0', port: currentPort });
    return;
  }

  if (req.method === 'POST' && url === '/rpc') {
    const cfg = getNetworkConfig();
    if (cfg.accessCode && cfg.accessCode.length > 0) {
      const provided = req.headers['x-access-code'];
      if (provided !== cfg.accessCode) {
        log.warn(`[rpc] 401 Unauthorized — access code mismatch. Expected: ${cfg.accessCode?.substring(0, 2)}***, Got: ${String(provided).substring(0, 2) || 'none'}***`);
        sendJson(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing access code. The desktop ERP server requires an access code. Open the mobile app Settings to enter it.' } });
        return;
      }
    }
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const channel: string = body.channel;
      const args: any = body.args ?? {};
      if (!channel || typeof channel !== 'string') {
        sendJson(res, 400, { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing "channel".' } });
        return;
      }
      const result = await invokeHandler(channel, args);
      sendJson(res, 200, result);
    } catch (err: any) {
      log.error('[rpc] error:', err);
      sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: err?.message || String(err) } });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `Unknown route: ${req.method} ${url}` } });
}

export function startNetworkServer(port?: number): Promise<{ port: number; ips: string[] }> {
  return new Promise((resolve, reject) => {
    if (server) { reject(new Error('Server already running.')); return; }
    const cfg = getNetworkConfig();
    const listenPort = port ?? cfg.port ?? 8765;

    server = http.createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        log.error('[rpc] unhandled error:', err);
        try { sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message: String(err) } }); } catch {}
      });
    });

    server.on('error', (err: any) => {
      if (err?.code === 'EADDRINUSE') {
        reject(new Error(`Port ${listenPort} is already in use. Try a different port in Network Settings.`));
      } else {
        reject(err);
      }
    });

    server.listen(listenPort, '0.0.0.0', () => {
      currentPort = listenPort;
      const ips = getLocalIpAddresses();
      log.info(`[rpc] Server listening on 0.0.0.0:${listenPort}. IPs: ${ips.join(', ')}`);
      resolve({ port: listenPort, ips });
    });
  });
}

export function stopNetworkServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) { currentPort = 0; resolve(); return; }
    log.info('[rpc] Stopping server...');
    server.close(() => {
      server = null;
      currentPort = 0;
      log.info('[rpc] Server stopped.');
      resolve();
    });
    setTimeout(() => { if (server) { try { server.closeAllConnections?.(); } catch {} } }, 2000);
  });
}

export function isServerRunning(): boolean { return server !== null; }
export function getServerPort(): number { return currentPort; }
