import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HttpError, parseCapabilities, parseStatus, resolveScanOptions, settingsXml } from '../src/escl.js';

const caps = parseCapabilities(readFileSync(new URL('./fixtures/capabilities.xml', import.meta.url), 'utf8'));
const q = (params = {}) => new URLSearchParams(params);

test('parses sources, modes, resolutions and sizes', () => {
  assert.equal(caps.model, 'Example MFC-1000 series');
  assert.equal(caps.uuid, '11111111-2222-3333-4444-555555555555');
  assert.deepEqual(caps.sources.platen.colorModes, ['BlackAndWhite1', 'Grayscale8', 'RGB24']);
  assert.deepEqual(caps.sources.platen.resolutions.values, [100, 200, 300, 600]);
  assert.deepEqual(caps.sources.platen.formats, ['application/pdf', 'image/jpeg']);
  assert.equal(caps.sources.platen.size.maxHeight, 3507);
  assert.equal(caps.sources.feeder.capacity, 20);
  assert.equal(caps.sources.feeder.duplex, null);
  assert.deepEqual(caps.sources.feeder.simplex.resolutions.values, [200, 300]);
  assert.equal(caps.sources.feeder.simplex.size.maxHeight, 4200);
});

test('a scanner without a feeder reports none', () => {
  const noAdf = parseCapabilities(
    '<scan:ScannerCapabilities xmlns:scan="x"><scan:Platen><scan:PlatenInputCaps><scan:MaxWidth>2550</scan:MaxWidth></scan:PlatenInputCaps></scan:Platen></scan:ScannerCapabilities>',
  );
  assert.equal(noAdf.sources.feeder, null);
  assert.equal(noAdf.sources.platen.size.maxWidth, 2550);
});

test('rejects something that is not a capabilities document', () => {
  assert.throws(() => parseCapabilities('<html><body>404</body></html>'));
});

test('parses the live status', () => {
  const status = parseStatus(
    '<scan:ScannerStatus xmlns:scan="x" xmlns:pwg="y"><pwg:State>Idle</pwg:State><scan:AdfState>ScannerAdfLoaded</scan:AdfState></scan:ScannerStatus>',
  );
  assert.deepEqual(status, { state: 'Idle', adfState: 'ScannerAdfLoaded' });
});

test('defaults: feeder when there is one, 300 dpi, colour, A4', () => {
  const o = resolveScanOptions(caps, q());
  assert.deepEqual(o, { source: 'feeder', duplex: false, dpi: 300, color: 'color', paper: 'a4', width: 2480, height: 3507 });
});

test('flatbed and the options asked for', () => {
  const o = resolveScanOptions(caps, q({ source: 'platen', dpi: '600', color: 'bw', paper: 'letter' }));
  assert.equal(o.source, 'platen');
  assert.equal(o.dpi, 600);
  assert.equal(o.color, 'bw');
  assert.deepEqual([o.width, o.height], [2550, 3300]);
});

test('an unsupported resolution says what is supported', () => {
  assert.throws(
    () => resolveScanOptions(caps, q({ source: 'feeder', dpi: '600' })),
    (err) => err instanceof HttpError && err.status === 400 && /200, 300/.test(err.message),
  );
});

test('the feeder of this scanner cannot do two-sided scans; the flatbed cannot either', () => {
  assert.throws(() => resolveScanOptions(caps, q({ source: 'feeder', duplex: 'true' })), /both sides/);
  assert.throws(() => resolveScanOptions(caps, q({ source: 'platen', duplex: 'true' })), /only available from the feeder/);
});

test('a colour mode the source lacks is rejected', () => {
  assert.throws(() => resolveScanOptions(caps, q({ source: 'feeder', color: 'bw' })), /does not offer "bw"/);
});

test('paper is clamped to what the scanner can scan, max uses the full area', () => {
  assert.equal(resolveScanOptions(caps, q({ source: 'platen', paper: 'legal' })).height, 3507);
  const max = resolveScanOptions(caps, q({ source: 'feeder', paper: 'max' }));
  assert.deepEqual([max.width, max.height], [2550, 4200]);
  assert.throws(() => resolveScanOptions(caps, q({ paper: 'a0' })), /Unknown paper size/);
});

test('older clients: color=false means gray, a missing feeder is reported', () => {
  assert.equal(resolveScanOptions(caps, q({ color: 'false' })).color, 'gray');
  const glassOnly = { ...caps, sources: { ...caps.sources, feeder: null } };
  assert.throws(() => resolveScanOptions(glassOnly, q({ source: 'feeder' })), /no document feeder/);
  assert.equal(resolveScanOptions(glassOnly, q()).source, 'platen');
});

test('the request XML carries the chosen options', () => {
  const xml = settingsXml(resolveScanOptions(caps, q({ source: 'feeder', dpi: '200', color: 'gray' })));
  assert.match(xml, /<pwg:InputSource>Feeder<\/pwg:InputSource>/);
  assert.match(xml, /<scan:ColorMode>Grayscale8<\/scan:ColorMode>/);
  assert.match(xml, /<scan:XResolution>200<\/scan:XResolution>/);
  assert.match(xml, /<pwg:Width>2480<\/pwg:Width>/);
  assert.match(xml, /<scan:Duplex>false<\/scan:Duplex>/);
  assert.doesNotMatch(settingsXml(resolveScanOptions(caps, q({ source: 'platen' }))), /Duplex/);
});
