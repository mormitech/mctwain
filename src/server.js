#!/usr/bin/env node
// mctwain: local scanner helper. Discovers eSCL (AirScan) scanners via mDNS and proxies scan jobs
// for web pages. Binds to 127.0.0.1 only and only answers allowed origins.
import http from 'node:http';
import { Bonjour } from 'bonjour-service';

const VERSION = '0.1.0';
const PORT = Number(process.env.MCTWAIN_PORT ?? 7788);
const ALLOWED_ORIGINS = new Set(
  (process.env.MCTWAIN_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:4173')
    .split(',')
    .map((o) => o.trim()),
);

const bonjour = new Bonjour();

function discover(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const found = new Map();
    const browser = bonjour.find({ type: 'uscan' }, (svc) => {
      const address = svc.addresses?.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? svc.host;
      const root = svc.txt?.rs ? `/${svc.txt.rs}` : '/eSCL';
      found.set(svc.name, {
        id: svc.name,
        name: svc.txt?.ty ?? svc.name,
        url: `http://${address}:${svc.port}${root}`,
        duplex: svc.txt?.duplex === 'T',
        sources: (svc.txt?.is ?? 'platen').split(','),
      });
    });
    setTimeout(() => {
      browser.stop();
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

// Only talk to scanners on the local network, never arbitrary hosts.
function isLanUrl(value) {
  try {
    const { protocol, hostname } = new URL(value);
    return (
      protocol === 'http:' &&
      (/^(10|127)\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        hostname.endsWith('.local'))
    );
  } catch {
    return false;
  }
}

const SOURCES = { platen: 'Platen', feeder: 'Feeder' };

// Element order and content follow sane-airscan, which is known to work with this scanner.
// Region is A4 in 1/300 inch; Brother needs an explicit region before it honours the feeder.
function settingsXml({ source, dpi, color }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.0</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:Width>2480</pwg:Width>
      <pwg:Height>3507</pwg:Height>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>${SOURCES[source]}</pwg:InputSource>
  <scan:ColorMode>${color ? 'RGB24' : 'Grayscale8'}</scan:ColorMode>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
  <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
  <scan:XResolution>${dpi}</scan:XResolution>
  <scan:YResolution>${dpi}</scan:YResolution>${
    // The MFC-L2710DN only feeds from the ADF when duplex is explicitly off.
    source === 'feeder' ? '\n  <scan:Duplex>false</scan:Duplex>' : ''
  }
</scan:ScanSettings>`;
}

class ScanError extends Error {
  constructor(message, details) {
    super(message);
    this.details = details;
  }
}

async function readState(baseUrl) {
  try {
    const xml = await (await fetch(`${baseUrl}/ScannerStatus`)).text();
    return {
      scannerState: xml.match(/<pwg:State>(\w+)</)?.[1],
      adfState: xml.match(/<scan:AdfState>(\w+)</)?.[1],
    };
  } catch {
    return {};
  }
}

// Fails early with a readable message when the scanner can't start a job.
async function checkReady(baseUrl, source) {
  let xml;
  try {
    xml = await (await fetch(`${baseUrl}/ScannerStatus`)).text();
  } catch {
    throw new Error('Scanner is not reachable');
  }
  const adf = xml.match(/<scan:AdfState>(\w+)</)?.[1];
  if (source === 'feeder' && adf === 'ScannerAdfEmpty') {
    throw new Error('The feeder is empty. Load paper into the document feeder and try again.');
  }
  if (source === 'feeder' && adf && adf !== 'ScannerAdfLoaded') throw new Error(`Feeder problem: ${adf}`);
}

// Runs one eSCL job and returns every page as a JPEG buffer.
async function scan(baseUrl, opts) {
  await checkReady(baseUrl, opts.source);
  const xml = settingsXml(opts);
  console.log(`scan: source=${opts.source} (${SOURCES[opts.source]}) dpi=${opts.dpi} color=${opts.color} -> ${baseUrl}\n${xml}`);
  // The scanner answers 503 while it is busy (e.g. finishing the previous job), so retry briefly.
  let create;
  for (let attempt = 1; attempt <= 6; attempt++) {
    create = await fetch(`${baseUrl}/ScanJobs`, {
      method: 'POST',
      // Brother scanners ignore the whole request body (and scan the glass with defaults) unless this
      // is application/xml, not text/xml.
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    });
    if (create.status !== 503) break;
    console.log(`scanner busy (503), retry ${attempt}/6`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (create.status !== 201) {
    const body = (await create.text().catch(() => ''))
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    const details = {
      request: `POST ${baseUrl}/ScanJobs`,
      source: SOURCES[opts.source],
      dpi: opts.dpi,
      color: opts.color,
      requestBody: xml,
      responseStatus: create.status,
      responseBody: body || '(empty)',
      ...(await readState(baseUrl)),
    };
    console.log('scan rejected:', details);
    throw new ScanError(
      create.status === 503
        ? 'Scanner is busy. Wait a moment and try again.'
        : `Scanner rejected the job (HTTP ${create.status}). It may still have started scanning.`,
      details,
    );
  }
  const location = create.headers.get('location');
  if (!location) throw new Error('Scanner returned no job location');
  const job = new URL(location, baseUrl).href.replace(/\/$/, '');

  const pages = [];
  try {
    for (;;) {
      // Brother returns 404 for back-to-back NextDocument requests while feeding.
      if (pages.length) await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(`${job}/NextDocument`);
      if (res.status === 404 || res.status === 409) break; // no more pages
      if (!res.ok) throw new Error(`Scanner error while reading page (HTTP ${res.status})`);
      pages.push(Buffer.from(await res.arrayBuffer()));
      if (opts.source === 'platen') break; // flatbed yields one page per job
    }
  } finally {
    fetch(job, { method: 'DELETE' }).catch(() => {});
  }
  if (!pages.length) throw new Error('Scanner returned no pages (is there a document?)');
  return pages;
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
    if (url.pathname === '/devices') return json(200, { devices: await discover() });
    if (url.pathname === '/scan' && req.method === 'POST') {
      const q = url.searchParams;
      const device = q.get('device');
      if (!device || !isLanUrl(device)) return json(400, { error: 'a LAN device url is required' });
      const source = q.get('source') === 'feeder' ? 'feeder' : 'platen';
      const dpi = [100, 200, 300, 600].includes(Number(q.get('dpi'))) ? Number(q.get('dpi')) : 300;
      const color = q.get('color') !== 'false';
      const pages = await scan(device, { source, dpi, color });
      return json(200, { pages: pages.map((p) => p.toString('base64')) });
    }
    json(404, { error: 'not found' });
  } catch (err) {
    json(502, { error: err.message, details: err.details });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mctwain listening on http://127.0.0.1:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    bonjour.destroy();
    process.exit(0);
  });
}
