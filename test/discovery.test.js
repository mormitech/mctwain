import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { _cache, applySearch, closeDiscovery, listDevices } from '../src/discovery.js';

after(closeDiscovery);
beforeEach(() => _cache.clear());

const scanner = (guid, extra = {}) => [
  guid,
  { guid, name: 'Example', host: 'example.local', ip: '10.0.0.5', port: 80, scheme: 'http', url: 'http://10.0.0.5:80/eSCL', txt: { ty: 'Example 1' }, ...extra },
];

test('a search fills the cache and /devices lists it', () => {
  applySearch(new Map([scanner('a')]));
  assert.deepEqual(listDevices(), [
    { guid: 'a', name: 'Example', model: 'Example 1', host: 'example.local', ip: '10.0.0.5', port: 80, scheme: 'http' },
  ]);
});

test('a scanner that misses one search stays, two in a row removes it', () => {
  applySearch(new Map([scanner('a'), scanner('b')]));
  applySearch(new Map([scanner('a')])); // b missed once
  assert.deepEqual(listDevices().map((d) => d.guid), ['a', 'b']);
  applySearch(new Map([scanner('a')])); // b missed twice
  assert.deepEqual(listDevices().map((d) => d.guid), ['a']);
});

test('answering again resets the miss count and refreshes the address', () => {
  applySearch(new Map([scanner('a')]));
  applySearch(new Map());
  applySearch(new Map([scanner('a', { ip: '10.0.0.9', url: 'http://10.0.0.9:80/eSCL' })]));
  applySearch(new Map());
  assert.equal(listDevices().length, 1);
  assert.equal(listDevices()[0].ip, '10.0.0.9');
});
