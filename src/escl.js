// eSCL (AirScan) client: requests, capabilities parsing, scan option validation and the scan job itself.
import http from 'node:http';
import https from 'node:https';
import { XMLParser } from 'fast-xml-parser';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetch() for scanner requests. HTTPS scanners use self-signed certificates, so those are not verified;
// requests only ever go to LAN addresses (see isLanUrl).
export function scannerFetch(url, { method = 'GET', headers = {}, body, timeout = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    const req = client.request(target, { method, headers, rejectUnauthorized: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const noBody = [204, 205, 304].includes(res.statusCode);
        resolve(
          new Response(noBody ? null : Buffer.concat(chunks), {
            status: res.statusCode,
            headers: Object.fromEntries(Object.entries(res.headers).filter(([, v]) => typeof v === 'string')),
          }),
        );
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error('Scanner did not respond in time')));
    req.on('error', reject);
    req.end(body);
  });
}

// Only talk to scanners on the local network, never arbitrary hosts (mDNS answers can be forged on a LAN).
export function isLanUrl(value) {
  try {
    const { protocol, hostname } = new URL(value);
    return (
      (protocol === 'http:' || protocol === 'https:') &&
      (/^(10|127)\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
        hostname.endsWith('.local'))
    );
  } catch {
    return false;
  }
}

// ---- Capabilities and status ------------------------------------------------------------------------------

const REPEATED = new Set([
  'SettingProfile',
  'ColorMode',
  'DocumentFormat',
  'DocumentFormatExt',
  'DiscreteResolution',
  'Intent',
]);
const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => REPEATED.has(name),
});

const num = (value) => (value === undefined || value === '' ? null : Number(value));
const uniq = (values) => [...new Set(values)];
const sortedNumbers = (values) => uniq(values.filter(Number.isFinite)).sort((a, b) => a - b);

// One input (flatbed, feeder simplex, feeder duplex) in plain terms. Sizes are in 1/300 inch.
function inputCaps(node) {
  if (!node) return null;
  const profiles = node.SettingProfiles?.SettingProfile ?? [];
  const discrete = profiles.flatMap((p) => p.SupportedResolutions?.DiscreteResolutions?.DiscreteResolution ?? []);
  const rangeNode = profiles.map((p) => p.SupportedResolutions?.ResolutionRange?.XResolutionRange).find(Boolean);
  return {
    colorModes: uniq(profiles.flatMap((p) => p.ColorModes?.ColorMode ?? [])),
    formats: uniq(profiles.flatMap((p) => [...(p.DocumentFormats?.DocumentFormat ?? []), ...(p.DocumentFormats?.DocumentFormatExt ?? [])])),
    resolutions: {
      values: sortedNumbers(discrete.filter((r) => r.XResolution === r.YResolution).map((r) => Number(r.XResolution))),
      range: rangeNode ? { min: num(rangeNode.Min), max: num(rangeNode.Max), step: num(rangeNode.Step) ?? 1 } : null,
    },
    size: {
      unit: '1/300 inch',
      minWidth: num(node.MinWidth),
      maxWidth: num(node.MaxWidth),
      minHeight: num(node.MinHeight),
      maxHeight: num(node.MaxHeight),
    },
    intents: node.SupportedIntents?.Intent ?? [],
  };
}

export function parseCapabilities(xml) {
  const root = parser.parse(xml)?.ScannerCapabilities;
  if (!root) throw new Error('Not an eSCL capabilities document');
  return {
    make: root.Manufacturer ?? null,
    model: root.MakeAndModel ?? null,
    uuid: root.UUID ?? null,
    escl: root.Version ?? null,
    sources: {
      platen: inputCaps(root.Platen?.PlatenInputCaps),
      feeder: root.Adf
        ? {
            simplex: inputCaps(root.Adf.AdfSimplexInputCaps),
            duplex: inputCaps(root.Adf.AdfDuplexInputCaps),
            capacity: num(root.Adf.FeederCapacity),
          }
        : null,
    },
  };
}

export function parseStatus(xml) {
  const root = parser.parse(xml)?.ScannerStatus ?? {};
  return { state: root.State ?? null, adfState: root.AdfState ?? null };
}

export async function fetchCapabilities(baseUrl) {
  const res = await scannerFetch(`${baseUrl}/ScannerCapabilities`, { timeout: 5000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseCapabilities(await res.text());
}

export async function fetchStatus(baseUrl) {
  const res = await scannerFetch(`${baseUrl}/ScannerStatus`, { timeout: 5000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseStatus(await res.text());
}

// ---- Scan options -------------------------------------------------------------------------------------------

const COLOR_MODES = { color: 'RGB24', gray: 'Grayscale8', bw: 'BlackAndWhite1' };
const SOURCES = { platen: 'Platen', feeder: 'Feeder' };
// Paper sizes in 1/300 inch (width, height).
export const PAPER = { a4: [2480, 3507], letter: [2550, 3300], legal: [2550, 4200] };

function dpiSupported(resolutions, dpi) {
  if (!resolutions || (!resolutions.values.length && !resolutions.range)) return true; // unknown: let the scanner decide
  if (resolutions.values.includes(dpi)) return true;
  const { min, max, step } = resolutions.range ?? {};
  return min !== undefined && dpi >= min && dpi <= max && (dpi - min) % (step || 1) === 0;
}

function defaultDpi(resolutions) {
  if (dpiSupported(resolutions, 300)) return 300;
  const values = resolutions?.values?.length ? resolutions.values : [resolutions?.range?.max ?? 300];
  return values.reduce((best, v) => (Math.abs(v - 300) < Math.abs(best - 300) ? v : best));
}

// Turns the query of a /scan request into settings the scanner supports, or a 400 that says what is possible.
export function resolveScanOptions(caps, q) {
  const bad = (message) => new HttpError(400, message);
  const feeder = caps.sources.feeder;

  const asked = q.get('source');
  const source = asked === 'feeder' || asked === 'platen' ? asked : feeder ? 'feeder' : 'platen';
  if (source === 'platen' && !caps.sources.platen) throw bad('This scanner has no flatbed.');
  if (source === 'feeder' && !feeder) throw bad('This scanner has no document feeder.');

  const duplex = q.get('duplex') === 'true';
  let input;
  if (source === 'platen') {
    if (duplex) throw bad('Two-sided scanning is only available from the feeder.');
    input = caps.sources.platen;
  } else {
    input = duplex ? feeder.duplex : (feeder.simplex ?? feeder.duplex);
    if (!input) throw bad('This scanner cannot scan both sides of a sheet.');
  }

  let dpi = defaultDpi(input.resolutions);
  if (q.get('dpi') !== null) {
    dpi = Number(q.get('dpi'));
    if (!dpiSupported(input.resolutions, dpi)) {
      const { values, range } = input.resolutions;
      throw bad(`Unsupported resolution ${q.get('dpi')} dpi. Supported: ${values.join(', ') || `${range.min}-${range.max}`}.`);
    }
  }

  // 'color' | 'gray' | 'bw'. 'true' and 'false' are accepted for older clients.
  const legacy = { true: 'color', false: 'gray' };
  const wanted = q.get('color');
  let color = legacy[wanted] ?? wanted;
  if (!color) color = Object.keys(COLOR_MODES).find((c) => !input.colorModes.length || input.colorModes.includes(COLOR_MODES[c]));
  if (!COLOR_MODES[color]) throw bad(`Unknown colour mode "${wanted}". Use color, gray or bw.`);
  if (input.colorModes.length && !input.colorModes.includes(COLOR_MODES[color])) {
    throw bad(`This scanner does not offer "${color}". Supported: ${input.colorModes.join(', ')}.`);
  }

  if (input.formats.length && !input.formats.includes('image/jpeg')) {
    throw bad('This scanner cannot deliver JPEG images.');
  }

  // Page size: a named paper size, or 'max' for everything the scanner can scan. Never larger than the scanner.
  const paper = q.get('paper') ?? 'a4';
  const { maxWidth, maxHeight } = input.size;
  const size = paper === 'max' ? (maxWidth && maxHeight ? [maxWidth, maxHeight] : PAPER.a4) : PAPER[paper];
  if (!size) throw bad(`Unknown paper size "${paper}". Use a4, letter, legal or max.`);
  let [width, height] = size;
  if (maxWidth) width = Math.min(width, maxWidth);
  if (maxHeight) height = Math.min(height, maxHeight);

  return { source, duplex, dpi, color, paper, width, height };
}

// Element order and content follow sane-airscan, which is known to work with this scanner.
export function settingsXml({ source, duplex, dpi, color, width, height }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.0</pwg:Version>
  <scan:Intent>Document</scan:Intent>
  <pwg:ScanRegions>
    <pwg:ScanRegion>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:Width>${width}</pwg:Width>
      <pwg:Height>${height}</pwg:Height>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>${SOURCES[source]}</pwg:InputSource>
  <scan:ColorMode>${COLOR_MODES[color]}</scan:ColorMode>
  <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
  <scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>
  <scan:XResolution>${dpi}</scan:XResolution>
  <scan:YResolution>${dpi}</scan:YResolution>${
    // The Brother MFC-L2710DN only feeds from the ADF when duplex is explicitly given.
    source === 'feeder' ? `\n  <scan:Duplex>${duplex}</scan:Duplex>` : ''
  }
</scan:ScanSettings>`;
}

// ---- Scanning -----------------------------------------------------------------------------------------------

// Fails early with a readable message when the scanner can't start a job.
async function checkReady(baseUrl, source) {
  let status;
  try {
    status = await fetchStatus(baseUrl);
  } catch {
    throw new HttpError(502, 'Scanner is not reachable');
  }
  const adf = status.adfState;
  if (source === 'feeder' && adf === 'ScannerAdfEmpty') {
    throw new HttpError(502, 'The feeder is empty. Load paper into the document feeder and try again.');
  }
  if (source === 'feeder' && adf && adf !== 'ScannerAdfLoaded') throw new HttpError(502, `Feeder problem: ${adf}`);
}

const plainText = (html) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

// Runs one eSCL job and returns every page as a JPEG buffer.
export async function scan(baseUrl, options) {
  await checkReady(baseUrl, options.source);
  const xml = settingsXml(options);
  console.log(
    `scan: ${options.source}${options.duplex ? ' duplex' : ''} ${options.dpi} dpi ${options.color} ` +
      `${options.width}x${options.height} -> ${baseUrl}`,
  );
  if (process.env.MCTWAIN_DEBUG) console.log(xml);

  // The scanner answers 503 while it is busy (e.g. finishing the previous job), so retry briefly.
  let create;
  for (let attempt = 1; attempt <= 6; attempt++) {
    create = await scannerFetch(`${baseUrl}/ScanJobs`, {
      method: 'POST',
      // Brother scanners ignore the whole request body (and scan the glass with defaults) unless this
      // is application/xml, not text/xml.
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    });
    if (create.status !== 503) break;
    console.log(`scanner busy (503), retry ${attempt}/6`);
    await sleep(2000);
  }
  if (create.status !== 201) {
    const details = {
      request: `POST ${baseUrl}/ScanJobs`,
      options,
      requestBody: xml,
      responseStatus: create.status,
      responseBody: plainText(await create.text().catch(() => '')) || '(empty)',
      ...(await fetchStatus(baseUrl).catch(() => ({}))),
    };
    console.log('scan rejected:', details);
    throw new HttpError(
      502,
      create.status === 503
        ? 'Scanner is busy. Wait a moment and try again.'
        : `Scanner rejected the job (HTTP ${create.status}). It may still have started scanning.`,
      details,
    );
  }
  const location = create.headers.get('location');
  if (!location) throw new HttpError(502, 'Scanner returned no job location');
  const job = new URL(location, baseUrl).href.replace(/\/$/, '');

  const pages = [];
  try {
    for (;;) {
      // Brother returns 404 for back-to-back NextDocument requests while feeding.
      if (pages.length) await sleep(1500);
      const res = await scannerFetch(`${job}/NextDocument`);
      if (res.status === 404 || res.status === 409) break; // no more pages
      if (!res.ok) throw new HttpError(502, `Scanner error while reading page (HTTP ${res.status})`);
      pages.push(Buffer.from(await res.arrayBuffer()));
      if (options.source === 'platen') break; // flatbed yields one page per job
    }
  } finally {
    scannerFetch(job, { method: 'DELETE' }).catch(() => {});
  }
  if (!pages.length) throw new HttpError(502, 'Scanner returned no pages (is there a document?)');
  return pages;
}
