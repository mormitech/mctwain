import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';

// Runs the real server with a short search window, so no scanner has to be present.
const PORT = 17788 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
let child;

before(async () => {
  child = spawn(process.execPath, ['src/server.js'], {
    env: {
      ...process.env,
      MCTWAIN_PORT: String(PORT),
      MCTWAIN_DISCOVERY_MS: '200',
      MCTWAIN_SEARCH_INTERVAL_MS: '200',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/ping`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

after(() => child?.kill());

const get = (path, headers = {}) => fetch(`${BASE}${path}`, { headers });

test('/status works without an Origin header (non-browser clients such as a tray app)', async () => {
  const res = await get('/status');
  assert.equal(res.status, 200);
  const status = await res.json();
  assert.equal(status.ok, true);
  assert.equal(status.name, 'mctwain');
  assert.match(status.version, /^\d+\.\d+\.\d+/);
  assert.equal(typeof status.uptimeSeconds, 'number');
  assert.equal(typeof status.scanners, 'number');
  assert.ok(['searching', 'idle'].includes(status.discovery.state));
  assert.equal(status.discovery.windowMs, 200);
  assert.equal(status.discovery.intervalMs, 200);
});

test('the same origin rules apply to /status: allowed origins pass, others get 403', async () => {
  const allowed = await get('/status', { Origin: 'http://localhost:5174' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5174');
  assert.equal((await get('/status', { Origin: 'https://evil.example' })).status, 403);
});

test('/devices answers from the cache in the documented shape', async () => {
  const started = Date.now();
  const res = await get('/devices');
  assert.equal(res.status, 200);
  const { devices } = await res.json();
  assert.ok(Array.isArray(devices));
  for (const d of devices) {
    assert.deepEqual(Object.keys(d).sort(), ['guid', 'host', 'ip', 'model', 'name', 'port', 'scheme']);
  }
  assert.ok(Date.now() - started < 1500, 'must not wait for a fresh search');
});

test('discovery runs in the background, with nobody asking', async () => {
  const before = (await (await get('/status')).json()).discovery.searches;
  await new Promise((r) => setTimeout(r, 1500));
  const after = await (await get('/status')).json();
  assert.ok(after.discovery.searches >= before + 2, `searches ${before} -> ${after.discovery.searches}`);
  assert.ok(after.discovery.lastSearchAt);
});

test('unknown routes and unknown scanners keep their errors', async () => {
  assert.equal((await get('/nope')).status, 404);
  assert.equal((await get('/devices/00000000-0000-0000-0000-000000000000')).status, 404);
});
