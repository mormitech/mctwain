// Scanner discovery over mDNS plus a cache of what was found, keyed by GUID.
import { Bonjour } from 'bonjour-service';
import { fetchCapabilities, fetchStatus, isLanUrl } from './escl.js';
import { deviceGuid } from './guid.js';

const DISCOVERY_MS = Number(process.env.MCTWAIN_DISCOVERY_MS ?? 5000);
const CAPABILITIES_TTL_MS = 5 * 60_000;
// A scanner is dropped after missing this many searches in a row, so one lost reply doesn't make it flicker.
const MAX_MISSED = 2;

const bonjour = new Bonjour();

// guid -> record
const cache = new Map();
// guid -> { capabilities, at }
const capabilityCache = new Map();

export const closeDiscovery = () => bonjour.destroy();

const record = (svc, scheme) => {
  const ip = svc.addresses?.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? null;
  const root = svc.txt?.rs ? `/${svc.txt.rs}` : '/eSCL';
  return {
    guid: deviceGuid({ txt: svc.txt, host: svc.host, name: svc.name }),
    name: svc.name,
    host: svc.host,
    ip,
    port: svc.port,
    scheme,
    url: `${scheme}://${ip ?? svc.host}:${svc.port}${root}`,
    txt: svc.txt ?? {},
  };
};

// Sends one mDNS query for eSCL scanners (plain HTTP and HTTPS) and collects what answers within the window.
function listen(timeoutMs) {
  return new Promise((resolve) => {
    const found = new Map();
    const onService = (scheme) => (svc) => {
      const next = record(svc, scheme);
      // A scanner that offers both is kept once; plain HTTP wins because it works with every scanner
      // (some HTTPS implementations use TLS versions that Node refuses).
      if (found.get(next.guid)?.scheme === 'http' && scheme === 'https') return;
      found.set(next.guid, next);
    };
    const browsers = [
      bonjour.find({ type: 'uscan' }, onService('http')),
      bonjour.find({ type: 'uscans' }, onService('https')),
    ];
    setTimeout(() => {
      browsers.forEach((browser) => browser.stop());
      resolve(found);
    }, timeoutMs);
  });
}

// Merges one search result into the cache.
export function applySearch(found) {
  for (const [guid, rec] of found) cache.set(guid, { ...rec, missed: 0 });
  for (const [guid, rec] of cache) {
    if (found.has(guid)) continue;
    rec.missed += 1;
    if (rec.missed >= MAX_MISSED) {
      cache.delete(guid);
      capabilityCache.delete(guid);
    }
  }
}

// What /devices tells clients: how to recognise a scanner and where it is. Details come from /devices/{guid}.
export const publicDevice = (rec) => ({
  guid: rec.guid,
  name: rec.name,
  model: rec.txt.ty ?? rec.name,
  host: rec.host,
  ip: rec.ip,
  port: rec.port,
  scheme: rec.scheme,
});

// Overlapping /devices calls (several tabs, or a slow client) share one search.
let searching = null;
export function search(timeoutMs = DISCOVERY_MS) {
  searching ??= listen(timeoutMs)
    .then(applySearch)
    .finally(() => (searching = null));
  return searching;
}

export const listDevices = () => [...cache.values()].map(publicDevice);

export const findDevice = (guid) => {
  const rec = cache.get(guid);
  return rec && isLanUrl(rec.url) ? rec : null;
};

export async function capabilitiesOf(rec) {
  const cached = capabilityCache.get(rec.guid);
  if (cached && Date.now() - cached.at < CAPABILITIES_TTL_MS) return cached.capabilities;
  const capabilities = await fetchCapabilities(rec.url);
  capabilityCache.set(rec.guid, { capabilities, at: Date.now() });
  return capabilities;
}

// Everything about one scanner: how to reach it, what it can do and what it is doing right now.
export async function describeDevice(rec) {
  const [capabilities, status] = await Promise.all([capabilitiesOf(rec), fetchStatus(rec.url).catch(() => null)]);
  return { ...publicDevice(rec), capabilities, status };
}

// For tests.
export const _cache = cache;
