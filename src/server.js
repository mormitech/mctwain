#!/usr/bin/env node
// mctwain: local scanner helper. Discovers eSCL (AirScan) scanners via mDNS and proxies scan jobs
// for web pages. Binds to 127.0.0.1 only and only answers allowed origins.
//
//   GET  /ping            -> { ok, name, version }
//   GET  /status          -> { ok, name, version, uptimeSeconds, scanners, discovery }
//   GET  /devices         -> { devices: [{ guid, name, model, host, ip, port, scheme }] }  (from the cache)
//   GET  /devices/{guid}  -> the scanner with its capabilities and live status
//   POST /scan?device={guid}&source=&dpi=&color=&duplex=&paper=  -> { pages: [base64 jpeg, ...] }
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pkg from '../package.json' with { type: 'json' };
import {
  capabilitiesOf,
  closeDiscovery,
  describeDevice,
  discoveryStatus,
  findDevice,
  listDevices,
  ready,
  startDiscovery,
} from './discovery.js';
import { HttpError, resolveScanOptions, scan } from './escl.js';
import { isGuid } from './guid.js';

const VERSION = pkg.version;
const PORT = Number(process.env.MCTWAIN_PORT ?? 7788);
// Local development servers and the production site. Set MCTWAIN_ALLOWED_ORIGINS to replace this list.
const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
  'https://mormitech.com',
  'https://www.mormitech.com',
];
const ALLOWED_ORIGINS = new Set(
  (process.env.MCTWAIN_ALLOWED_ORIGINS?.split(',') ?? DEFAULT_ORIGINS).map((o) => o.trim()),
);

function knownDevice(guid) {
  const rec = isGuid(guid) ? findDevice(guid) : null;
  if (!rec) throw new HttpError(404, 'Unknown scanner. Search again with GET /devices first.');
  return rec;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const allowed = origin && ALLOWED_ORIGINS.has(origin);
  if (origin && !allowed) {
    res.writeHead(403).end('Origin not allowed');
    return;
  }
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  };

  try {
    if (url.pathname === '/ping') return json(200, { ok: true, name: 'mctwain', version: VERSION });

    if (url.pathname === '/status') {
      return json(200, {
        ok: true,
        name: 'mctwain',
        version: VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        scanners: listDevices().length,
        discovery: discoveryStatus(),
      });
    }

    if (url.pathname === '/devices') {
      await ready(); // only waits during the first search after start-up
      return json(200, { devices: listDevices() });
    }

    const deviceMatch = url.pathname.match(/^\/devices\/([^/]+)$/);
    if (deviceMatch) {
      const rec = knownDevice(deviceMatch[1]);
      try {
        return json(200, await describeDevice(rec));
      } catch (err) {
        throw new HttpError(502, `Could not read the scanner's capabilities: ${err.message}`);
      }
    }

    if (url.pathname === '/scan' && req.method === 'POST') {
      const rec = knownDevice(url.searchParams.get('device'));
      let capabilities;
      try {
        capabilities = await capabilitiesOf(rec);
      } catch (err) {
        throw new HttpError(502, `Could not read the scanner's capabilities: ${err.message}`);
      }
      const options = resolveScanOptions(capabilities, url.searchParams);
      const pages = await scan(rec.url, options);
      return json(200, { pages: pages.map((p) => p.toString('base64')) });
    }

    json(404, { error: 'not found' });
  } catch (err) {
    json(err.status ?? 502, { error: err.message, details: err.details });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mctwain listening on http://127.0.0.1:${PORT}`);
  startDiscovery();
});

// Homebrew cannot stop a running service when the formula is uninstalled, so the process would linger on from
// memory. When our own executable has been gone for ~30 s (a short gap is normal during `brew upgrade`),
// unregister the launchd job (macOS) and exit.
const SELF = process.argv[1];
const WATCH_MS = Number(process.env.MCTWAIN_WATCHDOG_MS ?? 10_000);
let missingChecks = 0;
setInterval(() => {
  missingChecks = existsSync(SELF) ? 0 : missingChecks + 1;
  if (missingChecks < 3) return;
  console.log('mctwain files are gone (uninstalled?); shutting down');
  const label = process.env.XPC_SERVICE_NAME;
  if (process.platform === 'darwin' && label?.startsWith('sh.brew.')) {
    rmSync(join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`), { force: true });
    spawnSync('launchctl', ['bootout', `gui/${process.getuid()}/${label}`]);
  }
  closeDiscovery();
  process.exit(0);
}, WATCH_MS).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    closeDiscovery();
    process.exit(0);
  });
}
